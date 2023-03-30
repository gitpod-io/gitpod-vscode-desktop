/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExitCode, exitProcess, LOCAL_SSH_GATEWAY_SERVER_PORT, Logger } from './common';
import { LocalSSHGatewayServer } from './server';

export class LocalSSHDaemon {
	private gatewayServer?: LocalSSHGatewayServer;
	constructor(
		private readonly logger: Logger,
		private readonly sshServerPort: number,
	) {
		this.startDaemon();
		this.onExit();
		this.onException();
	}

	private startDaemon() {
		// start daemon
		this.logger.info('starting daemon with pid: ' + process.pid);

		// start local-ssh gateway server
		const gatewayServer = new LocalSSHGatewayServer(this.logger, this.sshServerPort);
		gatewayServer.startServer();
		this.logger.info('local ssh gateway server started');

		this.gatewayServer = gatewayServer;
	}

	private onExit() {
		const exitHandler = async (signal?: NodeJS.Signals) => {
			this.logger.info('exiting signal: ', signal);
			this.gatewayServer?.shutdown();
			exitProcess(ExitCode.OK);
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
}

const port = process.argv[2] ? parseInt(process.argv[2]) : LOCAL_SSH_GATEWAY_SERVER_PORT;

new LocalSSHDaemon(new Logger(), port);
