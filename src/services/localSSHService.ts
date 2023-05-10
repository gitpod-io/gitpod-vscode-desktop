/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Disposable } from '../common/dispose';
import { ILogService } from './logService';
import { Configuration } from '../configuration';
import { IHostService } from './hostService';
import SSHConfiguration from '../ssh/sshConfig';
import { chmod } from 'fs/promises';

export interface ILocalSSHService {

    isSupportLocalSSH: boolean;
}

export class LocalSSHService extends Disposable implements ILocalSSHService {
    public isSupportLocalSSH: boolean = false;
    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly hostService: IHostService,
        private readonly logService: ILogService
    ) {
        super();
        this.copyClientScript().then(locations => {
            this.configureSettings(locations);
            this._register(vscode.workspace.onDidChangeConfiguration(async e => {
                if (
                    e.affectsConfiguration('gitpod.lsshExtensionIpcPort') ||
                    e.affectsConfiguration('gitpod.host') ||
                    e.affectsConfiguration('remote.SSH.configFile')
                ) {
                    this.configureSettings(locations);
                }
            }));
        }).catch(err => {
            this.logService.error(err, 'failed to copy local ssh client.js');
            this.isSupportLocalSSH = false;
        });
    }

    private async configureSettings(locations: { js: string; sh: string; bat: string }) {
        const newExtIpcPort = Configuration.getLocalSshExtensionIpcPort();
        const appName = vscode.env.appName.includes('Insiders') ? 'insiders' : 'stable';
        const starter = process.platform === 'win32' ? locations.bat : locations.sh;
        this.isSupportLocalSSH = await SSHConfiguration.configureLocalSSHSettings(appName, [this.hostService.gitpodHost], starter, locations.js, newExtIpcPort);
    }

    private async copyClientScript() {
        const [js, sh, bat] = await Promise.all([
            this.copyFileToGlobalStorage('out/local-ssh/client.js', 'gitpod-client.js'),
            this.copyFileToGlobalStorage('out/local-ssh/starter.sh', 'gitpod-client-starter.sh'),
            this.copyFileToGlobalStorage('out/local-ssh/starter.bat', 'gitpod-client-starter.bat'),
        ]);
        await chmod(sh, 0o755);
        return { js, sh, bat };
    }

    private async copyFileToGlobalStorage(filepath: string, destPath: string) {
        const absFilepath = this.context.asAbsolutePath(filepath);
        const fileUri = vscode.Uri.file(absFilepath);
        const destUri = vscode.Uri.joinPath(this.context.globalStorageUri, destPath);
        await vscode.workspace.fs.copy(fileUri, destUri, { overwrite: true });
        return destUri.fsPath;
    }
}
