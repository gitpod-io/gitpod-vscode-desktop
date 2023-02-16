/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WorkspaceStatus } from '@gitpod/public-api/lib/gitpod/experimental/v1';
import { WorkspaceInstanceStatus_Phase } from '@gitpod/public-api/lib/gitpod/experimental/v1/workspaces_pb';
import * as vscode from 'vscode';
import { Disposable } from './common/dispose';
import { GitpodPublicApi } from './publicApi';

export class WorkspaceState extends Disposable {

    static POLL_INTERVAL = 5000;

    private poolHandle: NodeJS.Timer | undefined;

    private workspaceStatePromiseResolver!: () => void;
    readonly workspaceStatePromise = new Promise<void>((r) => this.workspaceStatePromiseResolver = r);
    private workspaceState: WorkspaceStatus | undefined;

    private _onWorkspaceStatusChanged = this._register(new vscode.EventEmitter<void>());
    readonly onWorkspaceStatusChanged = this._onWorkspaceStatusChanged.event;

    constructor(
        readonly workspaceId: string,
        private readonly publicApi: GitpodPublicApi,
        private readonly logger: vscode.LogOutputChannel,
    ) {
        super();

        this.logger.trace(`WorkspaceState manager for workspace ${workspaceId} started`);

        // this._register(this.publicApi.onWorkspaceStatusUpdate(u => this.checkWorkspaceState(u)));
        // this.publicApi.startWorkspaceStatusStreaming(workspaceId);

        this.pollWorkspaceState();
        this.poolHandle = setInterval(() => {
            this.pollWorkspaceState();
        }, WorkspaceState.POLL_INTERVAL);
    }

    public isWorkspaceStopped() {
        const phase = this.workspaceState?.instance?.status?.phase;
        return phase === WorkspaceInstanceStatus_Phase.STOPPED || phase === WorkspaceInstanceStatus_Phase.STOPPING;
    }

    public isWorkspaceRunning() {
        const phase = this.workspaceState?.instance?.status?.phase;
        return phase === WorkspaceInstanceStatus_Phase.RUNNING;
    }

    public workspaceUrl() {
        return this.workspaceState?.instance?.status?.url;
    }

    public getInstanceId() {
        return this.workspaceState?.instance?.instanceId;
    }

    private async checkWorkspaceState(workspaceState: WorkspaceStatus |undefined) {
        const phase = workspaceState?.instance?.status?.phase;
        const oldPhase = this.workspaceState?.instance?.status?.phase;
        this.workspaceState = workspaceState;
        this.workspaceStatePromiseResolver();
        if (phase && oldPhase && phase !== oldPhase) {
            this._onWorkspaceStatusChanged.fire();
        }
    }

    private async pollWorkspaceState() {
        try {
            const workspaceState = await this.publicApi.getWorkspace(this.workspaceId)!;
            this.checkWorkspaceState(workspaceState?.status);
        } catch (err) {
            this.logger.error(`Failed to poll workspace ${this.workspaceId} state:`, err);
        }
    }

    private stopPolling() {
        if (this.poolHandle) {
            clearInterval(this.poolHandle);
            this.poolHandle = undefined;
        }
    }

    public override async dispose(): Promise<void> {
        this.stopPolling();
        super.dispose();
    }

}
