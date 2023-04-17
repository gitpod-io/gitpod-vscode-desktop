/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Server as GrpcServer } from 'nice-grpc';
import { WorkspaceAuthInfo, ExitCode, exitProcess, getHostKey } from './common';
import { LocalSSHServiceImpl, startLocalSSHService } from './ipc/localssh';
import { SupervisorSSHTunnel } from './sshTunnel';
import { ILogService } from '../services/logService';
import { SshServer, SshClient } from '@microsoft/dev-tunnels-ssh-tcp';
import { NodeStream, SshClientCredentials, SshClientSession, SshSessionConfiguration } from '@microsoft/dev-tunnels-ssh';
import { importKeyBytes } from '@microsoft/dev-tunnels-ssh-keys';
import { parsePrivateKey } from 'sshpk';
import { PipeExtensions } from './patch/pipeExtension';


// TODO(local-ssh): Remove me after direct ssh works with @microsft/dev-tunnels-ssh
const FORCE_TUNNEL = true;

export class LocalSSHGatewayServer {
	private localsshService!: LocalSSHServiceImpl;
	private localsshServiceServer?: GrpcServer;
	private server?: SshServer;

	constructor(
		private readonly logger: ILogService,
		private readonly port: number,
	) { }

	async authenticateClient(clientUsername: string) {
		const workspaceInfo = await this.localsshService.getWorkspaceAuthInfo(clientUsername).catch(e => {
			this.logger.error(e, 'failed to get workspace auth info');
			throw e;
		});
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

			const server = new SshServer(config);
			server.credentials.publicKeys.push(keys);

			server.onSessionOpened((session) => {
				let pipeSession: SshClientSession;
				session.onAuthenticating((e) => {
					e.authenticationPromise = new Promise((resolve, reject) => {
						this.authenticateClient(e.username!).then(async s => {
							this.logger.info('authenticate with ' + e.username);
							pipeSession = s;
							resolve(new Object());
						}).catch(e => {
							this.logger.error(e, 'failed to authenticate client');
							reject(null);
						});
					});
				});
				session.onClientAuthenticated(() => {
					PipeExtensions.pipeSession(session, pipeSession);
				});
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
		};
		const config = new SshSessionConfiguration();
		const client = new SshClient(config);
		const session = await client.openSession(connConfig.host, connConfig.port);
		session.onAuthenticating((e) => e.authenticationPromise = Promise.resolve({}));
		const credentials: SshClientCredentials = { username: connConfig.username, password: connConfig.password };
		const authenticated = await session.authenticate(credentials);
		if (!authenticated) {
			this.logger.error('failed to authenticate direct ssh');
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
		await session.connect(new NodeStream(connConfig.sock!));
		// we need to convert openssh to pkcs8 since dev-tunnels-ssh not support openssh
		const credentials: SshClientCredentials = { username: connConfig.username, publicKeys: [await importKeyBytes(parsePrivateKey(connConfig.privateKey, 'openssh').toBuffer('pkcs8'))] };
		const ok = await session.authenticate(credentials);
		if (!ok) {
			throw new Error('failed to authenticate tunnel ssh');
		}
		return session;
	}

	shutdown() {
		this.server?.dispose();
		this.localsshServiceServer?.shutdown();
	}
}

