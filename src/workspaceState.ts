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

export type WorkspacePhase = 'unspecified' | 'preparing' | 'imagebuild' | 'pending' | 'creating' | 'initializing' | 'running' | 'interrupted' | 'stopping' | 'stopped';

export class WorkspaceState extends Disposable {
    private workspaceState: WorkspaceStatus | undefined;
    private _contextUrl: string | undefined;

    private _onWorkspaceStateChanged = this._register(new vscode.EventEmitter<void>());
    readonly onWorkspaceStateChanged = this._onWorkspaceStateChanged.event;

    readonly onWorkspaceRunning = onceEvent(filterEvent(this.onWorkspaceStateChanged, () => this.isWorkspaceRunning));
    readonly onWorkspaceWillStop = onceEvent(filterEvent(this.onWorkspaceStateChanged, () => this.isWorkspaceStopping || this.isWorkspaceStopped /* it's not guranteed to get stoppping state so check stopped too */));
    readonly onWorkspaceStopped = onceEvent(filterEvent(this.onWorkspaceStateChanged, () => this.isWorkspaceStopped));

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

    public get phase(): WorkspacePhase {
        const phase = this.workspaceState?.instance?.status?.phase;
        return WorkspaceInstanceStatus_Phase[phase ?? WorkspaceInstanceStatus_Phase.UNSPECIFIED].toLowerCase() as WorkspacePhase;
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
        this._contextUrl = ws.context?.contextUrl;
        this.workspaceState ??= ws?.status;
        this.logService.trace(`WorkspaceState: initial state`, WorkspaceInstanceStatus_Phase[this.workspaceState!.instance!.status!.phase]);
    }

    private async checkWorkspaceState(workspaceState: WorkspaceStatus | undefined) {
        const phase = workspaceState?.instance?.status?.phase;
        const oldPhase = this.workspaceState?.instance?.status?.phase;
        this.workspaceState = workspaceState;
        if (phase && oldPhase && phase !== oldPhase) {
            this.logService.trace(`WorkspaceState: update state`, WorkspaceInstanceStatus_Phase[this.workspaceState!.instance!.status!.phase]);
            this._onWorkspaceStateChanged.fire();
        }
    }
}
