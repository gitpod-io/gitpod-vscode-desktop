/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WorkspaceInfo } from '@gitpod/gitpod-protocol';
import { Workspace, WorkspaceInstanceStatus_Phase } from '@gitpod/public-api/lib/gitpod/experimental/v1/workspaces_pb';
import * as vscode from 'vscode';
import { Disposable } from './common/dispose';
import { withServerApi } from './internalApi';
import { ITelemetryService } from './services/telemetryService';
import { SSHConnectionParams } from './remote';
import { ISessionService } from './services/sessionService';
import { ILogService } from './services/logService';

export class HeartbeatManager extends Disposable {

    static HEARTBEAT_INTERVAL = 30000;
    static EVENT_COUNTER_INTERVAL = 3600000;

    private lastActivity = new Date().getTime();
    private lastActivityEvent: string = 'init';
    private isWorkspaceRunning = true;
    private heartBeatHandle: NodeJS.Timer | undefined;

    private eventCounterMap = new Map<string, number>();
    private eventCounterHandle: NodeJS.Timer | undefined;

    constructor(
        private readonly connectionInfo: SSHConnectionParams,
        private readonly sessionService: ISessionService,
        private readonly logService: ILogService,
        private readonly telemetryService: ITelemetryService,
        private readonly usePublicApi: boolean,
    ) {
        super();
        this._register(vscode.window.onDidChangeActiveTextEditor(e => this.updateLastActivity('onDidChangeActiveTextEditor', e?.document)));
        this._register(vscode.window.onDidChangeVisibleTextEditors(() => this.updateLastActivity('onDidChangeVisibleTextEditors')));
        this._register(vscode.window.onDidChangeTextEditorSelection(e => {
            // Ignore `output` scheme as text editors from output panel autoscroll
            if (e.textEditor.document.uri.scheme === 'output') { return; }
            this.updateLastActivity('onDidChangeTextEditorSelection', e.textEditor.document);
        }));
        this._register(vscode.window.onDidChangeTextEditorVisibleRanges(e => {
            // Ignore `output` scheme as text editors from output panel autoscroll
            if (e.textEditor.document.uri.scheme === 'output') { return; }
            this.updateLastActivity('onDidChangeTextEditorVisibleRanges', e.textEditor.document);
        }));
        this._register(vscode.window.onDidChangeTextEditorOptions(e => this.updateLastActivity('onDidChangeTextEditorOptions', e.textEditor.document)));
        this._register(vscode.window.onDidChangeTextEditorViewColumn(e => this.updateLastActivity('onDidChangeTextEditorViewColumn', e.textEditor.document)));
        this._register(vscode.window.onDidChangeActiveNotebookEditor(() => this.updateLastActivity('onDidChangeActiveNotebookEditor')));
        this._register(vscode.window.onDidChangeVisibleNotebookEditors(() => this.updateLastActivity('onDidChangeVisibleNotebookEditors')));
        this._register(vscode.window.onDidChangeNotebookEditorSelection(() => this.updateLastActivity('onDidChangeNotebookEditorSelection')));
        this._register(vscode.window.onDidChangeNotebookEditorVisibleRanges(() => this.updateLastActivity('onDidChangeNotebookEditorVisibleRanges')));
        this._register(vscode.window.onDidChangeActiveTerminal(() => this.updateLastActivity('onDidChangeActiveTerminal')));
        this._register(vscode.window.onDidOpenTerminal(() => this.updateLastActivity('onDidOpenTerminal')));
        this._register(vscode.window.onDidCloseTerminal(() => this.updateLastActivity('onDidCloseTerminal')));
        this._register(vscode.window.onDidChangeTerminalState(() => this.updateLastActivity('onDidChangeTerminalState')));
        this._register(vscode.window.onDidChangeWindowState(() => this.updateLastActivity('onDidChangeWindowState')));
        this._register(vscode.window.onDidChangeActiveColorTheme(() => this.updateLastActivity('onDidChangeActiveColorTheme')));
        this._register(vscode.authentication.onDidChangeSessions(() => this.updateLastActivity('onDidChangeSessions')));
        this._register(vscode.debug.onDidChangeActiveDebugSession(() => this.updateLastActivity('onDidChangeActiveDebugSession')));
        this._register(vscode.debug.onDidStartDebugSession(() => this.updateLastActivity('onDidStartDebugSession')));
        this._register(vscode.debug.onDidReceiveDebugSessionCustomEvent(() => this.updateLastActivity('onDidReceiveDebugSessionCustomEvent')));
        this._register(vscode.debug.onDidTerminateDebugSession(() => this.updateLastActivity('onDidTerminateDebugSession')));
        this._register(vscode.debug.onDidChangeBreakpoints(() => this.updateLastActivity('onDidChangeBreakpoints')));
        this._register(vscode.extensions.onDidChange(() => this.updateLastActivity('onDidChangeExtensions')));
        this._register(vscode.languages.onDidChangeDiagnostics(() => this.updateLastActivity('onDidChangeDiagnostics')));
        this._register(vscode.tasks.onDidStartTask(() => this.updateLastActivity('onDidStartTask')));
        this._register(vscode.tasks.onDidStartTaskProcess(() => this.updateLastActivity('onDidStartTaskProcess')));
        this._register(vscode.tasks.onDidEndTask(() => this.updateLastActivity('onDidEndTask')));
        this._register(vscode.tasks.onDidEndTaskProcess(() => this.updateLastActivity('onDidEndTaskProcess')));
        this._register(vscode.workspace.onDidChangeWorkspaceFolders(() => this.updateLastActivity('onDidChangeWorkspaceFolders')));
        this._register(vscode.workspace.onDidSaveTextDocument(e => this.updateLastActivity('onDidSaveTextDocument', e)));
        this._register(vscode.workspace.onDidChangeNotebookDocument(() => this.updateLastActivity('onDidChangeNotebookDocument')));
        this._register(vscode.workspace.onDidSaveNotebookDocument(() => this.updateLastActivity('onDidSaveNotebookDocument')));
        this._register(vscode.workspace.onDidOpenNotebookDocument(() => this.updateLastActivity('onDidOpenNotebookDocument')));
        this._register(vscode.workspace.onDidCloseNotebookDocument(() => this.updateLastActivity('onDidCloseNotebookDocument')));
        this._register(vscode.workspace.onWillCreateFiles(() => this.updateLastActivity('onWillCreateFiles')));
        this._register(vscode.workspace.onDidCreateFiles(() => this.updateLastActivity('onDidCreateFiles')));
        this._register(vscode.workspace.onWillDeleteFiles(() => this.updateLastActivity('onWillDeleteFiles')));
        this._register(vscode.workspace.onDidDeleteFiles(() => this.updateLastActivity('onDidDeleteFiles')));
        this._register(vscode.workspace.onWillRenameFiles(() => this.updateLastActivity('onWillRenameFiles')));
        this._register(vscode.workspace.onDidRenameFiles(() => this.updateLastActivity('onDidRenameFiles')));
        this._register(vscode.languages.registerHoverProvider('*', {
            provideHover: () => {
                this.updateLastActivity('registerHoverProvider');
                return null;
            }
        }));

        this.logService.info(`Heartbeat manager for workspace ${this.connectionInfo.workspaceId} (${this.connectionInfo.instanceId}) - ${this.connectionInfo.gitpodHost} started`);

        // Start heartbeating interval
        this.sendHeartBeat();
        this.heartBeatHandle = setInterval(() => {
            // Add an additional random value between 5 and 15 seconds. See https://github.com/gitpod-io/gitpod/pull/5613
            const randomInterval = Math.floor(Math.random() * (15000 - 5000 + 1)) + 5000;
            if (this.lastActivity + HeartbeatManager.HEARTBEAT_INTERVAL + randomInterval < new Date().getTime()) {
                // no activity, no heartbeat
                return;
            }

            this.sendHeartBeat();
        }, HeartbeatManager.HEARTBEAT_INTERVAL);

        this.eventCounterHandle = setInterval(() => this.sendEventData(), HeartbeatManager.EVENT_COUNTER_INTERVAL);
    }

    private updateLastActivity(event: string, document?: vscode.TextDocument) {
        this.lastActivity = new Date().getTime();
        this.lastActivityEvent = event;

        const eventName = document ? `${event}:${document.uri.scheme}` : event;

        let counter = this.eventCounterMap.get(eventName) || 0;
        this.eventCounterMap.set(eventName, ++counter);
    }

    private async sendHeartBeat(wasClosed?: true) {
        try {
            await withServerApi(this.sessionService.getGitpodToken(), this.connectionInfo.gitpodHost, async service => {
                const workspaceInfo = this.usePublicApi
                    ? await this.sessionService.getAPI().getWorkspace(this.connectionInfo.workspaceId)
                    : await service.server.getWorkspace(this.connectionInfo.workspaceId);
                this.isWorkspaceRunning = this.usePublicApi
                    ? (workspaceInfo as Workspace)?.status?.instance?.status?.phase === WorkspaceInstanceStatus_Phase.RUNNING && (workspaceInfo as Workspace)?.status?.instance?.instanceId === this.connectionInfo.instanceId
                    : (workspaceInfo as WorkspaceInfo).latestInstance?.status?.phase === 'running' && (workspaceInfo as WorkspaceInfo).latestInstance?.id === this.connectionInfo.instanceId;
                if (this.isWorkspaceRunning) {
                    this.usePublicApi
                        ? (!wasClosed ? await this.sessionService.getAPI().sendHeartbeat(this.connectionInfo.workspaceId) : await this.sessionService.getAPI().sendDidClose(this.connectionInfo.workspaceId))
                        : await service.server.sendHeartBeat({ instanceId: this.connectionInfo.instanceId, wasClosed });
                    if (wasClosed) {
                        this.telemetryService.sendTelemetryEvent('ide_close_signal', { workspaceId: this.connectionInfo.workspaceId, instanceId: this.connectionInfo.instanceId, gitpodHost: this.connectionInfo.gitpodHost, clientKind: 'vscode', debugWorkspace: String(!!this.connectionInfo.debugWorkspace) });
                        this.logService.trace(`Send closed heartbeat`);
                    } else {
                        this.logService.trace(`Send heartbeat, triggered by ${this.lastActivityEvent} event`);
                    }
                } else {
                    this.logService.trace('Stopping heartbeat as workspace is not running');
                    this.stopHeartbeat();
                }
            }, this.logService);
        } catch (e) {
            const suffix = wasClosed ? 'closed heartbeat' : 'heartbeat';
            const originMsg = e.message;
            e.message = `Failed to send ${suffix}, triggered by event: ${this.lastActivityEvent}: ${originMsg}`;
            this.logService.error(e);
            e.message = `Failed to send ${suffix}: ${originMsg}`;
            this.telemetryService.sendTelemetryException(e, { workspaceId: this.connectionInfo.workspaceId, instanceId: this.connectionInfo.instanceId});
        }
    }

    private stopHeartbeat() {
        if (this.heartBeatHandle) {
            clearInterval(this.heartBeatHandle);
            this.heartBeatHandle = undefined;
        }
    }

    private sendEventData() {
        this.telemetryService.sendRawTelemetryEvent('vscode_desktop_heartbeat_delta', { events: Object.fromEntries(this.eventCounterMap), workspaceId: this.connectionInfo.workspaceId, instanceId: this.connectionInfo.instanceId, gitpodHost: this.connectionInfo.gitpodHost, clientKind: 'vscode' });
        this.eventCounterMap.clear();
    }

    private stopEventCounter() {
        if (this.eventCounterHandle) {
            clearInterval(this.eventCounterHandle);
            this.eventCounterHandle = undefined;
        }
    }

    public override async dispose(): Promise<void> {
        super.dispose();
        this.stopEventCounter();
        this.sendEventData();
        this.stopHeartbeat();
        if (this.isWorkspaceRunning) {
            await this.sendHeartBeat(true);
        }
    }
}
