/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SshClient } from '@microsoft/dev-tunnels-ssh-tcp';
import { NodeStream, SshClientCredentials, SshClientSession, SshDisconnectReason, SshServerSession, SshSessionConfiguration, Stream, WebSocketStream } from '@microsoft/dev-tunnels-ssh';
import { importKey, importKeyBytes } from '@microsoft/dev-tunnels-ssh-keys';
import { ExtensionServiceDefinition, GetWorkspaceAuthInfoResponse, SendErrorReportRequest, SendLocalSSHUserFlowStatusRequest_Code, SendLocalSSHUserFlowStatusRequest_ConnType, SendLocalSSHUserFlowStatusRequest_Status } from '../proto/typescript/ipc/v1/ipc';
import { Client, ClientError, Status, createChannel, createClient } from 'nice-grpc';
import { retryWithStop } from '../common/async';
import { WebSocket } from 'ws';
import * as stream from 'stream';
import { ILogService } from '../services/logService';

// This public key is safe to be public since we only use it to verify local-ssh connections.
const HOST_KEY = 'LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0tCk1JR0hBZ0VBTUJNR0J5cUdTTTQ5QWdFR0NDcUdTTTQ5QXdFSEJHMHdhd0lCQVFRZ1QwcXg1eEJUVmc4TUVJbUUKZmN4RXRZN1dmQVVsM0JYQURBK2JYREsyaDZlaFJBTkNBQVJlQXo0RDVVZXpqZ0l1SXVOWXpVL3BCWDdlOXoxeApvZUN6UklqcGdCUHozS0dWRzZLYXV5TU5YUm95a21YSS9BNFpWaW9nd2Vjb0FUUjRUQ2FtWm1ScAotLS0tLUVORCBQUklWQVRFIEtFWS0tLS0tCg==';
// const HOST_PUBLIC_FP = 'AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBF4DPgPlR7OOAi4i41jNT+kFft73PXGh4LNEiOmAE/PcoZUbopq7Iw1dGjKSZcj8DhlWKiDB5ygBNHhMJqZmZGk=';

function getHostKey(): Buffer {
    return Buffer.from(HOST_KEY, 'base64');
}

function getDaemonVersion() {
    return process.env.DAEMON_VERSION ?? '0.0.1';
}

interface ClientOptions {
    host: string;
    extIpcPort: number;
}

function getClientOptions(): ClientOptions {
    const args = process.argv.slice(2);
    return {
        host: args[0],
        extIpcPort: Number.parseInt(args[1], 10),
    };
}

class NoRunningInstanceError extends Error {
    constructor() {
        super('Workspace not running.');
        this.name = 'NoRunningInstanceError';
    }
}
class FailedToGetAuthInfoError extends Error {
    constructor() {
        super('Cannot get workspace credentials.');
        this.name = 'FailedToGetAuthInfoError';
    }
}
class AuthenticationError extends Error {
    constructor() {
        super('Authentication failed.');
        this.name = 'AuthenticationError';
    }
}

// TODO(local-ssh): Remove me after direct ssh works with @microsft/dev-tunnels-ssh
const FORCE_TUNNEL = true;

class WebSocketSSHProxy {

    private extensionIpc: Client<ExtensionServiceDefinition>;

    constructor(private logService: ILogService, private options: ClientOptions) {
        this.onExit();
        this.onException();
        this.extensionIpc = createClient(ExtensionServiceDefinition, createChannel('127.0.0.1:' + this.options.extIpcPort));
    }

    private onExit() {
        const exitHandler = (_signal?: NodeJS.Signals) => {
            process.exit(0);
        };
        process.on('SIGINT', exitHandler);
        process.on('SIGTERM', exitHandler);
    }

    private onException() {
        process.on('uncaughtException', (err) => {
            this.logService.error(err, 'uncaught exception');
        });
        process.on('unhandledRejection', (err) => {
            this.logService.error(err as any, 'unhandled rejection');
        });
    }

    async start() {
        // Create as Duplex from stdin and stdout as passing them separately to NodeStream
        // will result in an unhandled exception as NodeStream does not properly add
        // an error handler to the writable stream
        const sshStream = stream.Duplex.from({ readable: process.stdin, writable: process.stdout });
        sshStream.on('error', e => {
            if ((e as any).code === 'EPIPE') {
                // HACK:
                // Seems there's a bug in the ssh library that could hang forever when the stream gets closed
                // so the below `await pipePromise` will never return and the node process will never exit.
                // So let's just force kill here
                setTimeout(() => process.exit(0), 50);
            }
        });

        // This is expected to never throw as key is hardcoded
        const keys = await importKeyBytes(getHostKey());
        const config = new SshSessionConfiguration();
        config.maxClientAuthenticationAttempts = 1;
        const session = new SshServerSession(config);
        session.credentials.publicKeys.push(keys);

        let pipePromise: Promise<void> | undefined;
        session.onAuthenticating((e) => {
            // TODO vscode_desktop_local_ssh connecting as status
            e.authenticationPromise = this.authenticateClient(e.username ?? '')
                .then(pipeSession => {
                    // TODO vscode_desktop_local_ssh connected as status
                    pipePromise = session.pipe(pipeSession);
                    return {};
                }).catch(async error => {
                    // TODO vscode_desktop_local_ssh failed as status with coarse grained code
                    // TODO report an error to GCP only here
                    this.logService.error(error, 'failed to authenticate client with username: ' + e.username);
                    await session.close(SshDisconnectReason.byApplication, error.toString(), error instanceof Error ? error : undefined);
                    return null;
                });
        });
        try {
            await session.connect(new NodeStream(sshStream));

            await pipePromise;
        } catch (e) {
            if (session.isClosed) {
                return;
            }
            this.logService.error(e, 'failed to connect to client');
            await session.close(SshDisconnectReason.byApplication, e.toString(), e instanceof Error ? e : undefined);
        }
    }

    private async authenticateClient(username: string) {
        const workspaceInfo = await this.retryGetWorkspaceInfo(username);
        if (FORCE_TUNNEL) {
            return this.getTunnelSSHConfig(workspaceInfo);
        }

		try {
			const session = await this.tryDirectSSH(workspaceInfo);
			return session;
		} catch (e) {
			this.logService.error('failed to connect with direct ssh, going to try tunnel');
			return this.getTunnelSSHConfig(workspaceInfo);
		}
    }

    private async tryDirectSSH(workspaceInfo: GetWorkspaceAuthInfoResponse): Promise<SshClientSession> {
        try {
            const connConfig = {
                host: `${workspaceInfo.workspaceId}.ssh.${workspaceInfo.workspaceHost}`,
                port: 22,
                username: workspaceInfo.workspaceId,
                password: workspaceInfo.ownerToken,
            };
            const config = new SshSessionConfiguration();
            const client = new SshClient(config);
            const session = await client.openSession(connConfig.host, connConfig.port);
            session.onAuthenticating((e) => e.authenticationPromise = Promise.resolve({}));
            const credentials: SshClientCredentials = { username: connConfig.username, password: connConfig.password };
            const authenticated = await session.authenticate(credentials);
            if (!authenticated) {
                throw new AuthenticationError();
            }
            return session;
        } catch (e) {
            this.logService.error(e, 'failed to connect with direct ssh');
            this.sendErrorReport(workspaceInfo.gitpodHost, workspaceInfo.userId, workspaceInfo.workspaceId, workspaceInfo.instanceId, e, 'failed to connect with direct ssh');
            this.extensionIpc.sendLocalSSHUserFlowStatus({
                gitpodHost: workspaceInfo.gitpodHost,
                userId: workspaceInfo.userId,
                status: SendLocalSSHUserFlowStatusRequest_Status.STATUS_FAILURE,
                workspaceId: workspaceInfo.workspaceId,
                instanceId: workspaceInfo.instanceId,
                failureCode: SendLocalSSHUserFlowStatusRequest_Code.CODE_SSH_CANNOT_CONNECT,
                daemonVersion: getDaemonVersion(),
                connType: SendLocalSSHUserFlowStatusRequest_ConnType.CONN_TYPE_SSH,
            });
            throw e;
        }
    }

    private async getTunnelSSHConfig(workspaceInfo: GetWorkspaceAuthInfoResponse): Promise<SshClientSession> {
        const workspaceWSUrl = `wss://${workspaceInfo.workspaceId}.${workspaceInfo.workspaceHost}`;
        const socket = new WebSocket(workspaceWSUrl + '/_supervisor/tunnel/ssh', undefined, {
            headers: {
                'x-gitpod-owner-token': workspaceInfo.ownerToken
            }
        });
        socket.binaryType = 'arraybuffer';

        const stream = await new Promise<Stream>((resolve, reject) => {
            socket.onopen = () => resolve(new WebSocketStream(socket as any));
            socket.onerror = (e) => reject(e);
        }).catch(e => {
            this.extensionIpc.sendLocalSSHUserFlowStatus({
                gitpodHost: workspaceInfo.gitpodHost,
                userId: workspaceInfo.userId,
                status: SendLocalSSHUserFlowStatusRequest_Status.STATUS_FAILURE,
                workspaceId: workspaceInfo.workspaceId,
                instanceId: workspaceInfo.instanceId,
                failureCode: SendLocalSSHUserFlowStatusRequest_Code.CODE_TUNNEL_CANNOT_CREATE_WEBSOCKET,
                daemonVersion: getDaemonVersion(),
                connType: SendLocalSSHUserFlowStatusRequest_ConnType.CONN_TYPE_TUNNEL,
            });
            throw e;
        });

        try {
            const config = new SshSessionConfiguration();
            const session = new SshClientSession(config);
            session.onAuthenticating((e) => e.authenticationPromise = Promise.resolve({}));

            await session.connect(stream);

            const ok = await session.authenticate({ username: 'gitpod', publicKeys: [await importKey(workspaceInfo.sshkey)] });
            if (!ok) {
                throw new AuthenticationError();
            }
            return session;
        } catch (e) {
            this.logService.error(e, 'failed to connect with tunnel ssh');
            this.sendErrorReport(workspaceInfo.gitpodHost, workspaceInfo.userId, workspaceInfo.workspaceId, workspaceInfo.instanceId, e, 'failed to connect with tunnel ssh');
            this.extensionIpc.sendLocalSSHUserFlowStatus({
                gitpodHost: workspaceInfo.gitpodHost,
                userId: workspaceInfo.userId,
                status: SendLocalSSHUserFlowStatusRequest_Status.STATUS_FAILURE,
                workspaceId: workspaceInfo.workspaceId,
                instanceId: workspaceInfo.instanceId,
                failureCode: SendLocalSSHUserFlowStatusRequest_Code.CODE_TUNNEL_NO_ESTABLISHED_CONNECTION,
                daemonVersion: getDaemonVersion(),
                connType: SendLocalSSHUserFlowStatusRequest_ConnType.CONN_TYPE_TUNNEL,
            });
            throw e;
        }
    }

    async retryGetWorkspaceInfo(username: string) {
        return retryWithStop(async (stop) => {
            return this.extensionIpc.getWorkspaceAuthInfo({ workspaceId: username, gitpodHost: this.options.host }).catch(e => {
                this.logService.error(e, 'failed to get workspace info');
                if (e instanceof ClientError) {
                    if (e.code === Status.UNAVAILABLE && e.details.startsWith('workspace is not running')) {
                        stop();
                        throw new NoRunningInstanceError();
                    }
                }
                throw new FailedToGetAuthInfoError();
            });
        }, 200, 50);
    }

    async sendErrorReport(gitpodHost: string, userId: string, workspaceId: string | undefined, instanceId: string | undefined, err: Error | any, message: string) {
        const request: Partial<SendErrorReportRequest> = {
            gitpodHost,
            userId,
            workspaceId: workspaceId ?? '',
            instanceId: instanceId ?? '',
            errorName: '',
            errorMessage: '',
            errorStack: '',
            daemonVersion: getDaemonVersion(),
        };
        if (err instanceof Error) {
            request.errorName = err.name;
            request.errorMessage = message + ': ' + err.message;
            request.errorStack = err.stack ?? '';
        } else {
            request.errorName = '';
            request.errorMessage = message + ': ' + err.toString();
            request.errorStack = '';
        }
        try {
            await this.extensionIpc.sendErrorReport(request);
        } catch (e) {
            this.logService.error(e, 'failed to send error report');
        }
    }
}

const options = getClientOptions();
if (!options) {
    process.exit(1);
}

import { NopeLogger } from './logger';
const logService = new NopeLogger();

// DO NOT PUSH CHANGES BELOW TO PRODUCTION
// import { DebugLogger } from './logger';
// const logService = new DebugLogger();

const proxy = new WebSocketSSHProxy(logService, options);
proxy.start().catch((e) => {
    logService.error(e, 'failed to start proxy');
});
