/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import winston from 'winston';
import { existsSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { GetWorkspaceAuthInfoResponse } from '../proto/typescript/ipc/v1/ipc';

export const PID_LOCK_FILE = '/tmp/gp-daemon.lock';

export enum ExitCode {
	OK = 0,
	ListenPortFailed = 1,
	UnexpectedError = 100,
}

export function exitProcess(logger: Logger, code: ExitCode, cleanup: boolean = false) {
	if (cleanup) {
		logger.info('exiting...', code);
		if (existsSync(PID_LOCK_FILE)) {
			logger.info('going to unlinking pid lock file');
			unlinkSync(PID_LOCK_FILE);
		}
	}
	process.exit(code);
}

export interface ILogger {
	trace(message: string, ...args: any[]): void;
	debug(message: string, ...args: any[]): void;
	info(message: string, ...args: any[]): void;
	warn(message: string, ...args: any[]): void;
	error(error: string | Error, ...args: any[]): void;
}

// TODO: !!!!!!!!!!!!!! winston is **, we should use a better logger
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
		return `\\\\.\\pipe\\gp-${id}-sock`;
	}
	const p = join(tmpdir(), `gp-${id}.sock`);
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
