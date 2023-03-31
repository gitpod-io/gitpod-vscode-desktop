/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DaemonOptions } from '../daemonStarter';
import { ILogService } from '../services/logService';
import { ExitCode, exitProcess } from './common';
import { LocalSSHGatewayServer } from './server';
import { Logger } from './logger';

// getOptionsFromArgv can't be in common.ts because it will import vscode
export function getOptionsFromArgv(): DaemonOptions | undefined {
	const args = process.argv.slice(2);
	const options: DaemonOptions = {
		logLevel: args[0] as any,
		serverPort: parseInt(args[1]),
		logFilePath: args[2],
	};
	if (isNaN(options.serverPort) ||
		!['debug', 'info'].includes(options.logLevel) ||
		!options.logFilePath) {
		return;
	}
	return options;
}

export class LocalSSHDaemon {
	private gatewayServer?: LocalSSHGatewayServer;
	private readonly logger!: ILogService;
	private readonly options!: DaemonOptions;
	constructor(
	) {
		const options = getOptionsFromArgv();
		if (!options) {
			exitProcess(ExitCode.InvalidOptions);
			return;
		}
		this.options = options;
		this.logger = new Logger(options.logLevel, options.logFilePath);
		this.startDaemon();
		this.onExit();
		this.onException();
	}

	private startDaemon() {
		// start daemon
		this.logger.info('starting daemon with pid: ' + process.pid);

		// start local-ssh gateway server
		const gatewayServer = new LocalSSHGatewayServer(this.logger, this.options.serverPort);
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

new LocalSSHDaemon();
