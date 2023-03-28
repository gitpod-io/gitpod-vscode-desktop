/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Client, ConnectConfig, Server } from 'ssh2';
import { Server as GrpcServer } from 'nice-grpc';
import { Logger, WorkspaceAuthInfo, ExitCode, exitProcess } from './common';
import { LocalSSHServiceImpl, startLocalSSHService } from './ipc/localssh';
import { SupervisorSSHTunnel } from './sshTunnel';

// TODO(hw): make it configurable / default should be different between stable and insiders?
const LOCAL_SSH_GATEWAY_SERVER_PORT = 42025;
// TODO(hw): generate one?
const TEST_HOST_KEY = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACAnRE2jO9ALTtj46AqrCGKe6h6nq186QuufTMl0tTZIVAAAAJgU6suzFOrL
swAAAAtzc2gtZWQyNTUxOQAAACAnRE2jO9ALTtj46AqrCGKe6h6nq186QuufTMl0tTZIVA
AAAECaxo8pV52PZg8MEQDzgP/aEAyr2tcJ1c1JX0nSbx7okydETaM70AtO2PjoCqsIYp7q
HqerXzpC659MyXS1NkhUAAAAEWh3ZW5AcG90YWxhLmxvY2FsAQIDBA==
-----END OPENSSH PRIVATE KEY-----`;

export class LocalSSHGatewayServer {
	private localsshService!: LocalSSHServiceImpl;
	private localsshServiceServer?: GrpcServer;
	constructor(
		private readonly logger: Logger,
	) { }

	public startServer() {
		const server = new Server({
			ident: 'gitpod-local',
			hostKeys: [TEST_HOST_KEY],
			debug: (debug) => {
				this.logger.debug(debug);
			}
		}, (client) => {
			this.logger.info('client connected');
			let workspaceInfo: WorkspaceAuthInfo;
			let conn: Client;
			client
				.on('authentication', async (ctx) => {
					const workspaceID = ctx.username;
					try {
						this.logger.info('trying to get auth of ' + workspaceID);
						workspaceInfo = await this.localsshService.getWorkspaceAuthInfo(workspaceID);
						try {
							// throw new Error('test force tunnel');
							conn = await this.connectSSH(this.getDirectSSHConfig(workspaceInfo));
						} catch (e) {
							e.message = 'failed to connect to workspace via ssh: ' + e.message + ' trying to connect via tunnel';
							this.logger.error(e);
							conn = await this.connectSSH(await this.getTunnelSSHConfig(workspaceInfo));
						}
						this.logger.info(JSON.stringify(workspaceInfo, null, 4));
						ctx.accept();
					} catch (e) {
						this.logger.error('failed to get workspace auth info of id:' + workspaceID, e);
						ctx.reject(e);
					}
				})
				.on('ready', async () => {
					client.on('session', async (accept) => {
						const session = accept();
						session.on('shell', (accept) => {
							const stream = accept();
							conn.shell(false, (err, s) => {
								if (err) { throw err; }
								s.on('close', (code: number, signal: string) => {
									this.logger.debug('Stream :: close :: code: ' + code + ', signal: ' + signal);
								});
								stream.stdin.pipe(s.stdin);
								s.pipe(stream);
								s.stderr.pipe(stream.stderr);
							});
						});
					});
					client.on('tcpip', async (accept, _reject, info) => {
						this.logger.info('tcpip', info);
						const stream = accept();
						conn.forwardOut(info.srcIP, info.srcPort, info.destIP, info.destPort, (err, s) => {
							if (err) {
								throw err;
							}
							s.on('close', (code: number, signal: string) => {
								this.logger.debug('Stream :: close :: code: ' + code + ', signal: ' + signal);
							});
							stream.pipe(s).pipe(stream);
						});
					});
				})
				.on('close', () => {
					this.logger.info('client disconnected');
				});
		});
		server.on('error', (err: any) => {
			this.logger.error(err, 'failed to start local ssh gateway server, going to exit');
			exitProcess(this.logger, ExitCode.ListenPortFailed, false);
		});
		server.listen(LOCAL_SSH_GATEWAY_SERVER_PORT, '127.0.0.1', () => {
			this.logger.info('local ssh gateway is listening on port ' + LOCAL_SSH_GATEWAY_SERVER_PORT);
			// start local-ssh ipc service
			this.localsshService = new LocalSSHServiceImpl(this.logger);
			startLocalSSHService(this.localsshService).then(server => {
				this.logger.info('local ssh ipc service started');
				this.localsshServiceServer = server;
			});
		});
	}

	private async connectSSH(connectConfig: ConnectConfig) {
		const client = new Client();
		const conn = client.connect(connectConfig);
		const ready = new Promise((resolve, reject) => {
			conn.on('ready', () => {
				this.logger.info('connect to remote host');
				resolve(true);
			});
			conn.on('error', (e) => {
				reject(e);
			});
		});
		await ready;
		return conn;
	}

	private getDirectSSHConfig(workspaceInfo: WorkspaceAuthInfo): ConnectConfig {
		return {
			host: `${workspaceInfo.workspaceId}.ssh.${workspaceInfo.workspaceHost}`,
			port: 22,
			username: workspaceInfo.workspaceId,
			password: workspaceInfo.ownerToken,
		};
	}

	private async getTunnelSSHConfig(workspaceInfo: WorkspaceAuthInfo): Promise<ConnectConfig> {
		const ssh = new SupervisorSSHTunnel(this.logger, workspaceInfo);
		return ssh.establishTunnel();
	}

	shutdown() {
		this.localsshServiceServer?.shutdown();
	}
}

