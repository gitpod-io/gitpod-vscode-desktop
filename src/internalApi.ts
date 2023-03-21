/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { GitpodClient, GitpodServer, GitpodServiceImpl } from '@gitpod/gitpod-protocol/lib/gitpod-service';
import { JsonRpcProxyFactory } from '@gitpod/gitpod-protocol/lib/messaging/proxy-factory';
import { listen as doListen } from 'vscode-ws-jsonrpc';
import WebSocket, { ErrorEvent } from 'ws';
import ReconnectingWebSocket from 'reconnecting-websocket';
import * as vscode from 'vscode';
import { ILogService } from './logService';

type UsedGitpodFunction = ['getLoggedInUser', 'getWorkspace', 'getOwnerToken', 'getSSHPublicKeys', 'sendHeartBeat'];
type Union<Tuple extends any[], Union = never> = Tuple[number] | Union;
export type GitpodConnection = Omit<GitpodServiceImpl<GitpodClient, GitpodServer>, 'server'> & {
	server: Pick<GitpodServer, Union<UsedGitpodFunction>>;
};

export const unauthorizedErr = 'unauthorized';

class GitpodServerApi extends vscode.Disposable {

	readonly service: GitpodConnection;
	private readonly webSocket: ReconnectingWebSocket;
	private readonly onErrorEmitter = new vscode.EventEmitter<Error>();
	readonly onError = this.onErrorEmitter.event;

	constructor(accessToken: string, serviceUrl: string, readonly logger: ILogService) {
		super(() => this.internalDispose());

		serviceUrl = serviceUrl.replace(/\/$/, '');

		const factory = new JsonRpcProxyFactory<GitpodServer>();
		this.service = new GitpodServiceImpl<GitpodClient, GitpodServer>(factory.createProxy());

		const maxRetries = 3;
		const webSocket = new ReconnectingWebSocket(`${serviceUrl.replace('https', 'wss')}/api/v1`, undefined, {
			maxReconnectionDelay: 10000,
			minReconnectionDelay: 1000,
			reconnectionDelayGrowFactor: 1.5,
			connectionTimeout: 10000,
			maxRetries,
			debug: false,
			startClosed: false,
			WebSocket: class extends WebSocket {
				constructor(address: string, protocols?: string | string[]) {
					super(address, protocols, {
						headers: {
							'Origin': new URL(serviceUrl).origin,
							'Authorization': `Bearer ${accessToken}`,
							'User-Agent': vscode.env.appName,
							'X-Client-Version': vscode.version
						}
					});
				}
			}
		});
		webSocket.onerror = (e: ErrorEvent) => {
			if (webSocket.retryCount >= maxRetries) {
				this.onErrorEmitter.fire(e.error);
			}
		};

		doListen({
			webSocket: (webSocket as any),
			logger: {
				error(m: string) { logger.error(m); },
				warn(m: string) { logger.warn(m); },
				info(m: string) { logger.info(m); },
				log(m: string) { logger.info(m); }
			},
			onConnection: connection => factory.listen(connection),
		});
		this.webSocket = webSocket;
	}

	internalDispose() {
		this.webSocket.close();
		this.onErrorEmitter.dispose();
	}
}

export function withServerApi<T>(accessToken: string, serviceUrl: string, cb: (service: GitpodConnection) => Promise<T>, logger: ILogService): Promise<T> {
	const api = new GitpodServerApi(accessToken, serviceUrl, logger);
	return Promise.race([
		cb(api.service),
		new Promise<T>((_, reject) => api.onError(error => {
			reject(error);
		}))
	]).finally(() => api.dispose());
}
