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
        this.copyClientScript().then(scriptLocation => {
            this.configureSettings(scriptLocation);
            this._register(vscode.workspace.onDidChangeConfiguration(async e => {
                if (
                    e.affectsConfiguration('gitpod.lsshExtensionIpcPort') ||
                    e.affectsConfiguration('gitpod.host') ||
                    e.affectsConfiguration('remote.SSH.configFile')
                ) {
                    this.configureSettings(scriptLocation);   
                }
            }));
        }).catch(err => {
            this.logService.error(err, 'failed to copy local ssh client.js');
            this.isSupportLocalSSH = false;
        });
    }

    private async configureSettings(scriptLocation: string) {
        const newExtIpcPort = Configuration.getLocalSshExtensionIpcPort();
        const appName = vscode.env.appName.includes('Insiders') ? 'insiders' : 'stable';
        this.isSupportLocalSSH = await SSHConfiguration.configureLocalSSHSettings(appName, [this.hostService.gitpodHost], scriptLocation, newExtIpcPort);
    }

    async copyClientScript() {
		// Copy local ssh client.js to global storage
		const clientJsPath = this.context.asAbsolutePath('out/local-ssh/client.js');
		const clientJsUri = vscode.Uri.file(clientJsPath);
		const clientJsDestUri = vscode.Uri.joinPath(this.context.globalStorageUri, 'gitpod-client.js');
		await vscode.workspace.fs.copy(clientJsUri, clientJsDestUri, { overwrite: true });
        return clientJsDestUri.fsPath;
    }
}
