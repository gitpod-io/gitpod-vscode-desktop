/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WorkspaceInfo } from '@gitpod/gitpod-protocol';
import { Workspace, WorkspaceInstanceStatus_Phase } from '@gitpod/public-api/lib/gitpod/experimental/v1/workspaces_pb';
import * as vscode from 'vscode';
import { Disposable } from './common/dispose';
import Log from './common/logger';
import { withServerApi } from './internalApi';
import { GitpodPublicApi } from './publicApi';
import TelemetryReporter from './telemetryReporter';

export class HeartbeatManager extends Disposable {

    static HEARTBEAT_INTERVAL = 30000;

    private lastActivity = new Date().getTime();
    private lastActivityEvent: string = 'init';
    private isWorkspaceRunning = true;
    private heartBeatHandle: NodeJS.Timer | undefined;

    constructor(
        readonly gitpodHost: string,
        readonly workspaceId: string,
        readonly instanceId: string,
        readonly debugWorkspace: boolean,
        private readonly accessToken: string,
        private readonly publicApi: GitpodPublicApi | undefined,
        private readonly logger: Log,
        private readonly telemetry: TelemetryReporter
    ) {
        super();
        this._register(vscode.window.onDidChangeActiveTextEditor(this.updateLastActivity('onDidChangeActiveTextEditor'), this));
        this._register(vscode.window.onDidChangeVisibleTextEditors(this.updateLastActivity('onDidChangeVisibleTextEditors'), this));
        this._register(vscode.window.onDidChangeTextEditorSelection(this.updateLastActivity('onDidChangeTextEditorSelection'), this));
        this._register(vscode.window.onDidChangeTextEditorVisibleRanges(this.updateLastActivity('onDidChangeTextEditorVisibleRanges'), this));
        this._register(vscode.window.onDidChangeTextEditorOptions(this.updateLastActivity('onDidChangeTextEditorOptions'), this));
        this._register(vscode.window.onDidChangeTextEditorViewColumn(this.updateLastActivity('onDidChangeTextEditorViewColumn'), this));
        this._register(vscode.window.onDidChangeActiveTerminal(this.updateLastActivity('onDidChangeActiveTerminal'), this));
        this._register(vscode.window.onDidOpenTerminal(this.updateLastActivity('onDidOpenTerminal'), this));
        this._register(vscode.window.onDidCloseTerminal(this.updateLastActivity('onDidCloseTerminal'), this));
        this._register(vscode.window.onDidChangeTerminalState(this.updateLastActivity('onDidChangeTerminalState'), this));
        this._register(vscode.window.onDidChangeWindowState(this.updateLastActivity('onDidChangeWindowState'), this));
        this._register(vscode.window.onDidChangeActiveColorTheme(this.updateLastActivity('onDidChangeActiveColorTheme'), this));
        this._register(vscode.authentication.onDidChangeSessions(this.updateLastActivity('onDidChangeSessions'), this));
        this._register(vscode.debug.onDidChangeActiveDebugSession(this.updateLastActivity('onDidChangeActiveDebugSession'), this));
        this._register(vscode.debug.onDidStartDebugSession(this.updateLastActivity('onDidStartDebugSession'), this));
        this._register(vscode.debug.onDidReceiveDebugSessionCustomEvent(this.updateLastActivity('onDidReceiveDebugSessionCustomEvent'), this));
        this._register(vscode.debug.onDidTerminateDebugSession(this.updateLastActivity('onDidTerminateDebugSession'), this));
        this._register(vscode.debug.onDidChangeBreakpoints(this.updateLastActivity('onDidChangeBreakpoints'), this));
        this._register(vscode.extensions.onDidChange(this.updateLastActivity('onDidChange'), this));
        this._register(vscode.languages.onDidChangeDiagnostics(this.updateLastActivity('onDidChangeDiagnostics'), this));
        this._register(vscode.tasks.onDidStartTask(this.updateLastActivity('onDidStartTask'), this));
        this._register(vscode.tasks.onDidStartTaskProcess(this.updateLastActivity('onDidStartTaskProcess'), this));
        this._register(vscode.tasks.onDidEndTask(this.updateLastActivity('onDidEndTask'), this));
        this._register(vscode.tasks.onDidEndTaskProcess(this.updateLastActivity('onDidEndTaskProcess'), this));
        this._register(vscode.workspace.onDidChangeWorkspaceFolders(this.updateLastActivity('onDidChangeWorkspaceFolders'), this));
        this._register(vscode.workspace.onDidOpenTextDocument(this.updateLastActivity('onDidOpenTextDocument'), this));
        this._register(vscode.workspace.onDidCloseTextDocument(this.updateLastActivity('onDidCloseTextDocument'), this));
        this._register(vscode.workspace.onDidChangeTextDocument(this.updateLastActivity('onDidChangeTextDocument'), this));
        this._register(vscode.workspace.onDidSaveTextDocument(this.updateLastActivity('onDidSaveTextDocument'), this));
        this._register(vscode.workspace.onDidChangeNotebookDocument(this.updateLastActivity('onDidChangeNotebookDocument'), this));
        this._register(vscode.workspace.onDidSaveNotebookDocument(this.updateLastActivity('onDidSaveNotebookDocument'), this));
        this._register(vscode.workspace.onDidOpenNotebookDocument(this.updateLastActivity('onDidOpenNotebookDocument'), this));
        this._register(vscode.workspace.onDidCloseNotebookDocument(this.updateLastActivity('onDidCloseNotebookDocument'), this));
        this._register(vscode.workspace.onWillCreateFiles(this.updateLastActivity('onWillCreateFiles'), this));
        this._register(vscode.workspace.onDidCreateFiles(this.updateLastActivity('onDidCreateFiles'), this));
        this._register(vscode.workspace.onWillDeleteFiles(this.updateLastActivity('onWillDeleteFiles'), this));
        this._register(vscode.workspace.onDidDeleteFiles(this.updateLastActivity('onDidDeleteFiles'), this));
        this._register(vscode.workspace.onWillRenameFiles(this.updateLastActivity('onWillRenameFiles'), this));
        this._register(vscode.workspace.onDidRenameFiles(this.updateLastActivity('onDidRenameFiles'), this));
        this._register(vscode.workspace.onDidChangeConfiguration(this.updateLastActivity('onDidChangeConfiguration'), this));
        this._register(vscode.languages.registerHoverProvider('*', {
            provideHover: () => {
                this.updateLastActivity('registerHoverProvider')();
                return null;
            }
        }));

        this.logger.trace(`Heartbeat manager for workspace ${workspaceId} (${instanceId}) - ${gitpodHost} started`);

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
    }

    private updateLastActivity(event: string) {
        return () => {
            this.lastActivity = new Date().getTime();
            this.lastActivityEvent = event;
        };
    }

    private async sendHeartBeat(wasClosed?: true) {
        const suffix = wasClosed ? 'closed heartbeat' : 'heartbeat';
        try {
            await withServerApi(this.accessToken, this.gitpodHost, async service => {
                const workspaceInfo = this.publicApi
                    ? await this.publicApi.getWorkspace(this.workspaceId)
                    : await service.server.getWorkspace(this.workspaceId);
                this.isWorkspaceRunning = this.publicApi
                    ? (workspaceInfo as Workspace)?.status?.instance?.status?.phase === WorkspaceInstanceStatus_Phase.RUNNING && (workspaceInfo as Workspace)?.status?.instance?.instanceId === this.instanceId
                    : (workspaceInfo as WorkspaceInfo).latestInstance?.status?.phase === 'running' && (workspaceInfo as WorkspaceInfo).latestInstance?.id === this.instanceId;
                if (this.isWorkspaceRunning) {
                    this.publicApi
                        ? (!wasClosed ? await this.publicApi.sendHeartbeat(this.workspaceId) : await this.publicApi.sendDidClose(this.workspaceId))
                        : await service.server.sendHeartBeat({ instanceId: this.instanceId, wasClosed });
                    if (wasClosed) {
                        this.telemetry.sendTelemetryEvent('ide_close_signal', { workspaceId: this.workspaceId, instanceId: this.instanceId, gitpodHost: this.gitpodHost, clientKind: 'vscode', debugWorkspace: String(!!this.debugWorkspace) });
                        this.logger.trace('Send ' + suffix);
                    }
                } else {
                    this.logger.trace('Stopping heartbeat as workspace is not running');
                    this.stopHeartbeat();
                }
            }, this.logger);
        } catch (err) {
            this.logger.error(`Failed to send ${suffix} with event ${this.lastActivityEvent}:`, err);
        }
    }

    private stopHeartbeat() {
        if (this.heartBeatHandle) {
            clearInterval(this.heartBeatHandle);
            this.heartBeatHandle = undefined;
        }
    }

    public override async dispose(): Promise<void> {
        this.stopHeartbeat();
        if (this.isWorkspaceRunning) {
            await this.sendHeartBeat(true);
        }
        super.dispose();
    }
}
