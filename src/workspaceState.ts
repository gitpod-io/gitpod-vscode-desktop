/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WorkspaceStatus, WorkspaceInstanceStatus_Phase } from '@gitpod/public-api/lib/gitpod/experimental/v1/workspaces_pb';
import * as vscode from 'vscode';
import { Disposable } from './common/dispose';
import { ISessionService } from './services/sessionService';
import { ILogService } from './services/logService';
import { filterEvent, onceEvent } from './common/event';
import { WorkspaceData, WorkspacePhase, rawWorkspaceToWorkspaceData } from './publicApi';

export class WorkspaceState extends Disposable {
    private _workspaceStatus: WorkspaceStatus | undefined;
    private _workspaceData: WorkspaceData | undefined;

    private _onWorkspaceStateChanged = this._register(new vscode.EventEmitter<void>());
    readonly onWorkspaceStateChanged = this._onWorkspaceStateChanged.event;

    readonly onWorkspaceRunning = onceEvent(filterEvent(this.onWorkspaceStateChanged, () => this.isWorkspaceRunning));
    readonly onWorkspaceWillStop = onceEvent(filterEvent(this.onWorkspaceStateChanged, () => this.isWorkspaceStopping || this.isWorkspaceStopped /* it's not guranteed to get stoppping state so check stopped too */));
    readonly onWorkspaceStopped = onceEvent(filterEvent(this.onWorkspaceStateChanged, () => this.isWorkspaceStopped));

    public get isWorkspaceStopping() {
        if (!this._workspaceData) {
            return false;
        }

        const phase = this._workspaceStatus?.instance?.status?.phase;
        return phase === WorkspaceInstanceStatus_Phase.STOPPING;
    }

    public get isWorkspaceStopped() {
        if (!this._workspaceData) {
            return false;
        }

        const phase = this._workspaceStatus?.instance?.status?.phase;
        return phase === WorkspaceInstanceStatus_Phase.STOPPED;
    }

    public get isWorkspaceRunning() {
        if (!this._workspaceData) {
            // If not initialized yet assume it's running
            return true;
        }

        const phase = this._workspaceStatus?.instance?.status?.phase;
        return phase === WorkspaceInstanceStatus_Phase.RUNNING;
    }

    public get instanceId() {
        return this._workspaceStatus?.instance?.instanceId;
    }

    public get workspaceData(): WorkspaceData {
        if (!this._workspaceData) {
            throw new Error('WorkspaceState not initialized');
        }
        return this._workspaceData;
    }

    constructor(
        public readonly workspaceId: string,
        private readonly sessionService: ISessionService,
        private readonly logService: ILogService,
    ) {
        super();

        this.logService.trace(`WorkspaceState manager for workspace ${workspaceId} started`);

        const { onStatusChanged, dispose } = this.sessionService.getAPI().workspaceStatusStreaming(workspaceId);
        this._register(onStatusChanged(u => this.checkWorkspaceState(u)));
        this._register({ dispose });
    }

    public async initialize() {
        const ws = await this.sessionService.getAPI().getWorkspace(this.workspaceId);
        this._workspaceData = rawWorkspaceToWorkspaceData(ws);
        this.checkWorkspaceState(ws.status!);
    }

    private checkWorkspaceState(workspaceState: WorkspaceStatus) {
        if (!this._workspaceData) {
            return;
        }

        const phase = workspaceState.instance?.status?.phase;
        const oldPhase = this._workspaceStatus?.instance?.status?.phase;
        this._workspaceStatus = workspaceState;

        this._workspaceData!.workspaceUrl = workspaceState.instance!.status!.url;
        this._workspaceData!.phase = WorkspaceInstanceStatus_Phase[workspaceState.instance!.status!.phase ?? WorkspaceInstanceStatus_Phase.UNSPECIFIED].toLowerCase() as WorkspacePhase;
        this._workspaceData!.lastUsed = workspaceState.instance!.createdAt!.toDate();
        this._workspaceData!.recentFolders = workspaceState.instance!.status!.recentFolders;

        if (typeof phase !== undefined && phase !== oldPhase) {
            this.logService.trace(`WorkspaceState: update state`, this._workspaceData!.phase);
            this._onWorkspaceStateChanged.fire();
        }
    }
}
