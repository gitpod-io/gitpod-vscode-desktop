/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SshClient } from '@microsoft/dev-tunnels-ssh-tcp';
import { NodeStream, SshClientCredentials, SshClientSession, SshDisconnectReason, SshServerSession, SshSessionConfiguration, Stream, WebSocketStream } from '@microsoft/dev-tunnels-ssh';
import { importKey, importKeyBytes } from '@microsoft/dev-tunnels-ssh-keys';
import { ExtensionServiceDefinition, GetWorkspaceAuthInfoResponse } from '../proto/typescript/ipc/v1/ipc';
import { Client, ClientError, Status, createChannel, createClient } from 'nice-grpc';
import { retry, timeout } from '../common/async';
import { WrapError } from '../common/utils';
import { WebSocket } from 'ws';
import * as stream from 'stream';
import { ILogService } from '../services/logService';
import { TelemetryService } from './telemetryService';
import { ITelemetryService, UserFlowTelemetryProperties } from '../common/telemetry';
import { LocalSSHMetricsReporter } from '../services/localSSHMetrics';

// This public key is safe to be public since we only use it to verify local-ssh connections.
const HOST_KEY = 'LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0tCk1JR0hBZ0VBTUJNR0J5cUdTTTQ5QWdFR0NDcUdTTTQ5QXdFSEJHMHdhd0lCQVFRZ1QwcXg1eEJUVmc4TUVJbUUKZmN4RXRZN1dmQVVsM0JYQURBK2JYREsyaDZlaFJBTkNBQVJlQXo0RDVVZXpqZ0l1SXVOWXpVL3BCWDdlOXoxeApvZUN6UklqcGdCUHozS0dWRzZLYXV5TU5YUm95a21YSS9BNFpWaW9nd2Vjb0FUUjRUQ2FtWm1ScAotLS0tLUVORCBQUklWQVRFIEtFWS0tLS0tCg==';
// const HOST_PUBLIC_FP = 'AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBF4DPgPlR7OOAi4i41jNT+kFft73PXGh4LNEiOmAE/PcoZUbopq7Iw1dGjKSZcj8DhlWKiDB5ygBNHhMJqZmZGk=';

function getHostKey(): Buffer {
    return Buffer.from(HOST_KEY, 'base64');
}

interface ClientOptions {
    host: string;
    extIpcPort: number;
    machineID: string;
}

function getClientOptions(): ClientOptions {
    const args = process.argv.slice(2);
    // %h is in the form of <ws_id>.vss.<gitpod_host>'
    // add `https://` prefix since our gitpodHost is actually a url not host
    const host = 'https://' + args[0].split('.').splice(2).join('.');
    return {
        host,
        extIpcPort: Number.parseInt(args[1], 10),
        machineID: args[2] ?? '',
    };
}

type FailedToProxyCode = 'SSH.AuthenticationFailed' | 'TUNNEL.AuthenticateSSHKeyFailed' | 'NoRunningInstance' | 'FailedToGetAuthInfo' | 'GitpodHostMismatch' | 'NoAccessTokenFound';

// IgnoredFailedCodes contains the failreCode that don't need to send error report
const IgnoredFailedCodes: (FailedToProxyCode | string)[] = ['NoRunningInstance', 'FailedToGetAuthInfo:UNAVAILABLE', 'FailedToGetAuthInfo:CANCELLED"'];

class FailedToProxyError extends Error {
    constructor(public readonly failureCode: FailedToProxyCode | string, originError?: Error) {
        const msg = 'Failed to proxy connection: ' + failureCode;
        super(originError ? (msg + ': ' + originError.toString()) : msg);
        this.name = 'FailedToProxyError';
    }

    override toString() {
        return `${this.name}(${this.failureCode}) ${this.message}`;
    }
}

// TODO(local-ssh): Remove me after direct ssh works with @microsft/dev-tunnels-ssh
const FORCE_TUNNEL = true;

interface SSHUserFlowTelemetry extends UserFlowTelemetryProperties {
    flow: 'local_ssh';
    gitpodHost: string;
    workspaceId: string;
    instanceId?: string;
    userId?: string;
    failureCode?: FailedToProxyCode | string;
}

class WebSocketSSHProxy {
    private extensionIpc: Client<ExtensionServiceDefinition>;
    private flow: SSHUserFlowTelemetry;

    constructor(
        private readonly options: ClientOptions,
        private readonly telemetryService: ITelemetryService,
        private readonly metricsReporter: LocalSSHMetricsReporter,
        private readonly logService: ILogService
    ) {
        this.flow = {
            flow: 'local_ssh',
            gitpodHost: this.options.host,
            workspaceId: '',
        };

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
        session.onAuthenticating(async (e) => {
            this.flow.workspaceId = e.username ?? '';
            this.sendUserStatusFlow('connecting');
            e.authenticationPromise = this.authenticateClient(e.username ?? '')
                .then(async pipeSession => {
                    this.sendUserStatusFlow('connected');
                    pipePromise = session.pipe(pipeSession);
                    return {};
                }).catch(async err => {
                    let sendErrorReport = true;
                    if (err instanceof FailedToProxyError) {
                        this.flow.failureCode = err.failureCode;
                        if (IgnoredFailedCodes.includes(err.failureCode)) {
                            sendErrorReport = false;
                        }
                    }

                    this.sendUserStatusFlow('failed');
                    if (sendErrorReport) {
                        this.sendErrorReport(this.flow, err, 'failed to authenticate proxy');
                    }

                    // Await a few seconds to delay showing ssh extension error modal dialog
                    await timeout(5000);

                    this.logService.error('failed to authenticate proxy with username: ' + e.username ?? '', err);
                    await session.close(SshDisconnectReason.byApplication, err.toString(), err instanceof Error ? err : undefined);
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
            this.sendErrorReport(this.flow, e, 'failed to connect to client');
            await session.close(SshDisconnectReason.byApplication, e.toString(), e instanceof Error ? e : undefined);
        }
    }

    private async authenticateClient(username: string) {
        const workspaceInfo = await this.retryGetWorkspaceInfo(username);
        this.flow.instanceId = workspaceInfo.instanceId;
        this.flow.userId = workspaceInfo.userId;
        if (workspaceInfo.phase && workspaceInfo.phase !== '' && workspaceInfo.phase !== 'running') {
            throw new FailedToProxyError('NoRunningInstance');
        }

        if (FORCE_TUNNEL) {
            return this.getTunnelSSHConfig(workspaceInfo);
        }
        try {
            return await this.tryDirectSSH(workspaceInfo);
        } catch (e) {
            this.sendErrorReport(this.flow, e, 'try direct ssh failed');
            return this.getTunnelSSHConfig(workspaceInfo);
        }
    }

    private async tryDirectSSH(workspaceInfo: GetWorkspaceAuthInfoResponse): Promise<SshClientSession> {
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
            throw new FailedToProxyError('SSH.AuthenticationFailed');
        }
        return session;
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
        });

        const config = new SshSessionConfiguration();
        const session = new SshClientSession(config);
        session.onAuthenticating((e) => e.authenticationPromise = Promise.resolve({}));

        await session.connect(stream);

        const ok = await session.authenticate({ username: 'gitpod', publicKeys: [await importKey(workspaceInfo.sshkey)] });
        if (!ok) {
            throw new FailedToProxyError('TUNNEL.AuthenticateSSHKeyFailed');
        }
        return session;
    }

    async retryGetWorkspaceInfo(username: string) {
        return retry(async () => {
            return this.extensionIpc.getWorkspaceAuthInfo({ workspaceId: username, gitpodHost: this.options.host }).catch(e => {
                let failureCode = 'FailedToGetAuthInfo';
                if (e instanceof ClientError) {
                    if (e.code === Status.FAILED_PRECONDITION && e.message.includes('gitpod host mismatch')) {
                        throw new FailedToProxyError('GitpodHostMismatch', e);
                    } else if (e.code === Status.INTERNAL && e.message.includes('no access token found')) {
                        throw new FailedToProxyError('NoAccessTokenFound', e);
                    }
                    failureCode += ':' + Status[e.code];
                }
                throw new FailedToProxyError(failureCode, e);
            });
        }, 200, 50);
    }

    sendUserStatusFlow(status: 'connected' | 'connecting' | 'failed') {
        this.metricsReporter.reportConnectionStatus(this.flow.gitpodHost, status, this.flow.failureCode);
        this.telemetryService.sendUserFlowStatus(status, this.flow);
    }

    sendErrorReport(info: UserFlowTelemetryProperties, err: Error | any, message: string) {
        const properties = {
            gitpodHost: info.gitpodHost,
            userId: info.userId,
            workspaceId: info.workspaceId,
            instanceId: info.instanceId,
        };
        const error = new WrapError(message, err);
        this.telemetryService.sendTelemetryException(error, properties);
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

const telemetryService = new TelemetryService(
    process.env.SEGMENT_KEY!,
    options.machineID,
    process.env.EXT_NAME!,
    process.env.EXT_VERSION!,
    options.host,
    logService
);

const metricsReporter = new LocalSSHMetricsReporter(logService);

const proxy = new WebSocketSSHProxy(options, telemetryService, metricsReporter, logService);
proxy.start().catch(() => {
    // Noop, catch everything in start method pls
});
