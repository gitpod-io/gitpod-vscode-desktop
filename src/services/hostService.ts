/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Disposable } from '../common/dispose';
import { INotificationService } from './notificationService';
import { getGitpodRemoteWindowConnectionInfo } from '../remote';
import { UserFlowTelemetryProperties } from '../common/telemetry';
import { ILogService } from './logService';
import { Configuration } from '../configuration';

export interface IHostService {
    gitpodHost: string;

    onDidChangeHost: vscode.Event<void>;

    changeHost(newHost: string, force?: boolean): Promise<boolean>;
    updateSSHRemotePlatform(): Promise<void>;
}

export class HostService extends Disposable implements IHostService {

    private _gitpodHost: string;

    private readonly _onDidChangeHost = this._register(new vscode.EventEmitter<void>());
    public readonly onDidChangeHost = this._onDidChangeHost.event;

    get gitpodHost() {
        return this._gitpodHost;
    }

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly notificationService: INotificationService,
        private readonly logService: ILogService
    ) {
        super();

        this._gitpodHost = Configuration.getGitpodHost();

        this._register(vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('gitpod.host')) {
                if (e.affectsConfiguration('[javascript]') && e.affectsConfiguration('[markdown]')) {
                    // Seems onDidChangeConfiguration fires many times while resolving the remote (once with all settings),
                    // and because now we active the extension earlier with onResolveRemoteAuthority we get this false positive
                    // event, so ignore it if more settings are affected at the same time.
                    return;
                }
                const newGitpodHost = Configuration.getGitpodHost();
                if (new URL(this._gitpodHost).host !== new URL(newGitpodHost).host) {
                    this._gitpodHost = newGitpodHost;
                    this._onDidChangeHost.fire();
                    this.updateSSHRemotePlatform().then(() => {});
                }
            }
        }));
    }

    async changeHost(newHost: string, skipRemoteWindowCheck: boolean = false) {
        if (new URL(this._gitpodHost).host !== new URL(newHost).host) {
            const flow: UserFlowTelemetryProperties = { flow: 'changeHost', gitpodHost: newHost };

            // Don't allow to change gitpod host if we are in a remote window
            if (!skipRemoteWindowCheck && !!getGitpodRemoteWindowConnectionInfo(this.context)) {
                this.notificationService.showWarningMessage(`Cannot to swith to '${newHost}' while connected to '${this._gitpodHost}'. Please close the window first`, { id: 'switch_gitpod_host_remote_window', flow });
                return false;
            }

            const yes = 'Yes';
            const cancel = 'Cancel';
            const action = await this.notificationService.showInformationMessage(`Would you like to change your Gitpod host from '${this._gitpodHost}' to '${newHost}' and continue?`, { id: 'switch_gitpod_host', flow }, yes, cancel);
            if (action === cancel) {
                return false;
            }

            await vscode.workspace.getConfiguration('gitpod').update('host', newHost, vscode.ConfigurationTarget.Global);
            this.logService.info(`Updated 'gitpod.host' setting to '${newHost}'`);
        }
        return true;
    }

    // Force Linux as host platform (https://github.com/gitpod-io/gitpod/issues/16058)
    async updateSSHRemotePlatform() {
        try {
            const hostname = '*.' + (new URL(this.gitpodHost)).hostname;
            const existingSSHHostPlatforms = vscode.workspace.getConfiguration('remote.SSH').get<{ [host: string]: string }>('remotePlatform', {});
            const targetPlatform = 'linux';
            if (!existingSSHHostPlatforms[hostname] || existingSSHHostPlatforms[hostname] !== targetPlatform) {
                await vscode.workspace.getConfiguration('remote.SSH').update('remotePlatform', { ...existingSSHHostPlatforms, [hostname]: targetPlatform }, vscode.ConfigurationTarget.Global);
            }
        } catch (error) {
            this.logService.error('Error updating remotePlatform configuration', error);
        }
    }
}
