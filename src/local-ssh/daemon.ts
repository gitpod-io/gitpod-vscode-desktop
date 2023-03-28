/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'fs';
import { ExitCode, exitProcess, Logger, PID_LOCK_FILE } from './common';
import { LocalSSHGatewayServer } from './server';

export class LocalSSHDaemon {
	private gatewayServer?: LocalSSHGatewayServer;
	constructor(
		private readonly logger: Logger,
	) {
		this.startDaemon();
		this.onExit();
		this.onException();
	}

	private startDaemon() {
		if (!this.canRunDaemon()) {
			exitProcess(this.logger, ExitCode.OK, false);
		}
		// start daemon
		this.logger.info('starting daemon with pid: ' + process.pid);
		const pid = process.pid;

		// start local-ssh gateway server
		const gatewayServer = new LocalSSHGatewayServer(this.logger);
		gatewayServer.startServer();
		this.logger.info('local ssh gateway server started');

		this.gatewayServer = gatewayServer;

		fs.writeFileSync(PID_LOCK_FILE, pid.toString());
	}

	private onExit() {
		const exitHandler = async (signal?: NodeJS.Signals) => {
			this.logger.info('exiting signal: ', signal);
			this.gatewayServer?.shutdown();
			exitProcess(this.logger, ExitCode.OK, true);
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

	private async canRunDaemon() {
		if (!fs.existsSync(PID_LOCK_FILE)) {
			return true;
		}
		const pid = fs.readFileSync(PID_LOCK_FILE).toString();
		if (isProcessRunning(Number(pid))) {
			// if (!await tryPingDaemon()) {
			// 	this.logger.info(`daemon pid ${pid} lock file ${LOCAL_SSH_SOCK_UNIX} is existing, but daemon not running, starting a new one`);
			// 	return true;
			// }
			// this.logger.error(`daemon pid ${pid} is still running, not starting a new one`);
			// return false;
			return false;
		} else {
			this.logger.info(`daemon pid ${pid} is not running, starting a new one`);
			fs.unlinkSync(PID_LOCK_FILE);
			return true;
		}
	}
}

function isProcessRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		if (err.code === 'ESRCH') {
			return false;
		}
		return false;
	}
}

// async function tryPingDaemon() {
// 	try {
// 		const client = createClient(LocalSSHServiceDefinition, createChannel(LOCAL_SSH_SOCK_UNIX));
// 		await client.ping({})
// 		return true;
// 	} catch (e) {
// 		return false;
// 	}
// }

new LocalSSHDaemon(new Logger());
