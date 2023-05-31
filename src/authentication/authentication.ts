/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { v4 as uuid } from 'uuid';
import Keychain from '../common/keychain';
import GitpodServer from './gitpodServer';
import { arrayEquals } from '../common/utils';
import { Disposable } from '../common/dispose';
import { ITelemetryService, UserFlowTelemetryProperties } from '../services/telemetryService';
import { INotificationService } from '../services/notificationService';
import { ILogService } from '../services/logService';
import { Configuration } from '../configuration';

interface SessionData {
	id: string;
	account?: {
		label?: string;
		displayName?: string;
		id: string;
	};
	scopes: string[];
	accessToken: string;
}

export default class GitpodAuthenticationProvider extends Disposable implements vscode.AuthenticationProvider {
	private _sessionChangeEmitter = new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();

	private _gitpodServer!: GitpodServer;
	private _keychain!: Keychain;
	private _serviceUrl!: string;

	private _sessionsPromise: Promise<vscode.AuthenticationSession[]>;

	private readonly flow = { flow: 'auth' } as Readonly<UserFlowTelemetryProperties>;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly logService: ILogService,
		private readonly telemetryService: ITelemetryService,
		private readonly notificationService: INotificationService
	) {
		super();

		this.reconcile();
		this._register(vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('gitpod.host')) {
				this.reconcile();
				this.checkForUpdates();
			}
		}));

		// Contains the current state of the sessions we have available.
		this._sessionsPromise = this.readSessions();

		this._register(vscode.authentication.registerAuthenticationProvider('gitpod', 'Gitpod', this, { supportsMultipleAccounts: false }));
		this._register(this.context.secrets.onDidChange(() => this.checkForUpdates()));
	}

	private reconcile(): void {
		const gitpodHost = Configuration.getGitpodHost();
		const gitpodHostUrl = new URL(gitpodHost);
		this._serviceUrl = gitpodHostUrl.toString().replace(/\/$/, '');
		Object.assign(this.flow, { gitpodHost: this._serviceUrl });
		this._gitpodServer?.dispose();
		this._gitpodServer = new GitpodServer(this._serviceUrl, this.logService, this.notificationService);
		this._keychain = new Keychain(this.context, `gitpod.auth.${gitpodHostUrl.hostname}`, this.logService);
		this.logService.info(`Started authentication provider for ${gitpodHost}`);
	}

	get onDidChangeSessions() {
		return this._sessionChangeEmitter.event;
	}

	async getSessions(scopes?: string[]): Promise<vscode.AuthenticationSession[]> {
		// For the Gitpod scope list, order doesn't matter so we immediately sort the scopes
		const sortedScopes = scopes?.sort() || [];
		const validScopes = await this.fetchValidScopes();
		const sortedFilteredScopes = sortedScopes.filter(s => !validScopes || validScopes.includes(s));
		this.logService.info(`Getting sessions for ${sortedScopes.length ? sortedScopes.join(',') : 'all scopes'}${sortedScopes.length !== sortedFilteredScopes.length ? `, but valid scopes are ${sortedFilteredScopes.join(',')}` : ''}...`);
		if (sortedScopes.length !== sortedFilteredScopes.length) {
			this.logService.warn(`But valid scopes are ${sortedFilteredScopes.join(',')}, returning session with only valid scopes...`);
		}
		const sessions = await this._sessionsPromise;
		const finalSessions = sortedFilteredScopes.length
			? sessions.filter(session => arrayEquals([...session.scopes].sort(), sortedFilteredScopes))
			: sessions;

		this.logService.info(`Got ${finalSessions.length} sessions for ${sortedFilteredScopes?.join(',') ?? 'all scopes'}...`);
		return finalSessions;
	}

	private _validScopes: string[] | undefined;
	private async fetchValidScopes(): Promise<string[] | undefined> {
		if (this._validScopes) {
			return this._validScopes;
		}

		const endpoint = `${this._serviceUrl}/api/oauth/inspect?client=${vscode.env.uriScheme}-gitpod`;
		try {
			const controller = new AbortController();
			setTimeout(() => controller.abort(), 1500);
			const resp = await fetch(endpoint, { signal: controller.signal });
			if (resp.ok) {
				this._validScopes = (await resp.json()) as string[];
				return this._validScopes;
			}
		} catch (e) {
			this.logService.error(`Error fetching endpoint ${endpoint}`, e);
		}
		return undefined;
	}

	private async checkForUpdates() {
		const previousSessions = await this._sessionsPromise;
		this._sessionsPromise = this.readSessions();
		const storedSessions = await this._sessionsPromise;

		const added: vscode.AuthenticationSession[] = [];
		const removed: vscode.AuthenticationSession[] = [];

		storedSessions.forEach(session => {
			const matchesExisting = previousSessions.some(s => s.id === session.id);
			// Another window added a session to the keychain, add it to our state as well
			if (!matchesExisting) {
				this.logService.info('Adding session found in keychain');
				added.push(session);
			}
		});

		previousSessions.forEach(session => {
			const matchesExisting = storedSessions.some(s => s.id === session.id);
			// Another window has logged out, remove from our state
			if (!matchesExisting) {
				this.logService.info('Removing session no longer found in keychain');
				removed.push(session);
			}
		});

		if (added.length || removed.length) {
			this._sessionChangeEmitter.fire({ added, removed, changed: [] });
		}
	}

	private async readSessions(): Promise<vscode.AuthenticationSession[]> {
		let sessionData: SessionData[];
		try {
			this.logService.info('Reading sessions from keychain...');
			const storedSessions = await this._keychain.getToken();
			if (!storedSessions) {
				return [];
			}
			this.logService.info('Got stored sessions!');

			try {
				sessionData = JSON.parse(storedSessions);
			} catch (e) {
				await this._keychain.deleteToken();
				throw e;
			}
		} catch (e) {
			this.logService.error(`Error reading token: ${e}`);
			return [];
		}

		const sessionPromises = sessionData.map(async (session: SessionData) => {
			// For the Gitpod scope list, order doesn't matter so we immediately sort the scopes
			const sortedScopes = session.scopes.sort();
			const scopesStr = sortedScopes.join(' ');

			let userInfo: { id: string; accountName: string } | undefined;
			try {
				userInfo = await this._gitpodServer.getUserInfo(session.accessToken);
				this.logService.info(`Verified session with the following scopes: ${scopesStr}`);
			} catch (e) {
				// Remove sessions that return unauthorized response
				if (e.message === 'Unexpected server response: 401') {
					return undefined;
				}
				this.logService.error(`Error while verifying session with the following scopes: ${scopesStr}`, e);
			}

			this.logService.trace(`Read the following session from the keychain with the following scopes: ${scopesStr}`);
			return {
				id: session.id,
				account: {
					label: session.account
						? session.account.label ?? session.account.displayName ?? '<unknown>'
						: userInfo?.accountName ?? '<unknown>',
					id: session.account?.id ?? userInfo?.id ?? '<unknown>'
				},
				scopes: sortedScopes,
				accessToken: session.accessToken
			};
		});

		const verifiedSessions = (await Promise.allSettled(sessionPromises))
			.filter(p => p.status === 'fulfilled')
			.map(p => (p as PromiseFulfilledResult<vscode.AuthenticationSession | undefined>).value)
			.filter(<T>(p?: T): p is T => Boolean(p));

		this.logService.info(`Got ${verifiedSessions.length} verified sessions.`);
		if (verifiedSessions.length !== sessionData.length) {
			await this.storeSessions(verifiedSessions);
		}

		return verifiedSessions;
	}

	private async storeSessions(sessions: vscode.AuthenticationSession[]): Promise<void> {
		this.logService.info(`Storing ${sessions.length} sessions...`);
		this._sessionsPromise = Promise.resolve(sessions);
		await this._keychain.setToken(JSON.stringify(sessions));
		this.logService.info(`Stored ${sessions.length} sessions!`);
	}

	public async createSession(scopes: string[]): Promise<vscode.AuthenticationSession> {
		const flow = { ...this.flow };
		try {
			// For the Gitpod scope list, order doesn't matter so we immediately sort the scopes
			const sortedScopes = scopes.sort();
			const validScopes = await this.fetchValidScopes();
			const sortedFilteredScopes = sortedScopes.filter(s => !validScopes || validScopes.includes(s));
			if (sortedScopes.length !== sortedFilteredScopes.length) {
				this.logService.warn(`Creating session with only valid scopes ${sortedFilteredScopes.join(',')}, original scopes were ${sortedScopes.join(',')}`);
			}
			flow.scopes = JSON.stringify(sortedFilteredScopes);
			this.telemetryService.sendUserFlowStatus('login', flow);

			const scopeString = sortedFilteredScopes.join(' ');
			const token = await this._gitpodServer.login(scopeString, flow);
			const session = await this.tokenToSession(token, sortedFilteredScopes);
			flow.userId = session.account.id;

			const sessions = await this._sessionsPromise;
			const sessionIndex = sessions.findIndex(s => s.id === session.id || arrayEquals([...s.scopes].sort(), sortedFilteredScopes));
			if (sessionIndex > -1) {
				sessions.splice(sessionIndex, 1, session);
			} else {
				sessions.push(session);
			}
			await this.storeSessions(sessions);

			this._sessionChangeEmitter.fire({ added: [session], removed: [], changed: [] });

			this.logService.info('Login success!');

			this.telemetryService.sendUserFlowStatus('login_successful', flow);

			return session;
		} catch (e) {
			// If login was cancelled, do not notify user.
			if (e === 'Cancelled' || e.message === 'Cancelled') {
				this.telemetryService.sendUserFlowStatus('login_cancelled', flow);
				throw e;
			}
			this.notificationService.showErrorMessage(`Sign in failed: ${e}`, { flow, id: 'login_failed' });
			this.logService.error(e);
			throw e;
		}
	}

	private async tokenToSession(token: string, scopes: string[]): Promise<vscode.AuthenticationSession> {
		const userInfo = await this._gitpodServer.getUserInfo(token);
		return {
			id: uuid(),
			accessToken: token,
			account: { label: userInfo.accountName, id: userInfo.id },
			scopes
		};
	}

	public async removeSession(id: string) {
		const flow = { ...this.flow };
		try {
			this.telemetryService.sendUserFlowStatus('logout', flow);
			this.logService.info(`Logging out of ${id}`);

			const sessions = await this._sessionsPromise;
			const sessionIndex = sessions.findIndex(session => session.id === id);
			if (sessionIndex > -1) {
				const session = sessions[sessionIndex];
				flow.userId = session.account.id;
				sessions.splice(sessionIndex, 1);

				await this.storeSessions(sessions);

				this._sessionChangeEmitter.fire({ added: [], removed: [session], changed: [] });
			} else {
				this.logService.error('Session not found');
			}
			this.telemetryService.sendUserFlowStatus('logout_successful', flow);
		} catch (e) {
			this.notificationService.showErrorMessage(`Sign out failed: ${e}`, { flow, id: 'logout_failed' });
			this.logService.error(e);
			throw e;
		}
	}

	public handleUri(uri: vscode.Uri) {
		this._gitpodServer.handleUri(uri);
	}

	public override dispose() {
		super.dispose();
		this._gitpodServer.dispose();
	}
}
