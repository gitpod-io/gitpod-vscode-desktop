/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../services/logService';
import { getDaemonVersion, getHostKey } from './common';
import { SupervisorSSHTunnel } from './sshTunnel';
import { SshClient } from '@microsoft/dev-tunnels-ssh-tcp';
import { NodeStream, SshClientCredentials, SshClientSession, SshDisconnectReason, SshServerSession, SshSessionConfiguration } from '@microsoft/dev-tunnels-ssh';
import { importKeyBytes } from '@microsoft/dev-tunnels-ssh-keys';
import { parsePrivateKey } from 'sshpk';
import { ExtensionServiceDefinition, GetWorkspaceAuthInfoResponse, SendErrorReportRequest, SendLocalSSHUserFlowStatusRequest_Code, SendLocalSSHUserFlowStatusRequest_ConnType, SendLocalSSHUserFlowStatusRequest_Status } from '../proto/typescript/ipc/v1/ipc';
import { Logger } from './logger';
import { Client, ClientError, Status, createChannel, createClient } from 'nice-grpc';
import { retryWithStop } from '../common/async';

interface ClientOptions {
    host: string;
    extIpcPort: number;
    logPath: string;
}

function getClientOptions(): ClientOptions {
    const args = process.argv.slice(2);
    return {
        host: args[0],
        extIpcPort: Number.parseInt(args[1]),
        logPath: args[2],
    };
}

// TODO(local-ssh): Remove me after direct ssh works with @microsft/dev-tunnels-ssh
const FORCE_TUNNEL = true;

export class LocalSSHClient {
    private readonly logger!: ILogService;
    private readonly options!: ClientOptions;

    private extensionIpc!: Client<ExtensionServiceDefinition>;
    private serverSession?: SshServerSession;

    constructor(
    ) {
        const options = getClientOptions();
        if (!options) {
            process.exit(0);
        }
        this.options = options;
        this.logger = new Logger('info', options.logPath);
        this.logger.info('client started with options: ', options);
        this.onExit();
        this.onException();
        this.startServer().then().catch(err => {
            this.logger.error(err);
        });
        this.extensionIpc = createClient(ExtensionServiceDefinition, createChannel('127.0.0.1:' + this.options.extIpcPort));
    }

    private onExit() {
        const exitHandler = async (signal?: NodeJS.Signals) => {
            this.logger.info('exiting signal: ', signal);
            process.exit(0);
        };
        process.on('SIGINT', exitHandler);
        process.on('SIGTERM', exitHandler);
    }

    private onException() {
        process.on('uncaughtException', (err) => {
            this.logger.error('uncaughtException', err);
        });
        process.on('unhandledRejection', (err) => {
            this.logger.error('unhandledRejection', err as any);
        });
    }
    private async authenticateClient(username: string) {
        const workspaceInfo = await this.retryGetWorkspaceInfo(username);
        if (FORCE_TUNNEL) {
            this.logger.info('force tunnel');
            return this.getTunnelSSHConfig(workspaceInfo);
        }
        const session = await this.tryDirectSSH(workspaceInfo);
        if (!session) {
            this.logger.error('failed to connect with direct ssh, going to try tunnel');
            return this.getTunnelSSHConfig(workspaceInfo);
        }
        return session;
    }

    async startServer() {
        try {
            const keys = await importKeyBytes(getHostKey());
            const config = new SshSessionConfiguration();
            const session = new SshServerSession(config);
            session.credentials.publicKeys.push(keys);

            let pipeSession: SshClientSession;
            session.onAuthenticating((e) => {
                e.authenticationPromise = this.authenticateClient(e.username!).then(s => {
                    this.logger.info('authenticate with ', e.username);
                    pipeSession = s;
                    return {};
                }).catch(e => {
                    this.logger.error(e, 'failed to authenticate client');
                    session.close(SshDisconnectReason.hostNotAllowedToConnect, 'auth failed or workspace is not running');
                    return null;
                });
            });
            session.onClientAuthenticated(async () => {
                try {
                    await session.pipe(pipeSession);
                } catch (e) {
                    this.logger.error(e, 'pipe session ended with error');
                } finally {
                    session.close(SshDisconnectReason.connectionLost, 'pipe session ended');
                }
            });
            session.onClosed(() => {
                process.exit(0);
            });
            this.serverSession = session;
            session.connect(new NodeStream(process.stdin, process.stdout));
        } catch (e) {
            this.logger.error(e, 'failed to start local ssh gateway server, going to exit');
            process.exit(0);
        }
    }

    private async tryDirectSSH(workspaceInfo: GetWorkspaceAuthInfoResponse): Promise<SshClientSession | undefined> {
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
                throw new Error('failed to authenticate');
            }
            return session;
        } catch (e) {
            this.logger.error(e, 'failed to connect with direct ssh');
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
        }
        return;
    }

    private async getTunnelSSHConfig(workspaceInfo: GetWorkspaceAuthInfoResponse): Promise<SshClientSession> {
        try {
            const ssh = new SupervisorSSHTunnel(this.logger, workspaceInfo, this.extensionIpc);
            const connConfig = await ssh.establishTunnel();
            const config = new SshSessionConfiguration();
            const session = new SshClientSession(config);
            session.onAuthenticating((e) => e.authenticationPromise = Promise.resolve({}));
            await session.connect(new NodeStream(connConfig.sock!));
            // we need to convert openssh to pkcs8 since dev-tunnels-ssh not support openssh
            const credentials: SshClientCredentials = { username: connConfig.username, publicKeys: [await importKeyBytes(parsePrivateKey(connConfig.privateKey, 'openssh').toBuffer('pkcs8'))] };
            const ok = await session.authenticate(credentials);
            if (!ok) {
                throw new Error('failed to authenticate tunnel ssh');
            }
            return session;
        } catch (e) {
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

    shutdown() {
        this.serverSession?.close(SshDisconnectReason.connectionLost, 'shutdown');
    }

    async retryGetWorkspaceInfo(username: string) {
        return retryWithStop(async (stop) => {
            return await this.extensionIpc.getWorkspaceAuthInfo({ workspaceId: username, gitpodHost: this.options.host }).catch(e => {
                if (e instanceof ClientError) {
                    if (e.code === Status.UNAVAILABLE && e.details.startsWith('workspace is not running')) {
                        stop();
                    }
                }
                /*
                TODO not sure how to get gitpodhost here, probably unauthorized should always go to gitpod.io
                this.localsshService.sendTelemetry({
                    status: SendLocalSSHUserFlowStatusRequest_Status.STATUS_FAILURE,
                    workspaceId: clientUsername,
                    instanceId: '',
                    failureCode: SendLocalSSHUserFlowStatusRequest_Code.CODE_NO_WORKSPACE_AUTO_INFO,
                    // TODO remove, and report to error reporting
                    daemonVersion: getDaemonVersion(),
                    extensionVersion: getRunningExtensionVersion(),
                    connType: SendLocalSSHUserFlowStatusRequest_ConnType.CONN_TYPE_UNSPECIFIED,
                });*/
                this.logger.error(e, 'failed to get workspace auth info for workspace: ' + username + ' host: ' + this.options.host);
                throw e;
            });
        }, 200, 10);
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
            this.logger.error(e, 'failed to send error report');
        }
    }
}

new LocalSSHClient();
