/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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

function getLocalSSHServerPort() {
    // TODO(local-ssh): VSCodium?
    let defaultPort = 42025; // use `sudo lsof -i:42025` to check if the port is already in use
    if (vscode.env.appName.includes('Insiders')) {
        defaultPort = 42026;
    }
    return vscode.workspace.getConfiguration('gitpod').get<number>('lsshPort', defaultPort);
}

function getDaemonLogPath(): string {
    if (vscode.env.appName.includes('Insiders')) {
        return '/tmp/gitpod-vscode-daemon-insiders.log';
    }
    return '/tmp/gitpod-vscode-daemon.log';
}

export const Configuration = {
    getGitpodHost,
    getShowReleaseNotes,
    getUseLocalApp,
    getLocalSSHServerPort,
    getDaemonLogPath,
};
