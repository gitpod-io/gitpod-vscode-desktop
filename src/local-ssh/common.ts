/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import dns from 'dns';
import { tmpdir } from 'os';
import { join } from 'path';
import { GetWorkspaceAuthInfoResponse } from '../proto/typescript/ipc/v1/ipc';
import { ILogService } from '../services/logService';

// This public key is safe to be public since we only use it to verify local-ssh connections.
const HOST_KEY = 'LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0tCk1JR0hBZ0VBTUJNR0J5cUdTTTQ5QWdFR0NDcUdTTTQ5QXdFSEJHMHdhd0lCQVFRZ1QwcXg1eEJUVmc4TUVJbUUKZmN4RXRZN1dmQVVsM0JYQURBK2JYREsyaDZlaFJBTkNBQVJlQXo0RDVVZXpqZ0l1SXVOWXpVL3BCWDdlOXoxeApvZUN6UklqcGdCUHozS0dWRzZLYXV5TU5YUm95a21YSS9BNFpWaW9nd2Vjb0FUUjRUQ2FtWm1ScAotLS0tLUVORCBQUklWQVRFIEtFWS0tLS0tCg==';
export function getHostKey(): Buffer {
	return Buffer.from(HOST_KEY, 'base64');
}

export enum ExitCode {
	OK = 0,
	ListenPortFailed = 100,
	UnexpectedError = 101,
	InvalidOptions = 102,
}

export function exitProcess(code: ExitCode) {
	setTimeout(() => {
		process.exit(code);
	}, 1000);
}

export interface DaemonOptions {
	logLevel: 'debug' | 'info';
	serverPort: number;
	sockFileTail: string;

	// TODO(local-ssh): Log file path use `globalStorageUri`? https://code.visualstudio.com/api/extension-capabilities/common-capabilities#:~:text=ExtensionContext.globalStorageUri%3A%20A%20global%20storage%20URI%20pointing%20to%20a%20local%20directory%20where%20your%20extension%20has%20read/write%20access.%20This%20is%20a%20good%20option%20if%20you%20need%20to%20store%20large%20files%20that%20are%20accessible%20from%20all%20workspaces
	logFilePath: string;
}

export function getSockTail(appName: string): string {
	// TODO(local-ssh): VSCodium?
	return appName.includes('Insiders') ? 'insiders' : '';
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

export function getLocalSSHIPCHandlePath(tail: string): string {
	return getIPCHandlePath('localssh' + tail);
}

export function getExtensionIPCHandlePath(id: string): string {
	return getIPCHandlePath('ext-' + id);
}

export function getLocalSSHIPCHandleAddr(tail: string): string {
	return getIPCHandlePath('localssh' + tail, true);
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

export function getRunningExtensionVersion() {
	return process.env.DAEMON_EXTENSION_VERSION ?? 'unknown';
}

export function getDaemonVersion() {
	return process.env.DAEMON_VERSION ?? 'unknown';
}