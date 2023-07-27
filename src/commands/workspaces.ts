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
import { IRemoteService } from '../services/remoteService';
import { WrapError } from '../common/utils';
import { getOpenSSHVersion, testSSHConnection as testLocalSSHConnection } from '../ssh/nativeSSH';
import { IExperimentsService } from '../experiments';

function getCommandName(command: string) {
	return command.replace('gitpod.workspaces.', '').replace(/(?:_inline|_context)(?:@\d)?$/, '');
}

function getCommandLocation(command: string, treeItem?: { id: string }) {
	if (/_inline(?:@\d)?$/.test(command)) {
		return 'inline';
	}
	if (/_context(?:@\d)?$/.test(command)) {
		return 'contextMenu';
	}
	return (treeItem?.id ? 'contextMenu' : 'commandPalette');
}

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
	readonly id: string = 'gitpod.workspaces.connectInNewWindow';

	private running = false;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly remoteService: IRemoteService,
		private readonly sessionService: ISessionService,
		private readonly hostService: IHostService,
		private readonly experimentsService: IExperimentsService,
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
			name: getCommandName(this.id),
			gitpodHost: this.hostService.gitpodHost,
			workspaceId: wsData.id,
			location: getCommandLocation(this.id, treeItem)
		});

		let wsState = new WorkspaceState(wsData!.id, this.sessionService, this.logService);
		try {
			await wsState.initialize();
			if (wsState.isWorkspaceStopping) {
				// TODO: if stopping tell user to await until stopped to start again
				return;
			}
			await vscode.window.withProgress(
				{
					title: `Starting workspace ${wsData.id}`,
					location: vscode.ProgressLocation.Notification,
					cancellable: true
				},
				async (_, cancelToken) => {
					await this.initializeLocalSSH(wsData!.id);

					if (wsState.isWorkspaceStopped) {
						// Start workspace automatically
						await this.sessionService.getAPI().startWorkspace(wsData!.id);

						vscode.commands.executeCommand('gitpod.workspaces.refresh');

						if (cancelToken.isCancellationRequested) {
							return;
						}

						await raceCancellationError(eventToPromise(wsState.onWorkspaceRunning), cancelToken);
						wsData = wsState.workspaceData; // Update wsData with latest info after workspace is running
					}

					const domain = getLocalSSHDomain(this.hostService.gitpodHost);
					const sshHostname = `${wsData!.id}.${domain}`;
					const localSSHDestination = new SSHDestination(sshHostname, wsData!.id);
					let localSSHTestSuccess: boolean = false;
					try {
						await testLocalSSHConnection(localSSHDestination.user!, localSSHDestination.hostname);
						localSSHTestSuccess = true;
					} catch (e) {
						this.telemetryService.sendTelemetryException(
							new WrapError('Local SSH: failed to connect to workspace', e, 'Unknown'),
							{
								gitpodHost: this.hostService.gitpodHost,
								workspaceId: wsData!.id,
							}
						);
					}

					let sshDest: SSHDestination;
					let password: string | undefined;
					if (await this.experimentsService.getUseLocalSSHProxy() && localSSHTestSuccess) {
						sshDest = localSSHDestination;
					} else {
						({ destination: sshDest, password } = await this.remoteService.getWorkspaceSSHDestination(wsData!));
					}

					if (password) {
						try {
							await this.remoteService.showSSHPasswordModal(wsData!, password);
						} catch {
							return;
						}
					}

					// TODO: remove this, should not be needed
					await this.context.globalState.update(`${SSH_DEST_KEY}${sshDest.toRemoteSSHString()}`, { workspaceId: wsData!.id, gitpodHost: this.hostService.gitpodHost, instanceId: '' } as SSHConnectionParams);

					await vscode.commands.executeCommand(
						'vscode.openFolder',
						vscode.Uri.parse(`vscode-remote://ssh-remote+${sshDest.toRemoteSSHString()}${wsData!.recentFolders[0] || `/workspace/${wsData!.repo}`}`),
						{ forceNewWindow: true }
					);
				}
			);
		} catch (e) {
			this.logService.error(e);
			this.telemetryService.sendTelemetryException(new WrapError('Error runnning connectInNewWindow command', e));
			throw e;
		} finally {
			wsState.dispose();
		}
	}

	private async initializeLocalSSH(workspaceId: string) {
		try {
			await Promise.all([
				this.remoteService.setupSSHProxy(),
				this.remoteService.startLocalSSHServiceServer()
			]);
		} catch (e) {
			const openSSHVersion = await getOpenSSHVersion();
			this.telemetryService.sendTelemetryException(new WrapError('Local SSH: failed to initialize local SSH', e), {
				gitpodHost: this.hostService.gitpodHost,
				openSSHVersion,
				workspaceId

			});
			this.logService.error(`Local SSH: failed to initialize local SSH`, e);
		}
	}
}

export class ConnectInNewWindowCommandContext extends ConnectInNewWindowCommand {
	override readonly id = 'gitpod.workspaces.connectInNewWindow_context';

	constructor(
		context: vscode.ExtensionContext,
		remoteService: IRemoteService,
		sessionService: ISessionService,
		hostService: IHostService,
		experimentsService: IExperimentsService,
		telemetryService: ITelemetryService,
		logService: ILogService,
	) {
		super(context, remoteService, sessionService, hostService, experimentsService, telemetryService, logService);
	}
}

export class ConnectInCurrentWindowCommand implements Command {
	readonly id: string = 'gitpod.workspaces.connectInCurrentWindow';

	private running = false;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly remoteService: IRemoteService,
		private readonly sessionService: ISessionService,
		private readonly hostService: IHostService,
		private readonly experimentsService: IExperimentsService,
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
			name: getCommandName(this.id),
			gitpodHost: this.hostService.gitpodHost,
			workspaceId: wsData.id,
			location: getCommandLocation(this.id, treeItem)
		});

		let wsState = new WorkspaceState(wsData!.id, this.sessionService, this.logService);
		try {
			await wsState.initialize();
			if (wsState.isWorkspaceStopping) {
				// TODO: if stopping tell user to await until stopped to start again
				return;
			}
			await vscode.window.withProgress(
				{
					title: `Starting workspace ${wsData.id}`,
					location: vscode.ProgressLocation.Notification,
					cancellable: true
				},
				async (_, cancelToken) => {
					await this.initializeLocalSSH(wsData!.id);

					if (wsState.isWorkspaceStopped) {
						// Start workspace automatically
						await this.sessionService.getAPI().startWorkspace(wsData!.id);

						vscode.commands.executeCommand('gitpod.workspaces.refresh');

						if (cancelToken.isCancellationRequested) {
							return;
						}

						await raceCancellationError(eventToPromise(wsState.onWorkspaceRunning), cancelToken);
						wsData = wsState.workspaceData; // Update wsData with latest info after workspace is running
					}

					const domain = getLocalSSHDomain(this.hostService.gitpodHost);
					const sshHostname = `${wsData!.id}.${domain}`;
					const localSSHDestination = new SSHDestination(sshHostname, wsData!.id);
					let localSSHTestSuccess: boolean = false;
					try {
						await testLocalSSHConnection(localSSHDestination.user!, localSSHDestination.hostname);
						localSSHTestSuccess = true;
					} catch (e) {
						this.telemetryService.sendTelemetryException(
							new WrapError('Local SSH: failed to connect to workspace', e, 'Unknown'),
							{
								gitpodHost: this.hostService.gitpodHost,
								workspaceId: wsData!.id,
							}
						);
					}

					let sshDest: SSHDestination;
					let password: string | undefined;
					if (await this.experimentsService.getUseLocalSSHProxy() && localSSHTestSuccess) {
						sshDest = localSSHDestination;
					} else {
						({ destination: sshDest, password } = await this.remoteService.getWorkspaceSSHDestination(wsData!));
					}

					if (password) {
						try {
							await this.remoteService.showSSHPasswordModal(wsData!, password);
						} catch {
							return;
						}
					}

					// TODO: remove this, should not be needed
					await this.context.globalState.update(`${SSH_DEST_KEY}${sshDest.toRemoteSSHString()}`, { workspaceId: wsData!.id, gitpodHost: this.hostService.gitpodHost, instanceId: '' } as SSHConnectionParams);

					await vscode.commands.executeCommand(
						'vscode.openFolder',
						vscode.Uri.parse(`vscode-remote://ssh-remote+${sshDest.toRemoteSSHString()}${wsData!.recentFolders[0] || `/workspace/${wsData!.repo}`}`),
						{ forceNewWindow: false }
					);
				}
			);
		} catch (e) {
			this.logService.error(e);
			this.telemetryService.sendTelemetryException(new WrapError('Error runnning connectInCurrentWindow command', e));
			throw e;
		} finally {
			wsState.dispose();
		}
	}

	private async initializeLocalSSH(workspaceId: string) {
		try {
			await Promise.all([
				this.remoteService.setupSSHProxy(),
				this.remoteService.startLocalSSHServiceServer()
			]);
		} catch (e) {
			const openSSHVersion = await getOpenSSHVersion();
			this.telemetryService.sendTelemetryException(new WrapError('Local SSH: failed to initialize local SSH', e), {
				gitpodHost: this.hostService.gitpodHost,
				openSSHVersion,
				workspaceId

			});
			this.logService.error(`Local SSH: failed to initialize local SSH`, e);
		}
	}
}

export class ConnectInCurrentWindowCommandContext extends ConnectInCurrentWindowCommand {
	override readonly id = 'gitpod.workspaces.connectInCurrentWindow_context';

	constructor(
		context: vscode.ExtensionContext,
		remoteService: IRemoteService,
		sessionService: ISessionService,
		hostService: IHostService,
		experimentsService: IExperimentsService,
		telemetryService: ITelemetryService,
		logService: ILogService,
	) {
		super(context, remoteService, sessionService, hostService, experimentsService, telemetryService, logService);
	}
}

export class ConnectInCurrentWindowCommandContext_1 extends ConnectInCurrentWindowCommand {
	override readonly id = 'gitpod.workspaces.connectInCurrentWindow_context@1';

	constructor(
		context: vscode.ExtensionContext,
		remoteService: IRemoteService,
		sessionService: ISessionService,
		hostService: IHostService,
		experimentsService: IExperimentsService,
		telemetryService: ITelemetryService,
		logService: ILogService,
	) {
		super(context, remoteService, sessionService, hostService, experimentsService, telemetryService, logService);
	}
}

export class ConnectInCurrentWindowCommandInline extends ConnectInCurrentWindowCommand {
	override readonly id = 'gitpod.workspaces.connectInCurrentWindow_inline';

	constructor(
		context: vscode.ExtensionContext,
		remoteService: IRemoteService,
		sessionService: ISessionService,
		hostService: IHostService,
		experimentsService: IExperimentsService,
		telemetryService: ITelemetryService,
		logService: ILogService,
	) {
		super(context, remoteService, sessionService, hostService, experimentsService, telemetryService, logService);
	}
}

export class ConnectInCurrentWindowCommandInline_1 extends ConnectInCurrentWindowCommand {
	override readonly id = 'gitpod.workspaces.connectInCurrentWindow_inline@1';

	constructor(
		context: vscode.ExtensionContext,
		remoteService: IRemoteService,
		sessionService: ISessionService,
		hostService: IHostService,
		experimentsService: IExperimentsService,
		telemetryService: ITelemetryService,
		logService: ILogService,
	) {
		super(context, remoteService, sessionService, hostService, experimentsService, telemetryService, logService);
	}
}

export class StopWorkspaceCommand implements Command {
	readonly id: string = 'gitpod.workspaces.stopWorkspace';

	constructor(
		private readonly sessionService: ISessionService,
		private readonly hostService: IHostService,
		private readonly telemetryService: ITelemetryService,
	) { }

	async execute(treeItem?: { id: string }) {
		let workspaceId: string | undefined;
		if (!treeItem?.id) {
			workspaceId = (await showWorkspacesPicker(this.sessionService, 'Select a workspace to stop...'))?.id;
		} else {
			workspaceId = treeItem.id;
		}

		if (!workspaceId) {
			return;
		}

		this.telemetryService.sendTelemetryEvent('vscode_desktop_view_command', {
			name: getCommandName(this.id),
			gitpodHost: this.hostService.gitpodHost,
			workspaceId,
			location: getCommandLocation(this.id, treeItem)
		});

		await this.sessionService.getAPI().stopWorkspace(workspaceId);
		vscode.commands.executeCommand('gitpod.workspaces.refresh');
	}
}

export class StopWorkspaceCommandContext extends StopWorkspaceCommand {
	override readonly id = 'gitpod.workspaces.stopWorkspace_context';

	constructor(
		sessionService: ISessionService,
		hostService: IHostService,
		telemetryService: ITelemetryService,
	) {
		super(sessionService, hostService, telemetryService);
	}
}

export class StopWorkspaceCommandInline extends StopWorkspaceCommand {
	override readonly id = 'gitpod.workspaces.stopWorkspace_inline';

	constructor(
		sessionService: ISessionService,
		hostService: IHostService,
		telemetryService: ITelemetryService,
	) {
		super(sessionService, hostService, telemetryService);
	}
}

export class StopCurrentWorkspaceCommand implements Command {
	readonly id = 'gitpod.workspaces.stopCurrentWorkspace';

	constructor(
		private readonly workspaceId: string | undefined,
		private readonly sessionService: ISessionService,
		private readonly hostService: IHostService,
		private readonly telemetryService: ITelemetryService,
	) { }

	async execute() {
		if (!this.workspaceId) {
			return;
		}

		this.telemetryService.sendTelemetryEvent('vscode_desktop_view_command', {
			name: getCommandName(this.id),
			gitpodHost: this.hostService.gitpodHost,
			workspaceId: this.workspaceId,
			location: 'commandPalette'
		});

		await this.sessionService.getAPI().stopWorkspace(this.workspaceId);
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
			name: getCommandName(this.id),
			gitpodHost: this.hostService.gitpodHost,
			workspaceId: wsData.id,
			location: getCommandLocation(this.id, treeItem)
		});

		await vscode.env.openExternal(vscode.Uri.parse(wsData.workspaceUrl));
	}
}

export class DeleteWorkspaceCommand implements Command {
	readonly id: string = 'gitpod.workspaces.deleteWorkspace';

	constructor(
		private readonly sessionService: ISessionService,
		private readonly hostService: IHostService,
		private readonly telemetryService: ITelemetryService,
	) { }

	async execute(treeItem?: { id: string }) {
		let workspaceId: string | undefined;
		if (!treeItem?.id) {
			workspaceId = (await showWorkspacesPicker(this.sessionService, 'Select a workspace to delete...'))?.id;
		} else {
			workspaceId = treeItem.id;
		}

		if (!workspaceId) {
			return;
		}

		const deleteAction: string = 'Delete';
		const resp = await vscode.window.showWarningMessage(`Are you sure you want to delete workspace '${workspaceId}'?`, { modal: true }, deleteAction);
		if (resp !== deleteAction) {
			return;
		}

		this.telemetryService.sendTelemetryEvent('vscode_desktop_view_command', {
			name: getCommandName(this.id),
			gitpodHost: this.hostService.gitpodHost,
			workspaceId,
			location: getCommandLocation(this.id, treeItem)
		});

		await this.sessionService.getAPI().deleteWorkspace(workspaceId);
		vscode.commands.executeCommand('gitpod.workspaces.refresh');
	}
}

export class DeleteWorkspaceCommandContext extends DeleteWorkspaceCommand {
	override readonly id: string = 'gitpod.workspaces.deleteWorkspace_context';

	constructor(
		sessionService: ISessionService,
		hostService: IHostService,
		telemetryService: ITelemetryService,
	) {
		super(sessionService, hostService, telemetryService);
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

		const rawWsData = await this.sessionService.getAPI().getWorkspace(treeItem.id)
		const wsData = rawWorkspaceToWorkspaceData(await this.sessionService.getAPI().getWorkspace(treeItem.id));

		// Report if we couldn't parse contextUrl
		if (!wsData.contextUrl) {
			this.telemetryService.sendTelemetryException(new Error('Unable to parse workspace contextUrl'), {
				gitpodHost: this.hostService.gitpodHost,
				workspaceId: wsData.id,
				contextUrl: rawWsData.context?.contextUrl,
			});
			return;
		}

		this.telemetryService.sendTelemetryEvent('vscode_desktop_view_command', {
			name: getCommandName(this.id),
			gitpodHost: this.hostService.gitpodHost,
			workspaceId: wsData.id,
			location: getCommandLocation(this.id, treeItem)
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
