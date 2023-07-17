/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Command } from '../commandManager';
import { ISessionService } from '../services/sessionService';
import { WorkspaceData, rawWorkspaceToWorkspaceData } from '../publicApi';
import { SSHConnectionParams, SSH_DEST_KEY, getLocalSSHDomain } from '../remote';
import SSHDestination from '../ssh/sshDestination';
import { IHostService } from '../services/hostService';
import { WorkspaceState } from '../workspaceState';
import { ILogService } from '../services/logService';
import { eventToPromise, raceCancellationError } from '../common/event';
import { ITelemetryService } from '../common/telemetry';

async function showWorkspacesPicker(sessionService: ISessionService, placeHolder: string): Promise<WorkspaceData | undefined> {
	const pickItemsPromise = sessionService.getAPI().listWorkspaces()
		.then(rawWorkspaces => rawWorkspaceToWorkspaceData(rawWorkspaces).map(wsData => {
			return {
				...wsData,
				label: `${wsData.owner}/${wsData.repo}`,
				detail: wsData.id,
			};
		}));

	const picked = await vscode.window.showQuickPick(pickItemsPromise, { canPickMany: false, placeHolder });
	return picked;
}

export class ConnectInNewWindowCommand implements Command {
	readonly id = 'gitpod.workspaces.connectInNewWindow';

	private running = false;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly sessionService: ISessionService,
		private readonly hostService: IHostService,
		private readonly telemetryService: ITelemetryService,
		private readonly logService: ILogService,
	) { }

	async execute(treeItem?: { id: string }) {
		if (this.running) {
			return;
		}

		try {
			this.running = true;
			await this.doRun(treeItem);
		} finally {
			this.running = false;
		}
	}

	private async doRun(treeItem?: { id: string }) {
		let wsData: WorkspaceData | undefined;
		if (!treeItem?.id) {
			wsData = await showWorkspacesPicker(this.sessionService, 'Select a workspace to connect...');
		} else {
			wsData = rawWorkspaceToWorkspaceData(await this.sessionService.getAPI().getWorkspace(treeItem.id));
		}

		if (!wsData) {
			return;
		}

		this.telemetryService.sendTelemetryEvent('vscode_desktop_view_command', {
			name: this.id,
			gitpodHost: this.hostService.gitpodHost,
			workspaceId: wsData.id,
			location: treeItem?.id ? 'view' : 'commandPalette'
		});

		const domain = getLocalSSHDomain(this.hostService.gitpodHost);
		const sshHostname = `${wsData.id}.${domain}`;
		const sshDest = new SSHDestination(sshHostname, wsData.id);

		// TODO: remove this, should not be needed
		await this.context.globalState.update(`${SSH_DEST_KEY}${sshDest.toRemoteSSHString()}`, { workspaceId: wsData.id, gitpodHost: this.hostService.gitpodHost, instanceId: '' } as SSHConnectionParams);

		await vscode.window.withProgress(
			{
				title: `Starting workspace ${wsData.id}`,
				location: vscode.ProgressLocation.Notification,
				cancellable: true
			},
			async (_, cancelToken) => {
				let wsState: WorkspaceState | undefined;
				try {
					wsState = new WorkspaceState(wsData!.id, this.sessionService, this.logService);
					await wsState.initialize();

					if (cancelToken.isCancellationRequested) {
						return;
					}

					if (wsState.isWorkspaceStopping) {
						// TODO: if stopping tell user to await until stopped to start again
						return;
					}

					if (wsState.isWorkspaceStopped) {
						// Start workspace automatically
						await this.sessionService.getAPI().startWorkspace(wsData!.id);

						if (cancelToken.isCancellationRequested) {
							return;
						}

						await raceCancellationError(eventToPromise(wsState.onWorkspaceRunning), cancelToken);
					}

					// TODO: getWorkspace API need to return path to open, for now harcode it
					await vscode.commands.executeCommand(
						'vscode.openFolder',
						vscode.Uri.parse(`vscode-remote://ssh-remote+${sshDest.toRemoteSSHString()}${wsData!.recentFolders[0] || `/workspace/${wsData!.repo}`}`),
						{ forceNewWindow: true }
					);
				} finally {
					wsState?.dispose();
				}
			}
		);
	}
}

export class ConnectInCurrentWindowCommand implements Command {
	readonly id = 'gitpod.workspaces.connectInCurrentWindow';

	private running = false;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly sessionService: ISessionService,
		private readonly hostService: IHostService,
		private readonly telemetryService: ITelemetryService,
		private readonly logService: ILogService,
	) { }

	async execute(treeItem?: { id: string }) {
		if (this.running) {
			return;
		}

		try {
			this.running = true;
			await this.doRun(treeItem);
		} finally {
			this.running = false;
		}
	}

	private async doRun(treeItem?: { id: string }) {
		let wsData: WorkspaceData | undefined;
		if (!treeItem?.id) {
			wsData = await showWorkspacesPicker(this.sessionService, 'Select a workspace to connect...');
		} else {
			wsData = rawWorkspaceToWorkspaceData(await this.sessionService.getAPI().getWorkspace(treeItem.id));
		}

		if (!wsData) {
			return;
		}

		this.telemetryService.sendTelemetryEvent('vscode_desktop_view_command', {
			name: this.id,
			gitpodHost: this.hostService.gitpodHost,
			workspaceId: wsData.id,
			location: treeItem?.id ? 'view' : 'commandPalette'
		});

		const domain = getLocalSSHDomain(this.hostService.gitpodHost);
		const sshHostname = `${wsData.id}.${domain}`;
		const sshDest = new SSHDestination(sshHostname, wsData.id);

		// TODO: remove this, should not be needed
		await this.context.globalState.update(`${SSH_DEST_KEY}${sshDest.toRemoteSSHString()}`, { workspaceId: wsData.id, gitpodHost: this.hostService.gitpodHost, instanceId: '' } as SSHConnectionParams);

		await vscode.window.withProgress(
			{
				title: `Starting workspace ${wsData.id}`,
				location: vscode.ProgressLocation.Notification,
				cancellable: true
			},
			async (_, cancelToken) => {
				let wsState: WorkspaceState | undefined;
				try {
					wsState = new WorkspaceState(wsData!.id, this.sessionService, this.logService);
					await wsState.initialize();

					if (cancelToken.isCancellationRequested) {
						return;
					}

					if (wsState.isWorkspaceStopping) {
						// TODO: if stopping tell user to await until stopped to start again
						return;
					}

					if (wsState.isWorkspaceStopped) {
						// Start workspace automatically
						await this.sessionService.getAPI().startWorkspace(wsData!.id);

						if (cancelToken.isCancellationRequested) {
							return;
						}

						await raceCancellationError(eventToPromise(wsState.onWorkspaceRunning), cancelToken);
					}

					// TODO: getWorkspace API need to return path to open, for now harcode it
					await vscode.commands.executeCommand(
						'vscode.openFolder',
						vscode.Uri.parse(`vscode-remote://ssh-remote+${sshDest.toRemoteSSHString()}${wsData!.recentFolders[0] || `/workspace/${wsData!.repo}`}`),
						{ forceNewWindow: false }
					);
				} finally {
					wsState?.dispose();
				}
			}
		);
	}
}

export class StopWorkspaceCommand implements Command {
	readonly id = 'gitpod.workspaces.stopWorkspace';

	constructor(private readonly sessionService: ISessionService) { }

	async execute(treeItem?: { id: string }) {
		let workspaceId: string | undefined;
		if (!treeItem?.id) {
			workspaceId = (await showWorkspacesPicker(this.sessionService, 'Select a workspace to stop...'))?.id;
		} else {
			workspaceId = treeItem.id;
		}

		if (workspaceId) {
			await this.sessionService.getAPI().stopWorkspace(workspaceId);
		}
	}
}

export class StopCurrentWorkspaceCommand implements Command {
	readonly id = 'gitpod.workspaces.stopCurrentWorkspace';

	constructor(private readonly connectionInfo: SSHConnectionParams | undefined, private readonly sessionService: ISessionService) { }

	async execute() {
		if (!this.connectionInfo) {
			return;
		}

		await this.sessionService.getAPI().stopWorkspace(this.connectionInfo.workspaceId);
		await vscode.commands.executeCommand('workbench.action.remote.close');
	}
}

export class OpenInBrowserCommand implements Command {
	readonly id = 'gitpod.workspaces.openInBrowser';

	constructor(
		private readonly sessionService: ISessionService,
		private readonly hostService: IHostService,
		private readonly telemetryService: ITelemetryService,
	) { }

	async execute(treeItem?: { id: string }) {
		let wsData: WorkspaceData | undefined;
		if (!treeItem?.id) {
			wsData = (await showWorkspacesPicker(this.sessionService, 'Select a workspace to connect...'));
		} else {
			wsData = rawWorkspaceToWorkspaceData(await this.sessionService.getAPI().getWorkspace(treeItem.id));
		}

		if (!wsData) {
			return;
		}

		this.telemetryService.sendTelemetryEvent('vscode_desktop_view_command', {
			name: this.id,
			gitpodHost: this.hostService.gitpodHost,
			workspaceId: wsData.id,
			location: treeItem?.id ? 'gitpodView' : 'commandPalette'
		});

		await vscode.env.openExternal(vscode.Uri.parse(wsData.workspaceUrl));
	}
}

export class DeleteWorkspaceCommand implements Command {
	readonly id = 'gitpod.workspaces.deleteWorkspace';

	constructor(private readonly sessionService: ISessionService) { }

	async execute(treeItem?: { id: string }) {
		let workspaceId: string | undefined;
		if (!treeItem?.id) {
			workspaceId = (await showWorkspacesPicker(this.sessionService, 'Select a workspace to delete...'))?.id;
		} else {
			workspaceId = treeItem.id;
		}

		if (workspaceId) {
			await this.sessionService.getAPI().deleteWorkspace(workspaceId);
		}
	}
}

export class OpenWorkspaceContextCommand implements Command {
	readonly id = 'gitpod.workspaces.openContext';

	constructor(
		private readonly sessionService: ISessionService,
		private readonly hostService: IHostService,
		private readonly telemetryService: ITelemetryService,
	) { }

	async execute(treeItem: { id: string }) {
		if (!treeItem?.id) {
			return;
		}

		const wsData = rawWorkspaceToWorkspaceData(await this.sessionService.getAPI().getWorkspace(treeItem.id));

		this.telemetryService.sendTelemetryEvent('vscode_desktop_view_command', {
			name: this.id,
			gitpodHost: this.hostService.gitpodHost,
			workspaceId: wsData.id,
			location: treeItem?.id ? 'gitpodView' : 'commandPalette'
		});

		await vscode.env.openExternal(vscode.Uri.parse(wsData.contextUrl));
	}
}

export class DisconnectWorkspaceCommand implements Command {
	readonly id = 'gitpod.workspaces.disconnect';

	constructor() { }

	async execute() {
		await vscode.commands.executeCommand('workbench.action.remote.close');
	}
}