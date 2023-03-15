/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WorkspaceStatus, WorkspaceInstanceStatus_Phase } from './lib/gitpod/experimental/v1/workspaces.pb';
import * as vscode from 'vscode';
import { Disposable } from './common/dispose';
import { GitpodApi } from './gitpodApi';

export class WorkspaceState extends Disposable {

    private workspaceStatePromiseResolver!: () => void;
    readonly workspaceStatePromise = new Promise<void>((r) => this.workspaceStatePromiseResolver = r);
    private workspaceState: WorkspaceStatus | undefined;

    private _onWorkspaceStatusChanged = this._register(new vscode.EventEmitter<void>());
    readonly onWorkspaceStatusChanged = this._onWorkspaceStatusChanged.event;

    constructor(
        readonly workspaceId: string,
        private readonly gitpodApi: GitpodApi,
        private readonly logger: vscode.LogOutputChannel,
    ) {
        super();

        this.logger.trace(`WorkspaceState manager for workspace ${workspaceId} started`);

        this._register(this.gitpodApi.onWorkspaceStatusUpdate(u => this.checkWorkspaceState(u)));
        this.gitpodApi.startWorkspaceStatusStreaming(workspaceId);
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
        this.workspaceStatePromiseResolver();
        if (phase && oldPhase && phase !== oldPhase) {
            this._onWorkspaceStatusChanged.fire();
        }
    }

    public override async dispose(): Promise<void> {
        super.dispose();
    }

}
