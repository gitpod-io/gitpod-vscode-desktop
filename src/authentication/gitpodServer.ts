/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { PromiseAdapter, promiseFromEvent } from '../common/event';
import { withServerApi } from '../internalApi';
import pkceChallenge from 'pkce-challenge';
import { v4 as uuid } from 'uuid';
import { Disposable } from '../common/dispose';
import { INotificationService } from '../services/notificationService';
import { UserFlowTelemetryProperties } from '../common/telemetry';
import { ILogService } from '../services/logService';

interface ExchangeTokenResponse {
	token_type: 'Bearer';
	expires_in: number;
	access_token: string;
	refresh_token: string;
	scope: string;
}

async function getUserInfo(token: string, serviceUrl: string, logger: ILogService) {
	const user = await withServerApi(token, serviceUrl, service => service.server.getLoggedInUser(), logger);
	return {
		id: user.id,
		accountName: user.name ?? user.fullName ?? '<unknown>'
	};
}

const ACTION_COPY = "Copy to clipboard";
const ACTION_CANCEL = "Cancel";

export default class GitpodServer extends Disposable {

	public static AUTH_COMPLETE_PATH = '/complete-gitpod-auth';

	private _serviceUrl: string;
	private _pendingStates = new Map<string, string[]>();
	private _pendingVerifiers = new Map<string, string>();
	private _codeExchangePromises = new Map<string, { promise: Promise<string>; cancel: vscode.EventEmitter<void> }>();
	private _uriEmitter = this._register(new vscode.EventEmitter<vscode.Uri>());

	constructor(
		serviceUrl: string,
		private readonly logService: ILogService,
		private readonly notificationService: INotificationService
	) {
		super();

		this._serviceUrl = serviceUrl.replace(/\/$/, '');
	}

	public async login(scopes: string, flow: UserFlowTelemetryProperties): Promise<string> {
		this.logService.info(`Logging in for the following scopes: ${scopes}`);

		const callbackUri = await vscode.env.asExternalUri(vscode.Uri.parse(`${vscode.env.uriScheme}://gitpod.gitpod-desktop/complete-gitpod-auth`));

		const { code_verifier, code_challenge } = pkceChallenge(128);
		const state = uuid();
		const searchParams = new URLSearchParams([
			['response_type', 'code'],
			['client_id', `${vscode.env.uriScheme}-gitpod`],
			['redirect_uri', callbackUri.toString(true)],
			['scope', scopes],
			['state', state],
			['code_challenge', code_challenge],
			['code_challenge_method', 'S256']
		]);

		const uri = `${this._serviceUrl}/api/oauth/authorize?${searchParams.toString()}`;

		const existingStates = this._pendingStates.get(scopes) || [];
		this._pendingStates.set(scopes, [...existingStates, state]);
		this._pendingVerifiers.set(state, code_verifier);

		return vscode.window.withProgress({
			location: vscode.ProgressLocation.Window,
			title: `Signing in to ${this._serviceUrl}...`,
		}, async () => {
			const success = await vscode.env.openExternal(uri as any);
			if (!success) {
				// Handle the case where the extension can't open a browser window
				const action = await vscode.window.showWarningMessage("There was a problem opening the login URL in your browser. Please copy it into your browser manually.", ACTION_COPY, ACTION_CANCEL);
				if (action === ACTION_COPY) {
					await vscode.env.clipboard.writeText(uri);
				} else if (action === ACTION_CANCEL) {
					throw new Error("Signin cancelled by user");
				}
			}

			// Register a single listener for the URI callback, in case the user starts the login process multiple times
			// before completing it.
			let codeExchangePromise = this._codeExchangePromises.get(scopes);
			if (!codeExchangePromise) {
				codeExchangePromise = promiseFromEvent(this._uriEmitter.event, this.exchangeCodeForToken(scopes, flow));
				this._codeExchangePromises.set(scopes, codeExchangePromise);
			}

			return Promise.race([
				codeExchangePromise.promise,
				new Promise<string>((_, reject) => setTimeout(() => reject('Cancelled'), 60000))
			]).finally(() => {
				const states = this._pendingStates.get(scopes);
				if (states) {
					states.forEach(state => this._pendingVerifiers.delete(state));
				}
				this._pendingStates.delete(scopes);
				codeExchangePromise?.cancel.fire();
				this._codeExchangePromises.delete(scopes);
			});
		});
	}

	private exchangeCodeForToken: (scopes: string, flow: UserFlowTelemetryProperties) => PromiseAdapter<vscode.Uri, string> =
		(scopes, flow) => async (uri, resolve, reject) => {
			const query = new URLSearchParams(uri.query);
			const code = query.get('code');
			const state = query.get('state');

			if (!code) {
				this.logService.error('No code in response.');
				return;
			}

			if (!state) {
				this.logService.error('No state in response.');
				return;
			}

			const acceptedStates = this._pendingStates.get(scopes) || [];
			if (!acceptedStates.includes(state)) {
				// A common scenario of this happening is if you:
				// 1. Trigger a sign in with one set of scopes
				// 2. Before finishing 1, you trigger a sign in with a different set of scopes
				// In this scenario we should just return and wait for the next UriHandler event
				// to run as we are probably still waiting on the user to hit 'Continue'
				this.logService.info('Nonce not found in accepted nonces. Skipping this execution...');
				return;
			}

			const verifier = this._pendingVerifiers.get(state);
			if (!verifier) {
				this.logService.error('Code verifier not found in memory.');
				return;
			}

			this.logService.info('Exchanging code for token...');

			const callbackUri = await vscode.env.asExternalUri(vscode.Uri.parse(`${vscode.env.uriScheme}://gitpod.gitpod-desktop${GitpodServer.AUTH_COMPLETE_PATH}`));
			try {
				const exchangeTokenResponse = await fetch(`${this._serviceUrl}/api/oauth/token`, {
					method: 'POST',
					body: new URLSearchParams({
						code,
						grant_type: 'authorization_code',
						client_id: `${vscode.env.uriScheme}-gitpod`,
						redirect_uri: callbackUri.toString(true),
						code_verifier: verifier
					})
				});

				if (!exchangeTokenResponse.ok) {
					this.notificationService.showErrorMessage(`Couldn't connect (token exchange): ${exchangeTokenResponse.statusText}, ${await exchangeTokenResponse.text()}`, { flow, id: 'failed_to_exchange' });
					reject(exchangeTokenResponse.statusText);
					return;
				}

				const exchangeTokenData = (await exchangeTokenResponse.json()) as ExchangeTokenResponse;
				const jwtToken = exchangeTokenData.access_token;
				const accessToken = JSON.parse(Buffer.from(jwtToken.split('.')[1], 'base64').toString())['jti'];
				resolve(accessToken);
			} catch (err) {
				this.notificationService.showErrorMessage(`Couldn't connect (token exchange): ${err}`, { flow, id: 'failed_to_exchange' });
				reject(err);
			}
		};

	public getUserInfo(token: string): Promise<{ id: string; accountName: string }> {
		return getUserInfo(token, this._serviceUrl, this.logService);
	}

	public handleUri(uri: vscode.Uri) {
		this._uriEmitter.fire(uri);
	}

	public override dispose() {
		super.dispose();
		for (const [, { cancel }] of this._codeExchangePromises) {
			cancel.fire();
		}
	}
}
