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
import { eventToPromise } from '../common/event';

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

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly sessionService: ISessionService,
		private readonly hostService: IHostService,
		private readonly logService: ILogService,
	) { }

	async execute(treeItem?: { id: string }) {
		let wsData: WorkspaceData | undefined;
		if (!treeItem?.id) {
			wsData = await showWorkspacesPicker(this.sessionService, 'Select a workspace to connect...');
		} else {
			wsData = rawWorkspaceToWorkspaceData(await this.sessionService.getAPI().getWorkspace(treeItem.id));
		}

		if (!wsData) {
			return;
		}

		const domain = getLocalSSHDomain(this.hostService.gitpodHost);
		const sshHostname = `${wsData.id}.${domain}`;
		const sshDest = new SSHDestination(sshHostname, wsData.id);

		// TODO: remove this, should not be needed
		await this.context.globalState.update(`${SSH_DEST_KEY}${sshDest.toRemoteSSHString()}`, { workspaceId: wsData.id, gitpodHost: this.hostService.gitpodHost, instanceId: '' } as SSHConnectionParams);

		await vscode.window.withProgress(
			{
				title: `Starting workspace ${wsData!.id}`,
				location: vscode.ProgressLocation.Notification
			},
			async () => {
				let wsState: WorkspaceState | undefined;
				try {
					wsState = new WorkspaceState(wsData!.id, this.sessionService, this.logService);
					await wsState.initialize();

					if (wsState.isWorkspaceStopping) {
						// TODO: if stopping tell user to await until stopped to start again
						return;
					}

					if (wsState.isWorkspaceStopped) {
						// Start workspace automatically
						await this.sessionService.getAPI().startWorkspace(wsData!.id);
						await eventToPromise(wsState.onWorkspaceRunning);
					}

					// TODO: getWorkspace API need to return path to open, for now harcode it
					await vscode.commands.executeCommand(
						'vscode.openFolder',
						vscode.Uri.parse(`vscode-remote://ssh-remote+${sshDest.toRemoteSSHString()}/workspace/${wsData!.repo}`),
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

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly sessionService: ISessionService,
		private readonly hostService: IHostService,
		private readonly logService: ILogService,
	) { }

	async execute(treeItem?: { id: string }) {
		let wsData: WorkspaceData | undefined;
		if (!treeItem?.id) {
			wsData = await showWorkspacesPicker(this.sessionService, 'Select a workspace to connect...');
		} else {
			wsData = rawWorkspaceToWorkspaceData(await this.sessionService.getAPI().getWorkspace(treeItem.id));
		}

		if (!wsData) {
			return;
		}

		const domain = getLocalSSHDomain(this.hostService.gitpodHost);
		const sshHostname = `${wsData.id}.${domain}`;
		const sshDest = new SSHDestination(sshHostname, wsData.id);

		// TODO: remove this, should not be needed
		await this.context.globalState.update(`${SSH_DEST_KEY}${sshDest.toRemoteSSHString()}`, { workspaceId: wsData.id, gitpodHost: this.hostService.gitpodHost, instanceId: '' } as SSHConnectionParams);

		await vscode.window.withProgress(
			{
				title: `Starting workspace ${wsData!.id}`,
				location: vscode.ProgressLocation.Notification
			},
			async () => {
				let wsState: WorkspaceState | undefined;
				try {
					wsState = new WorkspaceState(wsData!.id, this.sessionService, this.logService);
					await wsState.initialize();

					if (wsState.isWorkspaceStopping) {
						// TODO: if stopping tell user to await until stopped to start again
						return;
					}

					if (wsState.isWorkspaceStopped) {
						// Start workspace automatically
						await this.sessionService.getAPI().startWorkspace(wsData!.id);
						await eventToPromise(wsState.onWorkspaceRunning);
					}

					// TODO: getWorkspace API need to return path to open, for now harcode it
					await vscode.commands.executeCommand(
						'vscode.openFolder',
						vscode.Uri.parse(`vscode-remote://ssh-remote+${sshDest.toRemoteSSHString()}/workspace/${wsData!.repo}`),
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

	constructor(private readonly sessionService: ISessionService) { }

	async execute(treeItem?: { id: string }) {
		let workspaceUrl: string | undefined;
		if (!treeItem?.id) {
			workspaceUrl = (await showWorkspacesPicker(this.sessionService, 'Select a workspace to connect...'))?.workspaceUrl;
		} else {
			workspaceUrl = rawWorkspaceToWorkspaceData(await this.sessionService.getAPI().getWorkspace(treeItem.id)).workspaceUrl;
		}

		if (workspaceUrl) {
			await vscode.env.openExternal(vscode.Uri.parse(workspaceUrl));
		}
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

	constructor(private readonly sessionService: ISessionService) { }

	async execute(treeItem: { id: string }) {
		if (!treeItem?.id) {
			return;
		}

		const contextUrl = rawWorkspaceToWorkspaceData(await this.sessionService.getAPI().getWorkspace(treeItem.id)).contextUrl;
		await vscode.env.openExternal(vscode.Uri.parse(contextUrl));
	}
}
