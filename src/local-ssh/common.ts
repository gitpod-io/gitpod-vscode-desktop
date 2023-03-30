/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import winston from 'winston';
import { tmpdir } from 'os';
import { join } from 'path';
import { GetWorkspaceAuthInfoResponse } from '../proto/typescript/ipc/v1/ipc';

// TODO(local-ssh): default should be different between stable and insiders?
// use `sudo lsof -i:42025` to check if the port is already in use
export const LOCAL_SSH_GATEWAY_SERVER_PORT = 42025;

export enum ExitCode {
	OK = 0,
	ListenPortFailed = 1,
	UnexpectedError = 100,
}

export function exitProcess(code: ExitCode) {
	process.exit(code);
}

export interface ILogger {
	trace(message: string, ...args: any[]): void;
	debug(message: string, ...args: any[]): void;
	info(message: string, ...args: any[]): void;
	warn(message: string, ...args: any[]): void;
	error(error: string | Error, ...args: any[]): void;
}

// TODO(local-ssh): !!!!!!!!!!!!!! winston is **, we should use a better logger
const DefaultLogFormatter = winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true }), winston.format.simple())
export class Logger implements ILogger {
	private logger: winston.Logger = winston.createLogger({
		level: 'debug',
		defaultMeta: { pid: process.pid },
		transports: [
			new winston.transports.File({ format: DefaultLogFormatter, filename: '/tmp/gp-daemon.log', options: { flags: 'a' }, maxsize: 1024 * 1024 * 10 /* 10M */, maxFiles: 2 /* 2 file turns */ }),
			// for debug
			new winston.transports.File({ filename: '/tmp/gp-daemon.' + process.pid + '.log', options: { flags: 'a' }, maxsize: 1024 * 1024 * 10 /* 10M */, maxFiles: 2 /* 2 file turns */ }),
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
