/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { UserFlowTelemetry } from './services/telemetryService';
import { INotificationService } from './services/notificationService';
import { ILogService } from './services/logService';

export interface SSHConnectionParams {
    workspaceId: string;
    instanceId: string;
    gitpodHost: string;
    debugWorkspace?: boolean;
}

export interface WorkspaceRestartInfo {
    workspaceId: string;
    gitpodHost: string;
}

export class NoRunningInstanceError extends Error {
    constructor(readonly workspaceId: string, readonly phase?: string) {
        super(`Failed to connect to ${workspaceId} Gitpod workspace, workspace not running: ${phase}`);
    }
}

export class NoSSHGatewayError extends Error {
    constructor(readonly host: string) {
        super(`SSH gateway not configured for this Gitpod Host ${host}`);
    }
}

export const SSH_DEST_KEY = 'ssh-dest:';

export function getGitpodRemoteWindowConnectionInfo(context: vscode.ExtensionContext): { remoteAuthority: string; connectionInfo: SSHConnectionParams } | undefined {
    const remoteUri = vscode.workspace.workspaceFile || vscode.workspace.workspaceFolders?.[0].uri;
    if (vscode.env.remoteName === 'ssh-remote' && context.extension.extensionKind === vscode.ExtensionKind.UI && remoteUri) {
        const [, sshDestStr] = remoteUri.authority.split('+');
        const connectionInfo = context.globalState.get<SSHConnectionParams>(`${SSH_DEST_KEY}${sshDestStr}`);
        if (connectionInfo) {
            return { remoteAuthority: remoteUri.authority, connectionInfo };
        }
    }

    return undefined;
}

export async function showWsNotRunningDialog(workspaceId: string, gitpodHost: string, flow: UserFlowTelemetry, notificationService: INotificationService, logService: ILogService) {
    const msg = `Workspace ${workspaceId} is not running. Please restart the workspace.`;
    logService.error(msg);

    const workspaceUrl = new URL(gitpodHost);
    workspaceUrl.pathname = '/start';
    workspaceUrl.hash = workspaceId;

    const openUrl = 'Restart workspace';
    const resp = await notificationService.showErrorMessage(msg, { id: 'ws_not_running', flow, modal: true }, openUrl);
    if (resp === openUrl) {
        const opened = await vscode.env.openExternal(vscode.Uri.parse(workspaceUrl.toString()));
        if (opened) {
            vscode.commands.executeCommand('workbench.action.closeWindow');
        }
    }
}

export function getLocalSSHDomain(gitpodHost: string): string {
	const scope = vscode.env.appName.includes('Insiders') ? 'vsi' : 'vss';
	return `${scope}.` + (new URL(gitpodHost)).hostname;
}
