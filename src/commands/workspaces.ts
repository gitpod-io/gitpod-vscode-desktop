/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Command } from '../commandManager';
import { ISessionService } from '../services/sessionService';
import { WorkspaceState } from '../workspaceState';
import { ILogService } from '../services/logService';
import { eventToPromise } from '../common/event';

export class ConnectInCurrentWindowCommandInternal implements Command {
	readonly id = 'gitpod.workspaces.connectInCurrentWindow_internal';

	constructor(
		private readonly sessionService: ISessionService,
		private readonly logService: ILogService,
	) { }

	async execute(workspaceId: string, gitpodHost: string, remoteUri: vscode.Uri) {
		const success = await vscode.window.withProgress(
			{
				title: `Starting workspace ${workspaceId}`,
				location: vscode.ProgressLocation.Notification
			},
			async () => {
				let wsState: WorkspaceState | undefined;
				try {
					wsState = new WorkspaceState(workspaceId, this.sessionService, this.logService);
					await wsState.initialize();

					if (wsState.isWorkspaceRunning) {
						return true;
					}

					if (wsState.isWorkspaceStopping) {
						return false;
					}

					// Start workspace automatically
					await this.sessionService.getAPI().startWorkspace(workspaceId);
					await eventToPromise(wsState.onWorkspaceRunning);
					return true;
				} finally {
					wsState?.dispose();
				}
			}
		);

		if (success) {
			vscode.commands.executeCommand(
				'vscode.openFolder',
				remoteUri,
				{ forceNewWindow: false }
			);
		} else {
			const retry = 'Retry';
			const cancel = 'Cancel';
			const resp = await vscode.window.showInformationMessage(`Cannot start workspace ${workspaceId}. Please wait until the previous instance is completely stopped and try again.`, retry, cancel);
			if (resp === retry) {
				vscode.commands.executeCommand('gitpod.workspaces.connectInCurrentWindow_internal', workspaceId, gitpodHost, remoteUri);
			}
		}
	}
}
