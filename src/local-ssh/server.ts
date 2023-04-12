/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Server as GrpcServer } from 'nice-grpc';
import { WorkspaceAuthInfo, ExitCode, exitProcess, getHostKey } from './common';
import { LocalSSHServiceImpl, startLocalSSHService } from './ipc/localssh';
import { SupervisorSSHTunnel } from './sshTunnel';
import { ILogService } from '../services/logService';
import { SshServer, PortForwardingService, SshClient } from '@microsoft/dev-tunnels-ssh-tcp';
import { NodeStream, SshClientCredentials, SshClientSession, SshSessionConfiguration } from '@microsoft/dev-tunnels-ssh';
import { importKeyBytes } from '@microsoft/dev-tunnels-ssh-keys';
import { parsePrivateKey } from 'sshpk';

export class LocalSSHGatewayServer {
	private localsshService!: LocalSSHServiceImpl;
	private localsshServiceServer?: GrpcServer;
	private server?: SshServer;

	constructor(
		private readonly logger: ILogService,
		private readonly port: number,
	) {
	}

	async authenticateClient(clientUsername: string) {
		const workspaceInfo = await this.localsshService.getWorkspaceAuthInfo(clientUsername);
		const session = await this.tryDirectSSH(workspaceInfo)
		if (!session) {
			return this.getTunnelSSHConfig(workspaceInfo)
		}
		return session
	}

	async startServer() {
		try {
			const keys = await importKeyBytes(getHostKey());
			const config = new SshSessionConfiguration();
			config.addService(PortForwardingService);

			const server = new SshServer(config);
			server.credentials.publicKeys.push(keys);

			server.onSessionOpened((session) => {
				let pipeSession: SshClientSession;
				session.onAuthenticating((e) => {
					e.authenticationPromise = new Promise(async resolve => {
						try {
							pipeSession = await this.authenticateClient(e.username!);
							session.pipe(pipeSession);
							resolve({});
						} catch (e) {
							this.logger.error(e, 'failed to authenticate client');
							resolve(null);
						}
					});
				});
				// const requestCompletion = new PromiseCompletionSource<ChannelOpenMessage>();
				// const channelCompletion = new PromiseCompletionSource<SshChannel>();
				// session.onChannelOpening((e) => {
				// 	requestCompletion.resolve(e.request);
				// 	channelCompletion.resolve(e.channel);
				// });

				// const sessionRequestCompletion = new PromiseCompletionSource<SessionRequestMessage>();
				// session.onRequest((e) => {
				// 	if (e.request instanceof PortForwardRequestMessage) {
				// 		e.isAuthorized = !!e.principal;
				// 	}
				// 	sessionRequestCompletion.resolve(e.request);
				// 	// e.responsePromise = Promise.resolve(new TestSessionRequestSuccessMessage());
				// });
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
		startLocalSSHService(this.localsshService).then(server => {
			this.logger.info('local ssh ipc service started');
			this.localsshServiceServer = server;
		});
	}

	private async tryDirectSSH(workspaceInfo: WorkspaceAuthInfo): Promise<SshClientSession | undefined> {
		const connConfig = {
			host: `${workspaceInfo.workspaceId}.ssh.${workspaceInfo.workspaceHost}`,
			port: 22,
			username: workspaceInfo.workspaceId,
			password: workspaceInfo.ownerToken,
		}
		const config = new SshSessionConfiguration();
		const client = new SshClient(config);
		const session = await client.openSession(connConfig.host, connConfig.port);
		const credentials: SshClientCredentials = { username: connConfig.username, password: connConfig.password };
		const authenticated = await session.authenticate(credentials);
		if (!authenticated) {
			this.logger.error('failed to authenticate/connect with direct ssh');
			return;
		}
		return session;
	}

	private async getTunnelSSHConfig(workspaceInfo: WorkspaceAuthInfo): Promise<SshClientSession> {
		const ssh = new SupervisorSSHTunnel(this.logger, workspaceInfo);
		const connConfig = await ssh.establishTunnel();
		const config = new SshSessionConfiguration();
		const session = new SshClientSession(config);
		session.onAuthenticating((e) => e.authenticationPromise = Promise.resolve({}));
		// we need to convert openssh to pkcs8 since dev-tunnels-ssh not support openssh
		const credentials: SshClientCredentials = { username: connConfig.username, publicKeys: [await importKeyBytes(parsePrivateKey(getHostKey(), 'openssh').toBuffer('pkcs8'))] };
		await session.connect(new NodeStream(connConfig.sock!));
		const ok = await session.authenticate(credentials);
		if (!ok) {
			throw new Error('failed to authenticate');
		}
		return session;
	}

	shutdown() {
		this.server?.dispose();
		this.localsshServiceServer?.shutdown();
	}
}

