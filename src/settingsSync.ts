/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Disposable } from './common/dispose';
import Log from './common/logger';
import TelemetryReporter from './telemetryReporter';

interface ConfigurationSyncStore {
	url: string;
	insidersUrl: string;
	stableUrl: string;
	canSwitch: boolean;
	authenticationProviders: Record<string, { scopes: string[] }>;
}

export default class SettingsSync extends Disposable {
	constructor(private readonly logger: Log, private readonly telemetry: TelemetryReporter) {
		super();

		this._register(vscode.workspace.onDidChangeConfiguration(async e => {
			if (e.affectsConfiguration('gitpod.host') || e.affectsConfiguration('configurationSync.store')) {
				const addedSyncProvider = await this.updateSyncContext();
				if (!addedSyncProvider) {
					const action = 'Settings Sync: Enable Sign In with Gitpod';
					const result = await vscode.window.showInformationMessage('Gitpod Settings Sync configuration invalidated, Settings Sync is disabled.', action);
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

	/**
	 * Updates the VS Code context to reflect whether the user added Gitpod as their Settings Sync provider.
	 */
	private async updateSyncContext(): Promise<boolean> {
		const config = vscode.workspace.getConfiguration();
		const syncProviderConfig = config.get('configurationSync.store');
		const serviceUrl = config.get<string>('gitpod.host')!;
		const gitpodSyncProviderConfig = this.getGitpodSyncProviderConfig(serviceUrl);
		const addedSyncProvider = !!syncProviderConfig && JSON.stringify(syncProviderConfig) === JSON.stringify(gitpodSyncProviderConfig);
		await vscode.commands.executeCommand('setContext', 'gitpod.addedSyncProvider', addedSyncProvider);
		return addedSyncProvider;
	}

	/**
	 * Adds an authentication provider as a possible provider for code sync.
	 * It adds some key configuration to the user settings, so that the user can choose the Gitpod provider when deciding what to use with setting sync.
	 * @param enabled - indicates whether to add or remove the configuration
	 */
	private async enableSettingsSync(enabled: boolean): Promise<void> {
		try {
			let newSyncProviderConfig: ConfigurationSyncStore | undefined;
			let newIgnoredSettingsConfig: string[] | undefined;
			const config = vscode.workspace.getConfiguration();
			const currentSyncProviderConfig: ConfigurationSyncStore | undefined = config.get('configurationSync.store');
			const currentIgnoredSettingsConfig: string[] | undefined = config.get('settingsSync.ignoredSettings');
			const serviceUrl = config.get<string>('gitpod.host')!;
			const gitpodSyncProviderConfig = this.getGitpodSyncProviderConfig(serviceUrl);
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

			this.telemetry.sendTelemetryEvent('gitpod_desktop_settings_sync', { enabled: String(enabled) });

			vscode.window.showInformationMessage('Quit VS Code for the new Settings Sync configuration to take effect.', { modal: true });
		} catch (e) {
			const outputMessage = `Error setting up Settings Sync with Gitpod: ${e}`;
			vscode.window.showErrorMessage(outputMessage);
			this.logger.error(outputMessage);
		}
	}

	private getGitpodSyncProviderConfig(serviceUrl: string): ConfigurationSyncStore {
		const syncStoreURL = `${new URL(serviceUrl).toString().replace(/\/$/, '')}/code-sync`;
		return {
			url: syncStoreURL,
			stableUrl: syncStoreURL,
			insidersUrl: syncStoreURL,
			canSwitch: false,
			authenticationProviders: {
				gitpod: {
					scopes: [
						'function:accessCodeSyncStorage',
						'function:getLoggedInUser',
						'resource:default'
					]
				}
			}
		};
	}
}
