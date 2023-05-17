/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import fsp from 'fs/promises';
import { Disposable } from '../common/dispose';
import { ILogService } from './logService';
import { Configuration } from '../configuration';
import { IHostService } from './hostService';
import SSHConfiguration from '../ssh/sshConfig';
import { isWindows } from '../common/platform';
import { getLocalSSHDomain } from '../remote';
import { ITelemetryService } from './telemetryService';

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
        private readonly telemetryService: ITelemetryService,
        private readonly logService: ILogService
    ) {
        super();

        this.initialized = this.initialize();

        this._register(vscode.workspace.onDidChangeConfiguration(async e => {
            if (
                e.affectsConfiguration('gitpod.lsshExtensionIpcPort') ||
                e.affectsConfiguration('gitpod.host') ||
                e.affectsConfiguration('remote.SSH.configFile')
            ) {
                if (e.affectsConfiguration('[javascript]') && e.affectsConfiguration('[markdown]')) {
                    // Seems onDidChangeConfiguration fires many times while resolving the remote (once with all settings),
                    // and because now we active the extension earlier with onResolveRemoteAuthority we get this false positive
                    // event, so ignore it if more settings are affected at the same time.
                    return;
                }
                if (this.initialized) {
                    await this.initialized;
                }
                this.initialized = this.initialize();
            }
        }));
    }

    private async initialize() {
        if (this.context.extensionMode !== vscode.ExtensionMode.Production) {
            // TODO: add webpack config for client.js in development, for now copy manually
            this.isSupportLocalSSH = true;
            return;
        }

        try {
            const locations = await this.copyProxyScript();
            await this.configureSettings(locations);
            this.isSupportLocalSSH = true;
        } catch (e) {
            this.logService.error(e, 'failed to copy local ssh client.js');
            if (e.message) {
                e.message = `Failed to copy local ssh client.js: ${e.message}`;
            }
            this.telemetryService.sendTelemetryException(this.hostService.gitpodHost, e);
            this.isSupportLocalSSH = false;
        }
    }

    private async configureSettings({ proxyScript, launcher }: { proxyScript: string; launcher: string }) {
        const extIpcPort = Configuration.getLocalSshExtensionIpcPort();
        const hostConfig = this.getHostSSHConfig(this.hostService.gitpodHost, launcher, proxyScript, extIpcPort);
        await SSHConfiguration.ensureIncludeGitpodSSHConfig();
        const gitpodConfig = await SSHConfiguration.loadGitpodSSHConfig();
        gitpodConfig.addHostConfiguration(hostConfig);
        await SSHConfiguration.saveGitpodSSHConfig(gitpodConfig);
    }

    private getHostSSHConfig(host: string, launcher: string, proxyScript: string, extIpcPort: number) {
        return {
            Host: '*.' + getLocalSSHDomain(host),
            StrictHostKeyChecking: 'no',
            ProxyCommand: `"${launcher}" "${process.execPath}" "${proxyScript}" --ms-enable-electron-run-as-node %h ${extIpcPort}`
        };
    }

    private async copyProxyScript() {
        const [proxyScript, launcher] = await Promise.all([
            this.copyFileToGlobalStorage('out/local-ssh/proxy.js', 'sshproxy/proxy.js'),
            isWindows ? this.copyFileToGlobalStorage('out/local-ssh/proxylauncher.bat', 'sshproxy/proxylauncher.bat') : this.copyFileToGlobalStorage('out/local-ssh/proxylauncher.sh', 'sshproxy/proxylauncher.sh')
        ]);
        if (!isWindows) {
            await fsp.chmod(launcher, 0o755);
        }
        return { proxyScript, launcher };
    }

    private async copyFileToGlobalStorage(filepath: string, destPath: string) {
        const absFilepath = this.context.asAbsolutePath(filepath);
        const fileUri = vscode.Uri.file(absFilepath);
        const destUri = vscode.Uri.joinPath(this.context.globalStorageUri, destPath);
        await vscode.workspace.fs.copy(fileUri, destUri, { overwrite: true });
        return destUri.fsPath;
    }
}
