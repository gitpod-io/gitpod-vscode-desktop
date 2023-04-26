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

    private _onWorkspaceStateChanged = this._register(new vscode.EventEmitter<void>());
    readonly onWorkspaceStateChanged = this._onWorkspaceStateChanged.event;

    readonly onWorkspaceStopped = filterEvent(this.onWorkspaceStateChanged, () => this.workspaceState?.instance?.status?.phase === WorkspaceInstanceStatus_Phase.STOPPING); // assuming stopping state is never skipped

    constructor(
        readonly workspaceId: string,
        private readonly sessionService: ISessionService,
        private readonly logger: ILogService,
    ) {
        super();

        this.logger.trace(`WorkspaceState manager for workspace ${workspaceId} started`);

        const { onStatusChanged, dispose } = this.sessionService.getAPI().workspaceStatusStreaming(workspaceId);
        this._register(onStatusChanged(u => this.checkWorkspaceState(this.toWorkspaceStatus(u))));
        this._register({ dispose });
    }

    public async initialize() {
        const ws = await this.sessionService.getAPI().getWorkspace(this.workspaceId);
        if (!this.workspaceState) {
            this.workspaceState = ws?.status;
        }
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
