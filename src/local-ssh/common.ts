/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import dns from 'dns';
import winston from 'winston';
import { tmpdir } from 'os';
import { join } from 'path';
import { GetWorkspaceAuthInfoResponse } from '../proto/typescript/ipc/v1/ipc';
import { ILogService } from '../services/logService';

// TODO(local-ssh): default should be different between stable and insiders?
// use `sudo lsof -i:42025` to check if the port is already in use
export const LOCAL_SSH_GATEWAY_SERVER_PORT = 42025;

// TODO(local-ssh): default should be different between stable and insiders?
export const DAEMON_LOG_FILE = '/tmp/gp-daemon.log';

export enum ExitCode {
	OK = 0,
	ListenPortFailed = 1,
	UnexpectedError = 100,
}

export function exitProcess(code: ExitCode) {
	process.exit(code);
}

const DefaultLogFormatter = winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true }), winston.format.simple())
export class Logger implements ILogService {
	private logger: winston.Logger = winston.createLogger({
		level: 'debug',
		defaultMeta: { pid: process.pid },
		transports: [
			new winston.transports.File({ format: DefaultLogFormatter, filename: DAEMON_LOG_FILE, options: { flags: 'a' }, maxsize: 1024 * 1024 * 10 /* 10M */, maxFiles: 2 /* 2 file turns */ }),
		],
		exitOnError: false,
	});

	trace(message: string, ...args: any[]): void {
		this.logger.debug(message, ...args);
	}
	debug(message: string, ...args: any[]): void {
		this.logger.debug(message, ...args);
	}
	info(message: string, ...args: any[]): void {
		this.logger.info(message, ...args);
	}
	warn(message: string, ...args: any[]): void {
		this.logger.warn(message, ...args);
	}
	error(error: string | Error, ...args: any[]): void {
		this.logger.error(error as any, ...args);
	}

	show(): void {
		// no-op
	}
}

function getIPCHandlePath(id: string, isAddr: boolean = false): string {
	if (process.platform === 'win32') {
		return `\\\\.\\pipe\\gitpod-vscode--${id}-sock`;
	}
	const p = join(tmpdir(), `gitpod-vscode--${id}.sock`);
	if (isAddr) {
		return 'unix://' + p;
	}
	return p;
}

export function getLocalSSHIPCHandlePath(): string {
	return getIPCHandlePath('localssh');
}

export function getExtensionIPCHandlePath(id: string): string {
	return getIPCHandlePath('ext-' + id);
}

export function getLocalSSHIPCHandleAddr(): string {
	return getIPCHandlePath('localssh', true);
}

export function getExtensionIPCHandleAddr(id: string): string {
	return getIPCHandlePath('ext-' + id, true);
}

export type WorkspaceAuthInfo = GetWorkspaceAuthInfoResponse;


export function isDNSPointToLocalhost(domain: string): Promise<boolean> {
	return new Promise(resolve => {
		dns.lookup('*.' + domain, { all: true }, (err, addresses) => {
			if (err) {
				resolve(false);
			} else {
				console.log(addresses);
				resolve(true);
			}
		});
	});
}

export const GitpodDefaultLocalhost = 'local.hwen.dev';