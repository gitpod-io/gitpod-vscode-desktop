/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Disposable } from '../common/dispose';
import { GitpodVersion, getGitpodVersion } from '../featureSupport';
import { INotificationService } from './notificationService';
import { getGitpodRemoteWindowConnectionInfo } from '../remote';
import { UserFlowTelemetry } from './telemetryService';
import { ILogService } from './logService';

export interface IHostService {
    gitpodHost: string;

    onDidChangeHost: vscode.Event<void>;

    changeHost(newHost: string, force?: boolean): Promise<boolean>;
    getVersion(): Promise<GitpodVersion>;
}

export class HostService extends Disposable implements IHostService {

    private _gitpodHost: string;
    private _version: GitpodVersion | undefined;

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

        this._gitpodHost = vscode.workspace.getConfiguration('gitpod').get<string>('host')!;

        this._register(vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('gitpod.host')) {
                const newGitpodHost = vscode.workspace.getConfiguration('gitpod').get<string>('host')!;
                if (new URL(this._gitpodHost).host !== new URL(newGitpodHost).host) {
                    this._gitpodHost = newGitpodHost;
                    this._version = undefined;
                    this._onDidChangeHost.fire();
                }
            }
        }));
    }

    async changeHost(newHost: string, skipRemoteWindowCheck: boolean = false) {
        if (new URL(this._gitpodHost).host !== new URL(newHost).host) {
            const flow: UserFlowTelemetry = { flow: 'changeHost', gitpodHost: newHost };

            // Don't allow to change gitpod host if we are in a remote window
            if (!skipRemoteWindowCheck && !!getGitpodRemoteWindowConnectionInfo(this.context)) {
                this.notificationService.showWarningMessage(`Cannot to swith to '${newHost}' while connected to '${this._gitpodHost}'. Please close the window first`, { id: 'switch_gitpod_host_remote_window', flow });
                return false;
            }

            const yes = 'Yes';
            const cancel = 'Cancel';
            const action = await this.notificationService.showInformationMessage(`Connecting to '${newHost}' Gitpod host. Would you like to switch from '${this._gitpodHost}' and continue?`, { id: 'switch_gitpod_host', flow }, yes, cancel);
            if (action === cancel) {
                return false;
            }

            await vscode.workspace.getConfiguration('gitpod').update('host', newHost, vscode.ConfigurationTarget.Global);
            this.logService.info(`Updated 'gitpod.host' setting to '${newHost}'`);
        }
        return true;
    }

    async getVersion() {
        if (!this._version) {
            this._version = await getGitpodVersion(this._gitpodHost, this.logService);
        }
        return this._version;
    }
}