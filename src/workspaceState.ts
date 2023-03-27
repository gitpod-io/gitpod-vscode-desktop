/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WorkspaceStatus, WorkspaceInstanceStatus_Phase } from './lib/gitpod/experimental/v1/workspaces.pb';
import * as vscode from 'vscode';
import { Disposable } from './common/dispose';
import { ISessionService } from './services/sessionService';
import { ILogService } from './services/logService';

export class WorkspaceState extends Disposable {
    private workspaceState: WorkspaceStatus | undefined;

    private _onWorkspaceStatusChanged = this._register(new vscode.EventEmitter<void>());
    readonly onWorkspaceStatusChanged = this._onWorkspaceStatusChanged.event;

    constructor(
        readonly workspaceId: string,
        private readonly sessionService: ISessionService,
        private readonly logger: ILogService,
    ) {
        super();

        this.logger.trace(`WorkspaceState manager for workspace ${workspaceId} started`);

        const { onStatusChanged, dispose } = this.sessionService.getAPI().workspaceStatusStreaming(workspaceId);
        this._register(onStatusChanged(u => this.checkWorkspaceState(u)));
        this._register({ dispose });
    }

    public isWorkspaceStopped() {
        const phase = this.workspaceState?.instance?.status?.phase;
        return phase === WorkspaceInstanceStatus_Phase.PHASE_STOPPED || phase === WorkspaceInstanceStatus_Phase.PHASE_STOPPING;
    }

    public isWorkspaceRunning() {
        const phase = this.workspaceState?.instance?.status?.phase;
        return phase === WorkspaceInstanceStatus_Phase.PHASE_RUNNING;
    }

    public workspaceUrl() {
        return this.workspaceState?.instance?.status?.url;
    }

    public getInstanceId() {
        return this.workspaceState?.instance?.instanceId;
    }

    private async checkWorkspaceState(workspaceState: WorkspaceStatus | undefined) {
        const phase = workspaceState?.instance?.status?.phase;
        const oldPhase = this.workspaceState?.instance?.status?.phase;
        this.workspaceState = workspaceState;
        if (phase && oldPhase && phase !== oldPhase) {
            this._onWorkspaceStatusChanged.fire();
        }
    }
}
