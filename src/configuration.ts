/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

// Use these functions instead of `vscode.workspace.getConfiguration` API
// When activating the extension early with `onResolveRemoteAuthority:ssh-remote`, default values
// are not available yet and will return `undefined` so we hardcode the defaults here

function getGitpodHost() {
    return vscode.workspace.getConfiguration('gitpod').get<string>('host') || 'https://gitpod.io/';
}

function getUseLocalApp() {
    return vscode.workspace.getConfiguration('gitpod').get<boolean>('remote.useLocalApp') || false;
}

function getLocalSshExtensionIpcPort() {
    let defaultPort = 43025;
    if (vscode.env.appName.includes('Insiders')) {
        defaultPort = 43026;
    }
    return vscode.workspace.getConfiguration('gitpod').get<number>('lsshExtensionIpcPort') || defaultPort;
}

export const Configuration = {
    getGitpodHost,
    getUseLocalApp,
    getLocalSshExtensionIpcPort,
};
