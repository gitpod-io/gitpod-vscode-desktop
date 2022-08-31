/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as util from 'util';
import * as vscode from 'vscode';

const exec = util.promisify(cp.exec);

let version: string | undefined;
export async function getOpenSSHVersion(): Promise<string | undefined> {
    if (version) {
        return version;
    }

    try {
        const sshPath = vscode.workspace.getConfiguration('remote.SSH').get<string>('path');
        const { stdout, stderr } = await exec(`${sshPath || 'ssh'} -V`, { timeout: 3000 });
        const match = /\bOpenSSH[A-Za-z0-9_\-\.]+\b/.exec(stderr.trim() || stdout.trim());
        if (match) {
            version = match[0];
            return version;
        }
    } catch {
    }
    return undefined;
}
