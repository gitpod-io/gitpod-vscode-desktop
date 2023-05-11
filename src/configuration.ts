/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { tmpdir } from 'os';
import { join } from 'path';
import * as vscode from 'vscode';

// Use these functions instead of `vscode.workspace.getConfiguration` API
// When activating the extension early with `onResolveRemoteAuthority:ssh-remote`, default values
// are not available yet and will return `undefined` so we hardcode the defaults here

function getGitpodHost() {
    return vscode.workspace.getConfiguration('gitpod').get<string>('host', 'https://gitpod.io/');
}

function getShowReleaseNotes() {
    return vscode.workspace.getConfiguration('gitpod').get<boolean>('showReleaseNotes', true);
}

function getUseLocalApp(useLocalSSHServer?: boolean) {
    if (useLocalSSHServer) {
        return false;
    }
    return vscode.workspace.getConfiguration('gitpod').get<boolean>('remote.useLocalApp', false);
}

function getLocalSshExtensionIpcPort() {
    let defaultPort = 43025;
    if (vscode.env.appName.includes('Insiders')) {
        defaultPort = 43026;
    }
    return vscode.workspace.getConfiguration('gitpod').get<number>('lsshExtensionIpcPort', defaultPort) || defaultPort;
}

function getLocalSSHLogFileName(): string {
    if (vscode.env.appName.includes('Insiders')) {
        return 'gitpod-vscode-lssh-insiders.log';
    }
    return 'gitpod-vscode-lssh.log';
}

function getLocalSSHLogPath(): string {
    return join(tmpdir(), getLocalSSHLogFileName());
}

export const Configuration = {
    getGitpodHost,
    getShowReleaseNotes,
    getUseLocalApp,
    getLocalSshExtensionIpcPort,
    getLocalSSHLogPath,
};
