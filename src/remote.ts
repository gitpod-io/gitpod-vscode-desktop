/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export interface SSHConnectionParams {
	workspaceId: string;
	instanceId: string;
	gitpodHost: string;
	debugWorkspace?: boolean;
	connType?: 'local-app' | 'local-ssh' | 'ssh-gateway';
}

export interface WorkspaceRestartInfo {
	workspaceId: string;
	gitpodHost: string;
	remoteUri: string;
}

export class NoRunningInstanceError extends Error {
	code = 'NoRunningInstanceError';
	constructor(readonly workspaceId: string, readonly phase?: string) {
		super(`Failed to connect to Gitpod workspace, workspace not running: ${phase}`);
		this.name = 'NoRunningInstanceError';
	}
}

export class NoSSHGatewayError extends Error {
	code = 'NoSSHGatewayError';
	constructor(readonly host: string) {
		super(`SSH gateway not configured for this Gitpod Host ${host}`);
		this.name = 'NoSSHGatewayError';
	}
}

export class NoExtensionIPCServerError extends Error {
	code = 'NoExtensionIPCServer';
	constructor() {
		super('No Extension IPC Server running');
		this.name = 'NoExtensionIPCServerError';
	}
}

export class NoLocalSSHSupportError extends Error {
	code = 'NoLocalSSHSupport';
	constructor() {
		super('No Local SSH support');
		this.name = 'NoLocalSSHSupportError';
	}
}

export const SSH_DEST_KEY = 'ssh-dest:';
export const WORKSPACE_STOPPED_PREFIX = 'stopped_workspace:';

export function getGitpodRemoteWindowConnectionInfo(context: vscode.ExtensionContext): { connectionInfo: SSHConnectionParams; remoteUri: vscode.Uri; sshDestStr: string } | undefined {
	const remoteUri = vscode.workspace.workspaceFile?.scheme !== 'untitled'
		? vscode.workspace.workspaceFile || vscode.workspace.workspaceFolders?.[0].uri
		: vscode.workspace.workspaceFolders?.[0].uri;
	if (vscode.env.remoteName === 'ssh-remote' && context.extension.extensionKind === vscode.ExtensionKind.UI && remoteUri) {
		const [, sshDestStr] = remoteUri.authority.split('+');
		const connectionInfo = context.globalState.get<SSHConnectionParams>(`${SSH_DEST_KEY}${sshDestStr}`);
		if (connectionInfo) {
			return { connectionInfo, remoteUri, sshDestStr };
		}
	}

	return undefined;
}

export function getLocalSSHDomain(gitpodHost: string): string {
	const scope = vscode.env.appName.includes('Insiders') ? 'vsi' : 'vss';
	return `${scope}.` + (new URL(gitpodHost)).hostname;
}
