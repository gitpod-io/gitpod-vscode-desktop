/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import fsp from 'fs/promises';
import Handlebars from 'handlebars';
import { Disposable } from '../common/dispose';
import { ILogService } from './logService';
import { Configuration } from '../configuration';
import { IHostService } from './hostService';
import SSHConfiguration from '../ssh/sshConfig';

export interface ILocalSSHService {
    isSupportLocalSSH: boolean;
    initialized: Promise<void>;
}

export class LocalSSHService extends Disposable implements ILocalSSHService {
    public isSupportLocalSSH: boolean = false;
    public initialized: Promise<void>;
    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly hostService: IHostService,
        private readonly logService: ILogService
    ) {
        super();
        this.initialized = this.copyClientScript().then(async locations => {
            await this.configureSettings(locations);
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
        const configContent = await this.getLocalSSHConfig(appName, [this.hostService.gitpodHost], starter, locations.js, newExtIpcPort);
        this.isSupportLocalSSH = await SSHConfiguration.includeLocalSSHConfig(appName, configContent);
    }

    private async getLocalSSHConfig(scopeName: string, hosts: string[], starter: string, jsLocation: string, extIpcPort: number) {
        hosts = hosts.map(host => host.replace(/^[^:]+:\/\//, ''));
        const render = Handlebars.compile(`{{#each hosts}}
### {{this}}
Host *.{{../scopeName}}.lssh.{{this}}
    StrictHostKeyChecking no
    ProxyCommand "{{../execPath}}" "{{../nodeLocation}}" "{{../jsLocation}}" --ms-enable-electron-run-as-node %h {{../port}} "{{../logPath}}"
{{/each}}`);
        const newContent = render({ scopeName, hosts, jsLocation, port: extIpcPort, execPath: starter, nodeLocation: process.execPath, logPath: Configuration.getLocalSSHLogPath() });
        return newContent;
    }

    private async copyClientScript() {
        const [js, sh, bat] = await Promise.all([
            this.copyFileToGlobalStorage('out/local-ssh/client.js', 'lssh-client.js'),
            this.copyFileToGlobalStorage('out/local-ssh/starter.sh', 'lssh-starter.sh'),
            this.copyFileToGlobalStorage('out/local-ssh/starter.bat', 'lssh-starter.bat'),
        ]);
        await fsp.chmod(sh, 0o755);
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
