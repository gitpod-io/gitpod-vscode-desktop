/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WorkspaceStatus as WorkspaceStatus2, workspaceInstanceStatus_PhaseToJSON, admissionLevelToJSON } from './lib/gitpod/experimental/v1/workspaces.pb';
import { WorkspaceStatus, WorkspaceInstanceStatus_Phase } from '@gitpod/public-api/lib/gitpod/experimental/v1/workspaces_pb';
import * as vscode from 'vscode';
import { Disposable } from './common/dispose';
import { ISessionService } from './services/sessionService';
import { ILogService } from './services/logService';
import { filterEvent } from './common/utils';

export class WorkspaceState extends Disposable {
    private workspaceState: WorkspaceStatus | undefined;
    private _contextUrl: string | undefined;

    private _onWorkspaceStateChanged = this._register(new vscode.EventEmitter<void>());
    readonly onWorkspaceStateChanged = this._onWorkspaceStateChanged.event;

    readonly onWorkspaceRunning = filterEvent(this.onWorkspaceStateChanged, () => this.isWorkspaceRunning);
    readonly onWorkspaceStopped = filterEvent(this.onWorkspaceStateChanged, () => this.isWorkspaceStopping); // assuming stopping state is never skipped

    public get isWorkspaceStopping() {
        const phase = this.workspaceState?.instance?.status?.phase;
        return phase === WorkspaceInstanceStatus_Phase.STOPPING;
    }

    public get isWorkspaceStopped() {
        const phase = this.workspaceState?.instance?.status?.phase;
        return phase === WorkspaceInstanceStatus_Phase.STOPPED;
    }

    public get isWorkspaceRunning() {
        const phase = this.workspaceState?.instance?.status?.phase;
        return phase === WorkspaceInstanceStatus_Phase.RUNNING;
    }

    public get workspaceUrl() {
        return this.workspaceState?.instance?.status?.url;
    }

    public get instanceId() {
        return this.workspaceState?.instance?.instanceId;
    }

    public get contextUrl() {
        return this._contextUrl;
    }

    constructor(
        public readonly workspaceId: string,
        private readonly sessionService: ISessionService,
        private readonly logService: ILogService,
    ) {
        super();

        this.logService.trace(`WorkspaceState manager for workspace ${workspaceId} started`);

        const { onStatusChanged, dispose } = this.sessionService.getAPI().workspaceStatusStreaming(workspaceId);
        this._register(onStatusChanged(u => this.checkWorkspaceState(this.toWorkspaceStatus(u))));
        this._register({ dispose });
    }

    public async initialize() {
        const ws = await this.sessionService.getAPI().getWorkspace(this.workspaceId);
        this._contextUrl = ws.context?.contextUrl;
        this.workspaceState ??= ws?.status;
    }

    private async checkWorkspaceState(workspaceState: WorkspaceStatus | undefined) {
        const phase = workspaceState?.instance?.status?.phase;
        const oldPhase = this.workspaceState?.instance?.status?.phase;
        this.workspaceState = workspaceState;
        if (phase && oldPhase && phase !== oldPhase) {
            this._onWorkspaceStateChanged.fire();
        }
    }

    private toWorkspaceStatus(workspaceState: WorkspaceStatus2): WorkspaceStatus {
        return WorkspaceStatus.fromJson({
            instance: {
                instanceId: workspaceState.instance!.instanceId,
                workspaceId: workspaceState.instance!.workspaceId,
                createdAt: workspaceState.instance!.createdAt?.toISOString() ?? null,
                status: {
                    statusVersion: workspaceState.instance!.status!.statusVersion.toString(),
                    phase: workspaceInstanceStatus_PhaseToJSON(workspaceState.instance!.status!.phase),
                    conditions: null,
                    message: '',
                    url: workspaceState.instance!.status!.url,
                    admission: admissionLevelToJSON(workspaceState.instance!.status!.admission),
                    ports: []
                }
            }
        });
    }
}
