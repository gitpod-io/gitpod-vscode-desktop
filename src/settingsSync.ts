/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fetch from 'node-fetch';
import * as vscode from 'vscode';
import { Disposable } from './common/dispose';
import Log from './common/logger';
import { UserFlowTelemetry } from './common/telemetry';
import { NotificationService } from './notification';
import TelemetryReporter from './telemetryReporter';

export class NoSyncStoreError extends Error {
	constructor() {
		super('No settings sync store url configured');
	}
}

export class NoSettingsSyncSession extends Error {
	constructor() {
		super('No settings sync session available');
	}
}

export class UserDataSyncStoreError extends Error {
	constructor(message: string) {
		super(message);
	}
}

interface ConfigurationSyncStore {
	url: string;
	insidersUrl: string;
	stableUrl: string;
	canSwitch: boolean;
	authenticationProviders: Record<string, { scopes: string[] }>;
}

export const enum SyncResource {
	Settings = 'settings',
	Keybindings = 'keybindings',
	Snippets = 'snippets',
	Tasks = 'tasks',
	Extensions = 'extensions',
	GlobalState = 'globalState',
}

export interface IExtensionIdentifier {
	id: string;
	uuid?: string;
}

export interface ISyncExtension {
	identifier: IExtensionIdentifier;
	preRelease?: boolean;
	version?: string;
	disabled?: boolean;
	installed?: boolean;
	state?: Record<string, any>;
}

export interface ISyncData {
	version: number;
	machineId?: string;
	content: string;
}

function isSyncData(thing: any): thing is ISyncData {
	if (thing
		&& (thing.version !== undefined && typeof thing.version === 'number')
		&& (thing.content !== undefined && typeof thing.content === 'string')) {

		// backward compatibility
		if (Object.keys(thing).length === 2) {
			return true;
		}

		if (Object.keys(thing).length === 3
			&& (thing.machineId !== undefined && typeof thing.machineId === 'string')) {
			return true;
		}
	}

	return false;
}

export function parseSyncData(content: string): ISyncData | undefined {
	try {
		const syncData: ISyncData = JSON.parse(content);
		if (isSyncData(syncData)) {
			return syncData;
		}
	} catch {
	}

	return undefined;
}

export class SettingsSync extends Disposable {
	public static SCOPES = [
		'function:accessCodeSyncStorage',
		'function:getLoggedInUser',
		'resource:default'
	];

	private session: vscode.AuthenticationSession | undefined;
	private readonly flow: Readonly<UserFlowTelemetry> = { flow: 'settings_sync' };

	constructor(
		private readonly logger: Log,
		private readonly telemetry: TelemetryReporter,
		private readonly notifications: NotificationService
	) {
		super();

		this._register(vscode.workspace.onDidChangeConfiguration(async e => {
			if (e.affectsConfiguration('gitpod.host') || e.affectsConfiguration('configurationSync.store')) {
				const gitpodHost = this.getServiceUrl().origin;
				const flow = { ...this.flow, gitpodHost };
				const addedSyncProvider = await this.updateSyncContext();
				if (!addedSyncProvider) {
					const action = 'Settings Sync: Enable Sign In with Gitpod';
					const result = await this.notifications.showInformationMessage(`[Settings Sync](https://www.gitpod.io/docs/ides-and-editors/settings-sync#enabling-settings-sync-in-vs-code-desktop) with ${gitpodHost} is disabled.`, { flow, id: 'invalid' }, action);
					if (result === action) {
						vscode.commands.executeCommand('gitpod.syncProvider.add');
					}
				}
			}
		}));
		this._register(vscode.commands.registerCommand('gitpod.syncProvider.add', () => this.enableSettingsSync(true)));
		this._register(vscode.commands.registerCommand('gitpod.syncProvider.remove', () => this.enableSettingsSync(false)));

		this.updateSyncContext();
	}

	private isSyncStoreConfigured() {
		const config = vscode.workspace.getConfiguration();
		const syncProviderConfig = config.get('configurationSync.store');
		const gitpodSyncProviderConfig = this.getGitpodSyncProviderConfig();
		const addedSyncProvider = !!syncProviderConfig && JSON.stringify(syncProviderConfig) === JSON.stringify(gitpodSyncProviderConfig);
		return addedSyncProvider;
	}

	/**
	 * Updates the VS Code context to reflect whether the user added Gitpod as their Settings Sync provider.
	 */
	private async updateSyncContext(): Promise<boolean> {
		const addedSyncProvider = this.isSyncStoreConfigured();
		await vscode.commands.executeCommand('setContext', 'gitpod.addedSyncProvider', addedSyncProvider);
		return addedSyncProvider;
	}

	/**
	 * Adds an authentication provider as a possible provider for code sync.
	 * It adds some key configuration to the user settings, so that the user can choose the Gitpod provider when deciding what to use with setting sync.
	 * @param enabled - indicates whether to add or remove the configuration
	 */
	private async enableSettingsSync(enabled: boolean): Promise<void> {
		const gitpodHost = this.getServiceUrl().origin;
		const flow = { ...this.flow, enabled: String(enabled), gitpodHost };
		this.telemetry.sendUserFlowStatus('changing_enablement', flow);
		try {
			let newSyncProviderConfig: ConfigurationSyncStore | undefined;
			let newIgnoredSettingsConfig: string[] | undefined;
			const config = vscode.workspace.getConfiguration();
			const currentSyncProviderConfig: ConfigurationSyncStore | undefined = config.get('configurationSync.store');
			const currentIgnoredSettingsConfig: string[] | undefined = config.get('settingsSync.ignoredSettings');
			const gitpodSyncProviderConfig = this.getGitpodSyncProviderConfig();
			if (enabled) {
				if (JSON.stringify(currentSyncProviderConfig) === JSON.stringify(gitpodSyncProviderConfig)) {
					return;
				}
				newSyncProviderConfig = gitpodSyncProviderConfig;
				newIgnoredSettingsConfig = currentIgnoredSettingsConfig ?? [];
				if (!newIgnoredSettingsConfig.find(s => s === 'configurationSync.store')) {
					newIgnoredSettingsConfig.push('configurationSync.store');
				}
			} else {
				if (currentSyncProviderConfig === undefined) {
					return;
				}
				newSyncProviderConfig = undefined;
				newIgnoredSettingsConfig = currentIgnoredSettingsConfig?.filter(s => s !== 'configurationSync.store');
			}

			await config.update('settingsSync.ignoredSettings', newIgnoredSettingsConfig, vscode.ConfigurationTarget.Global);
			await config.update('configurationSync.store', newSyncProviderConfig, vscode.ConfigurationTarget.Global);

			const learnMore: vscode.MessageItem = {
				title: 'Learn More',
				isCloseAffordance: true
			};
			const action = await this.notifications.showInformationMessage('Please entirely quit VS Code for the Settings Sync configuration to take effect.', { flow, modal: true, id: 'quit_to_apply' }, learnMore);
			if (action === learnMore) {
				vscode.env.openExternal(vscode.Uri.parse("https://www.gitpod.io/docs/ides-and-editors/settings-sync#enabling-settings-sync-in-vs-code-desktop"));
			}
		} catch (e) {
			const outputMessage = `Error setting up Settings Sync with Gitpod: ${e}`;
			this.notifications.showErrorMessage(outputMessage, { flow, id: 'failed' });
			this.logger.error(outputMessage);
		}
	}

	private getGitpodSyncProviderConfig(): ConfigurationSyncStore {
		const syncStoreURL = this.getServiceUrl().toString();
		return {
			url: syncStoreURL,
			stableUrl: syncStoreURL,
			insidersUrl: syncStoreURL,
			canSwitch: false,
			authenticationProviders: {
				gitpod: {
					scopes: SettingsSync.SCOPES
				}
			}
		};
	}

	private getServiceUrl() {
		const config = vscode.workspace.getConfiguration();
		const serviceUrl = new URL(config.get<string>('gitpod.host')!);
		serviceUrl.pathname = '/code-sync';
		return serviceUrl;
	}

	public async readResource(path: string) {
		if (!this.isSyncStoreConfigured()) {
			throw new NoSyncStoreError();
		}

		const syncStoreURL = this.getServiceUrl().toString();
		const resourceURL = `${syncStoreURL}/v1/resource/${path}/latest`;

		const resp = await this.request(resourceURL);
		const ref = resp.headers.get('etag');
		if (!ref) {
			throw new UserDataSyncStoreError('Server did not return the ref');
		}
		const content = await resp.text();

		return { ref, content };
	}

	private async tryGetSession() {
		if (!this.session) {
			this.session = await vscode.authentication.getSession(
				'gitpod',
				SettingsSync.SCOPES,
				{ createIfNone: false }
			);
		}

		return this.session;
	}

	private async request(url: string) {
		const session = await this.tryGetSession();
		if (!session) {
			throw new NoSettingsSyncSession();
		}

		let resp;
		try {
			resp = await fetch(url, {
				method: 'GET',
				headers: {
					'X-Account-Type': 'gitpod',
					'authorization': `Bearer ${session.accessToken}`,
				},
				timeout: 5000
			});
		} catch (e) {
			throw e;
		}

		if (!resp.ok) {
			throw new UserDataSyncStoreError(`GET request '${url}' failed, server returned ${resp.status}`);
		}

		return resp;
	}

}
