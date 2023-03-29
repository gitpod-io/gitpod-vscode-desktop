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

function getUseLocalApp() {
    return vscode.workspace.getConfiguration('gitpod').get<boolean>('remote.useLocalApp', false);
}

export const Configuration = {
    getGitpodHost,
    getShowReleaseNotes,
    getUseLocalApp
};
