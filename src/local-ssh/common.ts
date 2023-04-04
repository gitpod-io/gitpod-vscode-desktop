/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import dns from 'dns';
import { tmpdir } from 'os';
import { join } from 'path';
import { GetWorkspaceAuthInfoResponse } from '../proto/typescript/ipc/v1/ipc';
import { ILogService } from '../services/logService';

export enum ExitCode {
	OK = 0,
	ListenPortFailed = 100,
	UnexpectedError = 101,
	InvalidOptions = 102,
}

export function exitProcess(code: ExitCode) {
	process.exit(code);
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


export function isDNSPointToLocalhost(logService: ILogService, domain: string): Promise<boolean> {
	return new Promise(resolve => {
		dns.lookup(domain, { all: true }, (err, addresses) => {
			if (err) {
				resolve(false);
			} else {
				for (const addr of addresses) {
					if ((addr.family === 4 && addr.address === '127.0.0.1') || (addr.family === 6 && addr.address === '::1')) {
						resolve(true);
						return;
					}
				}
				logService.warn('current domain is not point to localhost', domain, addresses);
				resolve(false);
			}
		});
	});
}

export function isDomainConnectable(logService: ILogService, domain: string): Promise<boolean> {
	return new Promise(resolve => {
		dns.lookup(domain, (err, _address) => {
			if (err) {
				logService.warn('current domain is not connectable', domain, err);
				resolve(false);
			} else {
				resolve(true);
			}
		});
	});
}

export const GitpodDefaultLocalhost = 'lssh.gitpod.io';