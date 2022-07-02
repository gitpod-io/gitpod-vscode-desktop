/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Disposable } from './common/dispose';
import Log from './common/logger';
import { withServerApi } from './internalApi';
import TelemetryReporter from './telemetryReporter';

export class HeartbeatManager extends Disposable {

    private lastActivity = new Date().getTime();

    constructor(
        readonly gitpodHost: string,
        readonly workspaceId: string,
        readonly instanceId: string,
        private readonly accessToken: string,
        private readonly logger: Log,
        private readonly telemetry: TelemetryReporter
    ) {
        super();

        this.sendHeartBeat();

        const activityInterval = 10000;
        const heartBeatHandle = setInterval(() => {
            if (this.lastActivity + activityInterval < new Date().getTime()) {
                // no activity, no heartbeat
                return;
            }
            this.sendHeartBeat();
        }, activityInterval);

        this._register({ dispose: () => clearInterval(heartBeatHandle) });
        this._register(vscode.window.onDidChangeActiveTextEditor(this.updateLastActivitiy, this));
        this._register(vscode.window.onDidChangeVisibleTextEditors(this.updateLastActivitiy, this));
        this._register(vscode.window.onDidChangeTextEditorSelection(this.updateLastActivitiy, this));
        this._register(vscode.window.onDidChangeTextEditorVisibleRanges(this.updateLastActivitiy, this));
        this._register(vscode.window.onDidChangeTextEditorOptions(this.updateLastActivitiy, this));
        this._register(vscode.window.onDidChangeTextEditorViewColumn(this.updateLastActivitiy, this));
        this._register(vscode.window.onDidChangeActiveTerminal(this.updateLastActivitiy, this));
        this._register(vscode.window.onDidOpenTerminal(this.updateLastActivitiy, this));
        this._register(vscode.window.onDidCloseTerminal(this.updateLastActivitiy, this));
        this._register(vscode.window.onDidChangeTerminalState(this.updateLastActivitiy, this));
        this._register(vscode.window.onDidChangeWindowState(this.updateLastActivitiy, this));
        this._register(vscode.window.onDidChangeActiveColorTheme(this.updateLastActivitiy, this));
        this._register(vscode.authentication.onDidChangeSessions(this.updateLastActivitiy, this));
        this._register(vscode.debug.onDidChangeActiveDebugSession(this.updateLastActivitiy, this));
        this._register(vscode.debug.onDidStartDebugSession(this.updateLastActivitiy, this));
        this._register(vscode.debug.onDidReceiveDebugSessionCustomEvent(this.updateLastActivitiy, this));
        this._register(vscode.debug.onDidTerminateDebugSession(this.updateLastActivitiy, this));
        this._register(vscode.debug.onDidChangeBreakpoints(this.updateLastActivitiy, this));
        this._register(vscode.extensions.onDidChange(this.updateLastActivitiy, this));
        this._register(vscode.languages.onDidChangeDiagnostics(this.updateLastActivitiy, this));
        this._register(vscode.tasks.onDidStartTask(this.updateLastActivitiy, this));
        this._register(vscode.tasks.onDidStartTaskProcess(this.updateLastActivitiy, this));
        this._register(vscode.tasks.onDidEndTask(this.updateLastActivitiy, this));
        this._register(vscode.tasks.onDidEndTaskProcess(this.updateLastActivitiy, this));
        this._register(vscode.workspace.onDidChangeWorkspaceFolders(this.updateLastActivitiy, this));
        this._register(vscode.workspace.onDidOpenTextDocument(this.updateLastActivitiy, this));
        this._register(vscode.workspace.onDidCloseTextDocument(this.updateLastActivitiy, this));
        this._register(vscode.workspace.onDidChangeTextDocument(this.updateLastActivitiy, this));
        this._register(vscode.workspace.onDidSaveTextDocument(this.updateLastActivitiy, this));
        this._register(vscode.workspace.onDidChangeNotebookDocument(this.updateLastActivitiy, this));
        this._register(vscode.workspace.onDidSaveNotebookDocument(this.updateLastActivitiy, this));
        this._register(vscode.workspace.onDidOpenNotebookDocument(this.updateLastActivitiy, this));
        this._register(vscode.workspace.onDidCloseNotebookDocument(this.updateLastActivitiy, this));
        this._register(vscode.workspace.onWillCreateFiles(this.updateLastActivitiy, this));
        this._register(vscode.workspace.onDidCreateFiles(this.updateLastActivitiy, this));
        this._register(vscode.workspace.onWillDeleteFiles(this.updateLastActivitiy, this));
        this._register(vscode.workspace.onDidDeleteFiles(this.updateLastActivitiy, this));
        this._register(vscode.workspace.onWillRenameFiles(this.updateLastActivitiy, this));
        this._register(vscode.workspace.onDidRenameFiles(this.updateLastActivitiy, this));
        this._register(vscode.workspace.onDidChangeConfiguration(this.updateLastActivitiy, this));
        this._register(vscode.languages.registerHoverProvider('*', {
            provideHover: () => {
                this.updateLastActivitiy();
                return null;
            }
        }));
    }

    private updateLastActivitiy() {
        this.lastActivity = new Date().getTime();
    }

    private async sendHeartBeat(wasClosed?: true) {
        const suffix = wasClosed ? 'closed heartbeat' : 'heartbeat';
        try {
            await withServerApi(this.accessToken, this.gitpodHost, service => service.server.sendHeartBeat({ instanceId: this.instanceId, wasClosed }), this.logger);
            this.telemetry.sendTelemetryEvent('ide_close_signal', { workspaceId: this.workspaceId, instanceId: this.instanceId, clientKind: 'vscode' });
            // if (wasClosed) {
            this.logger.trace('send ' + suffix);
            // }
        } catch (err) {
            this.logger.error(`failed to send ${suffix}:`, err);
        }
    }

    public override async dispose(): Promise<void> {
        await this.sendHeartBeat(true);
        super.dispose();
    }
}
