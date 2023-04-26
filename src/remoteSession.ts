/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { v4 as uuid } from 'uuid';
import { NoRunningInstanceError, SSHConnectionParams, SSH_DEST_KEY, WORKSPACE_STOPPED_PREFIX, WorkspaceRestartInfo, showWsNotRunningDialog } from './remote';
import { Disposable } from './common/dispose';
import { HeartbeatManager } from './heartbeat';
import { WorkspaceState } from './workspaceState';
import { ISyncExtension, NoSettingsSyncSession, NoSyncStoreError, SettingsSync, SyncResource, parseSyncData } from './settingsSync';
import { ExperimentalSettings } from './experiments';
import { ITelemetryService, UserFlowTelemetry } from './services/telemetryService';
import { INotificationService } from './services/notificationService';
import { retry } from './common/async';
import { withServerApi } from './internalApi';
import { ScopeFeature } from './featureSupport';
import { ISessionService } from './services/sessionService';
import { IHostService } from './services/hostService';
import { ILogService } from './services/logService';

export class RemoteSession extends Disposable {

	private usePublicApi: boolean = false;

	private heartbeatManager: HeartbeatManager | undefined;
	private workspaceState: WorkspaceState | undefined;

	constructor(
		private readonly remoteAuthority: string,
		private connectionInfo: SSHConnectionParams,
		private readonly context: vscode.ExtensionContext,
		private readonly hostService: IHostService,
		private readonly sessionService: ISessionService,
		private readonly settingsSync: SettingsSync,
		private readonly experiments: ExperimentalSettings,
		private readonly logService: ILogService,
		private readonly telemetryService: ITelemetryService,
		private readonly notificationService: INotificationService,
	) {
		super();

		this._register(this.sessionService.onDidChangeSession(() => {
			if (!this.sessionService.isSignedIn()) {
				this.showSignInDialog();
			} else if (new URL(this.hostService.gitpodHost).host !== new URL(connectionInfo.gitpodHost).host) {
				this.showRevertGitpodHostDialog();
			}
		}));
	}

	public async initialize() {
		this.logService.info('On remote window, RemoteSession initializing');

		if (!this.sessionService.isSignedIn()) {
			this.showSignInDialog();
			return;
		}

		try {
			this.usePublicApi = await this.experiments.getUsePublicAPI(this.connectionInfo.gitpodHost);
			this.logService.info(`Going to use ${this.usePublicApi ? 'public' : 'server'} API`);

			const workspaceInfo = await withServerApi(this.sessionService.getGitpodToken(), this.connectionInfo.gitpodHost, service => service.server.getWorkspace(this.connectionInfo.workspaceId), this.logService);
			if (!workspaceInfo.latestInstance || workspaceInfo.latestInstance?.status?.phase === 'stopping' || workspaceInfo.latestInstance?.status?.phase === 'stopped') {
				throw new NoRunningInstanceError(this.connectionInfo.workspaceId, workspaceInfo.latestInstance?.status?.phase);
			}
			if (workspaceInfo.latestInstance.id !== this.connectionInfo.instanceId) {
				this.logService.info(`Updating workspace ${this.connectionInfo.workspaceId} latest instance id ${this.connectionInfo.instanceId} => ${workspaceInfo.latestInstance.id}`);
				this.connectionInfo.instanceId = workspaceInfo.latestInstance.id;
			}

			const [, sshDestStr] = this.remoteAuthority.split('+');
			await this.context.globalState.update(`${SSH_DEST_KEY}${sshDestStr}`, { ...this.connectionInfo } as SSHConnectionParams);

			const gitpodVersion = await this.hostService.getVersion();

			if (this.usePublicApi) {
				this.workspaceState = new WorkspaceState(this.connectionInfo.workspaceId, this.sessionService, this.logService);
				await this.workspaceState.initialize();

				this._register(this.workspaceState.onWorkspaceStopped(async () => {
					await this.context.globalState.update(`${WORKSPACE_STOPPED_PREFIX}${this.connectionInfo.workspaceId}`, { workspaceId: this.connectionInfo.workspaceId, gitpodHost: this.connectionInfo.gitpodHost } as WorkspaceRestartInfo);
					vscode.commands.executeCommand('workbench.action.remote.close');
				}));
			}

			const heartbeatSupported = this.sessionService.getScopes().includes(ScopeFeature.LocalHeartbeat);
			if (heartbeatSupported) {
				this.heartbeatManager = new HeartbeatManager(this.connectionInfo, this.workspaceState, this.sessionService, this.logService, this.telemetryService);
			} else {
				this.logService.error(`Local heartbeat not supported in ${this.connectionInfo.gitpodHost}, using version ${gitpodVersion.raw}`);
			}

			const syncExtFlow = { ...this.connectionInfo, gitpodVersion: gitpodVersion.raw, userId: this.sessionService.getUserId(), flow: 'sync_local_extensions' };
			this.initializeRemoteExtensions({ ...syncExtFlow, quiet: true, flowId: uuid() });
			this.context.subscriptions.push(vscode.commands.registerCommand('gitpod.installLocalExtensions', () => {
				this.initializeRemoteExtensions({ ...syncExtFlow, quiet: false, flowId: uuid() });
			}));

			vscode.commands.executeCommand('setContext', 'gitpod.inWorkspace', true);
		} catch (e) {
			const remoteFlow: UserFlowTelemetry = { ...this.connectionInfo, userId: this.sessionService.getUserId(), flow: 'remote_window' };
			if (e instanceof NoRunningInstanceError) {
				remoteFlow['phase'] = e.phase;
				showWsNotRunningDialog(this.connectionInfo.workspaceId, this.connectionInfo.gitpodHost, remoteFlow, this.notificationService, this.logService);
				return;
			}
			e.message = `Failed to resolve whole gitpod remote connection process: ${e.message}`;
			this.logService.error(e);
			this.telemetryService.sendTelemetryException(this.connectionInfo.gitpodHost, e, {
				workspaceId: this.connectionInfo.workspaceId, instanceId: this.connectionInfo.instanceId, userId: this.sessionService.getUserId()
			});

			this.logService.show();
			const retry = 'Retry';
			const action = await this.notificationService.showErrorMessage(`Failed to resolve connection to Gitpod workspace: workspace could stop unexpectedly`, { flow: remoteFlow, id: 'unexpected_error' }, retry);
			if (action === retry) {
				this.initialize();
			}
		}
	}

	private async initializeRemoteExtensions(flow: UserFlowTelemetry & { quiet: boolean; flowId: string }) {
		this.telemetryService.sendUserFlowStatus('enabled', flow);
		let syncData: { ref: string; content: string } | undefined;
		try {
			syncData = await this.settingsSync.readResource(SyncResource.Extensions);
		} catch (e) {
			if (e instanceof NoSyncStoreError) {
				const msg = `Could not install local extensions on remote workspace. Please enable [Settings Sync](https://www.gitpod.io/docs/ides-and-editors/settings-sync#enabling-settings-sync-in-vs-code-desktop) with Gitpod.`;
				this.logService.error(msg);

				const status = 'no_sync_store';
				if (flow.quiet) {
					this.telemetryService.sendUserFlowStatus(status, flow);
				} else {
					const addSyncProvider = 'Settings Sync: Enable Sign In with Gitpod';
					const action = await this.notificationService.showInformationMessage(msg, { flow, id: status }, addSyncProvider);
					if (action === addSyncProvider) {
						vscode.commands.executeCommand('gitpod.syncProvider.add');
					}
				}
			} else if (e instanceof NoSettingsSyncSession) {
				const msg = `Could not install local extensions on remote workspace. Please enable [Settings Sync](https://www.gitpod.io/docs/ides-and-editors/settings-sync#enabling-settings-sync-in-vs-code-desktop) with Gitpod.`;
				this.logService.error(msg);

				const status = 'no_settings_sync';
				if (flow.quiet) {
					this.telemetryService.sendUserFlowStatus(status, flow);
				} else {
					const enableSettingsSync = 'Enable Settings Sync';
					const action = await this.notificationService.showInformationMessage(msg, { flow, id: status }, enableSettingsSync);
					if (action === enableSettingsSync) {
						vscode.commands.executeCommand('workbench.userDataSync.actions.turnOn');
					}
				}
			} else {
				this.logService.error('Error while fetching settings sync extension data:', e);

				const status = 'failed_to_fetch';
				if (flow.quiet) {
					this.telemetryService.sendUserFlowStatus(status, flow);
				} else {
					const seeLogs = 'See Logs';
					const action = await this.notificationService.showErrorMessage(`Error while fetching settings sync extension data.`, { flow, id: status }, seeLogs);
					if (action === seeLogs) {
						this.logService.show();
					}
				}
			}
			return;
		}

		const syncDataContent = parseSyncData(syncData.content);
		if (!syncDataContent) {
			const msg = `Error while parsing settings sync extension data.`;
			this.logService.error(msg);

			const status = 'failed_to_parse_content';
			if (flow.quiet) {
				this.telemetryService.sendUserFlowStatus(status, flow);
			} else {
				await this.notificationService.showErrorMessage(msg, { flow, id: status });
			}
			return;
		}

		let extensions: ISyncExtension[];
		try {
			extensions = JSON.parse(syncDataContent.content);
		} catch {
			const msg = `Error while parsing settings sync extension data, malformed JSON.`;
			this.logService.error(msg);

			const status = 'failed_to_parse_json';
			if (flow.quiet) {
				this.telemetryService.sendUserFlowStatus(status, flow);
			} else {
				await this.notificationService.showErrorMessage(msg, { flow, id: status });
			}
			return;
		}

		extensions = extensions.filter(e => e.installed);
		flow.extensions = extensions.length;
		if (!extensions.length) {
			this.telemetryService.sendUserFlowStatus('synced', flow);
			return;
		}

		try {
			try {
				this.logService.trace(`Installing local extensions on remote: `, extensions.map(e => e.identifier.id).join('\n'));
				await retry(async () => {
					await vscode.commands.executeCommand('__gitpod.initializeRemoteExtensions', extensions);
				}, 3000, 15);
			} catch (e) {
				this.logService.error(`Could not execute '__gitpod.initializeRemoteExtensions' command`);
				throw e;
			}
			this.telemetryService.sendUserFlowStatus('synced', flow);
		} catch {
			const msg = `Error while installing local extensions on remote.`;
			this.logService.error(msg);

			const status = 'failed';
			if (flow.quiet) {
				this.telemetryService.sendUserFlowStatus(status, flow);
			} else {
				const seeLogs = 'See Logs';
				const action = await this.notificationService.showErrorMessage(msg, { flow, id: status }, seeLogs);
				if (action === seeLogs) {
					this.logService.show();
				}
			}
		}
	}

	private async showRevertGitpodHostDialog() {
		const flow: UserFlowTelemetry = { ...this.connectionInfo, flow: 'remote_session' };
		const revert = 'Revert change';
		const action = await this.notificationService.showErrorMessage(`Cannot change 'gitpod.host' setting while connected to a remote workspace`, { id: 'switch_gitpod_host_remote', flow, modal: true }, revert);
		if (action === revert) {
			await this.hostService.changeHost(this.connectionInfo.gitpodHost, true);
		}
	}

	private showSignInDialog() {
		this.notificationService.showErrorMessage(`You are not signed in with a Gitpod account, please sign in first.`, { flow: { flow: 'remote_window', gitpodHost: this.connectionInfo.gitpodHost }, id: 'not_signed_in', modal: true });
	}

	public override async dispose(): Promise<void> {
		await this.heartbeatManager?.dispose();
		this.workspaceState?.dispose();
		super.dispose();
	}
}
