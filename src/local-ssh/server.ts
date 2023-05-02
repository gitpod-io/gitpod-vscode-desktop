/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Server as GrpcServer } from 'nice-grpc';
import { ExitCode, exitProcess, getHostKey, getDaemonVersion, getRunningExtensionVersion } from './common';
import { LocalSSHServiceImpl, startLocalSSHService } from './ipc/localssh';
import { WebSocket } from 'ws';
import { BrowserHeaders } from 'browser-headers';
import { ILogService } from '../services/logService';
import { SshServer, SshClient } from '@microsoft/dev-tunnels-ssh-tcp';
import { SshClientCredentials, SshClientSession, SshDisconnectReason, SshSessionConfiguration, Stream, WebSocketStream } from '@microsoft/dev-tunnels-ssh';
import { importKeyBytes, importKey } from '@microsoft/dev-tunnels-ssh-keys';
import { GetWorkspaceAuthInfoResponse, SendLocalSSHUserFlowStatusRequest_Code, SendLocalSSHUserFlowStatusRequest_ConnType, SendLocalSSHUserFlowStatusRequest_Status } from '../proto/typescript/ipc/v1/ipc';
import { CreateSSHKeyPairRequest } from '@gitpod/supervisor-api-grpcweb/lib/control_pb';
import { ControlServiceClient } from '@gitpod/supervisor-api-grpcweb/lib/control_pb_service';
import { NodeHttpTransport } from '@improbable-eng/grpc-web-node-http-transport';
import * as ssh2 from 'ssh2';
import { ParsedKey } from 'ssh2-streams';
import { PipeExtensions } from './patch/pipeExtension';

// TODO(local-ssh): Remove me after direct ssh works with @microsft/dev-tunnels-ssh
const FORCE_TUNNEL = true;

export class LocalSSHGatewayServer {
	private localsshService!: LocalSSHServiceImpl;
	private localsshServiceServer?: GrpcServer;
	private server?: SshServer;
	private clientCount = 0;

	constructor(
		private readonly logger: ILogService,
		private readonly port: number,
		private readonly ipcPort: number,
	) { }

	private async authenticateClient(clientUsername: string) {
		const workspaceInfo = await this.localsshService.getWorkspaceAuthInfo(clientUsername).catch(e => {
			this.logger.error(e, 'failed to get workspace auth info');
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
			throw e;
		});
		if (FORCE_TUNNEL) {
			this.logger.info('force tunnel');
			return this.getTunnelSSHConfig(workspaceInfo);
		}

		try {
			const session = await this.tryDirectSSH(workspaceInfo);
			return session;
		} catch (e) {
			this.logger.error('failed to connect with direct ssh, going to try tunnel');
			return this.getTunnelSSHConfig(workspaceInfo);
		}
	}

	async startServer() {
		try {
			const keys = await importKeyBytes(getHostKey());
			const config = new SshSessionConfiguration();

			const server = new SshServer(config);
			server.credentials.publicKeys.push(keys);

			server.onSessionOpened((session) => {
				let pipeSession: SshClientSession;
				this.clientCount += 1;
				session.onAuthenticating((e) => {
					e.authenticationPromise = this.authenticateClient(e.username!)
						.then(s => {
							this.logger.info('authenticate with ' + e.username);
							pipeSession = s;
							return {};
						}).catch(e => {
							this.logger.error(e, 'failed to authenticate client');
							// TODO not sure how to get gitpod host here
							// this.localsshService.sendErrorReport(e.username, undefined, e, 'failed to authenticate client');
							session.close(SshDisconnectReason.hostNotAllowedToConnect, 'auth failed or workspace is not running');
							return null;
						});
				});
				session.onClientAuthenticated(async () => {
					try {
						await PipeExtensions.pipeSession(session, pipeSession);
					} catch (e) {
						this.logger.error(e, 'pipe session ended with error');
					} finally {
						session.close(SshDisconnectReason.connectionLost, 'pipe session ended');
					}
				});
				session.onClosed(() => {
					this.clientCount -= 1;
					this.logger.debug('current connecting client count: ' + this.clientCount);
				});
			});
			server.onError((e) => {
				this.logger.error(e, 'server error');
			});
			await server.acceptSessions(this.port, '127.0.0.1');
			this.server = server;
			this.logger.info('local ssh gateway is listening on port ' + this.port);
			this.startLocalSSHService();
		} catch (e) {
			this.logger.error(e, 'failed to start local ssh gateway server, going to exit');
			exitProcess(ExitCode.ListenPortFailed);
		}
	}

	private startLocalSSHService() {
		// start local-ssh ipc service
		this.localsshService = new LocalSSHServiceImpl(this.logger);
		startLocalSSHService(this.logger, this.ipcPort, this.localsshService).then(server => {
			this.logger.info('local ssh ipc service started');
			this.localsshServiceServer = server;
		});
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
				throw new Error('failed to authenticate');
			}
			return session;
		} catch (e) {
			this.logger.error(e, 'failed to connect with direct ssh');
			this.localsshService.sendErrorReport(workspaceInfo.gitpodHost, workspaceInfo.userId, workspaceInfo.workspaceId, workspaceInfo.instanceId, e, 'failed to connect with direct ssh');
			this.localsshService.sendTelemetry({
				gitpodHost: workspaceInfo.gitpodHost,
				userId: workspaceInfo.userId,
				status: SendLocalSSHUserFlowStatusRequest_Status.STATUS_FAILURE,
				workspaceId: workspaceInfo.workspaceId,
				instanceId: workspaceInfo.instanceId,
				failureCode: SendLocalSSHUserFlowStatusRequest_Code.CODE_SSH_CANNOT_CONNECT,
				daemonVersion: getDaemonVersion(),
				extensionVersion: getRunningExtensionVersion(),
				connType: SendLocalSSHUserFlowStatusRequest_ConnType.CONN_TYPE_SSH,
			});
			throw e;
		}
	}

	private async getTunnelSSHConfig(workspaceInfo: GetWorkspaceAuthInfoResponse): Promise<SshClientSession> {
		const publicKey = await this.getWorkspaceSSHKey(workspaceInfo)
			.catch(e => {
				this.localsshService.sendTelemetry({
					gitpodHost: workspaceInfo.gitpodHost,
					userId: workspaceInfo.userId,
					status: SendLocalSSHUserFlowStatusRequest_Status.STATUS_FAILURE,
					workspaceId: workspaceInfo.workspaceId,
					instanceId: workspaceInfo.instanceId,
					failureCode: SendLocalSSHUserFlowStatusRequest_Code.CODE_TUNNEL_NO_PRIVATEKEY,
					daemonVersion: getDaemonVersion(),
					extensionVersion: getRunningExtensionVersion(),
					connType: SendLocalSSHUserFlowStatusRequest_ConnType.CONN_TYPE_TUNNEL,
				});
				throw e;
			});


		const workspaceWSUrl = `wss://${workspaceInfo.workspaceId}.${workspaceInfo.workspaceHost}`;
		const socket = new WebSocket(workspaceWSUrl + '/_supervisor/tunnel2', undefined, {
			headers: {
				'x-gitpod-owner-token': workspaceInfo.ownerToken
			}
		});
		socket.binaryType = 'arraybuffer';

		const stream = await new Promise<Stream>((resolve, reject) => {
			socket.onopen = () => resolve(new WebSocketStream(socket as any));
			socket.onerror = (e) => reject(e);
		}).catch(e => {
			this.localsshService.sendTelemetry({
				gitpodHost: workspaceInfo.gitpodHost,
				userId: workspaceInfo.userId,
				status: SendLocalSSHUserFlowStatusRequest_Status.STATUS_FAILURE,
				workspaceId: workspaceInfo.workspaceId,
				instanceId: workspaceInfo.instanceId,
				failureCode: SendLocalSSHUserFlowStatusRequest_Code.CODE_TUNNEL_CANNOT_CREATE_WEBSOCKET,
				daemonVersion: getDaemonVersion(),
				extensionVersion: getRunningExtensionVersion(),
				connType: SendLocalSSHUserFlowStatusRequest_ConnType.CONN_TYPE_TUNNEL,
			});
			throw e;
		});

		try {
			const config = new SshSessionConfiguration();
			const session = new SshClientSession(config);
			session.onAuthenticating((e) => e.authenticationPromise = Promise.resolve({}));
			await session.connect(stream);

			const credentials: SshClientCredentials = { username: 'gitpod', publicKeys: [publicKey] };
			const authenticated = await session.authenticate(credentials);
			if (!authenticated) {
				throw new Error('Authentication failed');
			}
			return session;
		} catch (e) {
			this.localsshService.sendErrorReport(workspaceInfo.gitpodHost, workspaceInfo.userId, workspaceInfo.workspaceId, workspaceInfo.instanceId, e, 'failed to connect with tunnel ssh');
			this.localsshService.sendTelemetry({
				gitpodHost: workspaceInfo.gitpodHost,
				userId: workspaceInfo.userId,
				status: SendLocalSSHUserFlowStatusRequest_Status.STATUS_FAILURE,
				workspaceId: workspaceInfo.workspaceId,
				instanceId: workspaceInfo.instanceId,
				failureCode: SendLocalSSHUserFlowStatusRequest_Code.CODE_TUNNEL_NO_ESTABLISHED_CONNECTION,
				daemonVersion: getDaemonVersion(),
				extensionVersion: getRunningExtensionVersion(),
				connType: SendLocalSSHUserFlowStatusRequest_ConnType.CONN_TYPE_TUNNEL,
			});
			throw e;
		}
	}

	private async getWorkspaceSSHKey(workspaceInfo: GetWorkspaceAuthInfoResponse) {
		const workspaceUrl = `https://${workspaceInfo.workspaceId}.${workspaceInfo.workspaceHost}`;
		const metadata = new BrowserHeaders();
		metadata.append('x-gitpod-owner-token', workspaceInfo.ownerToken);
		const client = new ControlServiceClient(`${workspaceUrl}/_supervisor/v1`, { transport: NodeHttpTransport() });

		const privateKey = await new Promise<string>((resolve, reject) => {
			client.createSSHKeyPair(new CreateSSHKeyPairRequest(), metadata, (err, resp) => {
				if (err) {
					return reject(err);
				}
				resolve(resp!.toObject().privateKey);
			});
		});

		const parsedResult = ssh2.utils.parseKey(privateKey);
		if (parsedResult instanceof Error || !parsedResult) {
			throw new Error('Error while parsing workspace SSH private key');
		}

		return importKey((parsedResult as ParsedKey).getPrivatePEM());
	}

	shutdown() {
		this.server?.dispose();
		this.localsshServiceServer?.shutdown();
	}
}
