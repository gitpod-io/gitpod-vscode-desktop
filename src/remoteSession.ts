/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { NoRunningInstanceError, SSHConnectionParams, SSH_DEST_KEY, getGitpodRemoteWindowConnectionInfo } from './remote';
import { Disposable } from './common/dispose';
import { HeartbeatManager } from './heartbeat';
import { WorkspaceState } from './workspaceState';
import { ITelemetryService, UserFlowTelemetryProperties } from './common/telemetry';
import { INotificationService } from './services/notificationService';
import { ISessionService } from './services/sessionService';
import { IHostService } from './services/hostService';
import { ILogService } from './services/logService';
import { ExtensionServiceServer } from './local-ssh/ipc/extensionServiceServer';
import { IRemoteService } from './services/remoteService';

export class RemoteSession extends Disposable {

	private heartbeatManager: HeartbeatManager | undefined;
	private workspaceState: WorkspaceState | undefined;
	private extensionServiceServer: ExtensionServiceServer | undefined;

	constructor(
		private connectionInfo: SSHConnectionParams,
		private readonly context: vscode.ExtensionContext,
		private readonly remoteService: IRemoteService,
		private readonly hostService: IHostService,
		private readonly sessionService: ISessionService,
		private readonly logService: ILogService,
		private readonly telemetryService: ITelemetryService,
		private readonly notificationService: INotificationService
	) {
		super();

		this._register(this.sessionService.onDidChangeSession(() => {
			if (!this.sessionService.isSignedIn()) {
				if (new URL(this.hostService.gitpodHost).host !== new URL(connectionInfo.gitpodHost).host) {
					this.showRevertGitpodHostDialog();
				} else {
					this.showSignInDialog();
				}
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
			this.remoteService.startLocalSSHServiceServer().catch(() => {/* ignore */ });

			this.workspaceState = new WorkspaceState(this.connectionInfo.workspaceId, this.sessionService, this.logService);
			this.workspaceState.initialize()
				.then(() => {
					if (!this.workspaceState!.instanceId || !this.workspaceState!.isWorkspaceRunning) {
						vscode.commands.executeCommand('workbench.action.remote.close');
						return;
					}
					const instanceId = this.workspaceState!.instanceId;
					if (instanceId !== this.connectionInfo.instanceId) {
						this.logService.info(`Updating workspace ${this.connectionInfo.workspaceId} latest instance id ${this.connectionInfo.instanceId} => ${instanceId}`);
						this.connectionInfo.instanceId = instanceId;
					}

					const { sshDestStr } = getGitpodRemoteWindowConnectionInfo(this.context)!;
					this.context.globalState.update(`${SSH_DEST_KEY}${sshDestStr}`, { ...this.connectionInfo } as SSHConnectionParams);
				});

			this._register(this.workspaceState.onWorkspaceWillStop(async () => {
				await this.remoteService.saveRestartInfo();
				vscode.commands.executeCommand('workbench.action.remote.close');
			}));

			this.heartbeatManager = new HeartbeatManager(this.connectionInfo, this.workspaceState, this.sessionService, this.logService, this.telemetryService);

			this.remoteService.initializeRemoteExtensions();

			vscode.commands.executeCommand('setContext', 'gitpod.inWorkspace', true);
		} catch (e) {
			if (e instanceof NoRunningInstanceError) {
				vscode.commands.executeCommand('workbench.action.remote.close');
				return;
			}

			e.message = `Failed to resolve whole gitpod remote connection process: ${e.message}`;
			this.logService.error(e);
			this.telemetryService.sendTelemetryException(e, {
				gitpodHost: this.connectionInfo.gitpodHost,
				workspaceId: this.connectionInfo.workspaceId,
				instanceId: this.connectionInfo.instanceId,
				userId: this.sessionService.getUserId()
			});

			const remoteFlow: UserFlowTelemetryProperties = { ...this.connectionInfo, userId: this.sessionService.getUserId(), flow: 'remote_window' };

			this.logService.show();
			const retry = 'Retry';
			const action = await this.notificationService.showErrorMessage(`Failed to resolve connection to Gitpod workspace: workspace could stop unexpectedly`, { flow: remoteFlow, id: 'unexpected_error' }, retry);
			if (action === retry) {
				this.initialize();
			}
		}
	}

	private async showRevertGitpodHostDialog() {
		const flow: UserFlowTelemetryProperties = { ...this.connectionInfo, flow: 'remote_session' };
		const revert: vscode.MessageItem = { title: 'Revert change' };
		const close: vscode.MessageItem = { title: 'Close window', isCloseAffordance: true };
		const action = await this.notificationService.showErrorMessage(`Cannot change 'gitpod.host' setting while connected to a remote workspace`, { id: 'switch_gitpod_host_remote', flow, modal: true }, revert, close);
		if (action === revert) {
			await this.hostService.changeHost(this.connectionInfo.gitpodHost, true);
		} else if (action === close) {
			vscode.commands.executeCommand('workbench.action.remote.close');
		}
	}

	private showSignInDialog() {
		this.notificationService.showErrorMessage(`You are not signed in with a Gitpod account, please sign in first.`, { flow: { flow: 'remote_window', gitpodHost: this.connectionInfo.gitpodHost }, id: 'not_signed_in', modal: true });
	}

	public override async dispose(): Promise<void> {
		await this.heartbeatManager?.dispose();
		this.workspaceState?.dispose();
		this.extensionServiceServer?.dispose();
		super.dispose();
	}
}
