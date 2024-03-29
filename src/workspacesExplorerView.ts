/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Disposable } from './common/dispose';
import { ISessionService } from './services/sessionService';
import { CommandManager } from './commandManager';
import { WorkspacePhase, rawWorkspaceToWorkspaceData } from './publicApi';
import { IHostService } from './services/hostService';
import { getGitpodRemoteWindowConnectionInfo } from './remote';
import { Barrier } from './common/async';
import { ITelemetryService } from './common/telemetry';
import { ILogService } from './services/logService';
import { ConnectInCurrentWindowCommand, ConnectInNewWindowCommand, DeleteWorkspaceCommand, OpenWorkspaceContextCommand, OpenInBrowserCommand, StopCurrentWorkspaceCommand, StopWorkspaceCommand, DisconnectWorkspaceCommand, ConnectInCurrentWindowCommandInline, StopWorkspaceCommandInline, DeleteWorkspaceCommandContext, StopWorkspaceCommandContext, ConnectInCurrentWindowCommandContext, ConnectInNewWindowCommandContext, ConnectInCurrentWindowCommandContext_1, ConnectInCurrentWindowCommandInline_1, StopCurrentWorkspaceCommandInline } from './commands/workspaces';
import { IRemoteService } from './services/remoteService';
import { IExperimentsService } from './experiments';

class RepoOwnerTreeItem {
    constructor(
        public readonly owner: string,
        public readonly provider: string,
        public readonly workspaces: WorkspaceTreeItem[],
    ) {
        workspaces.forEach(ws => ws.setParent(this));
    }
}

class WorkspaceTreeItem {
    private _parent!: RepoOwnerTreeItem;

    constructor(
        public readonly provider: string,
        public readonly owner: string,
        public readonly repo: string,
        public readonly id: string,
        public readonly contextUrl: string,
        public readonly phase: WorkspacePhase,
        public readonly description: string,
        public readonly lastUsed: Date
    ) {
    }

    get isRunning() { return this.phase === 'running'; }

    get isStopped() { return this.phase === 'stopped'; }

    setParent(parent: RepoOwnerTreeItem) { this._parent = parent; }
    getParent() { return this._parent; }

    getLastUsedPretty(): string {
        const millisecondsPerSecond = 1000;
        const millisecondsPerMinute = 60 * millisecondsPerSecond;
        const millisecondsPerHour = 60 * millisecondsPerMinute;
        const millisecondsPerDay = 24 * millisecondsPerHour;

        const diff = new Date(new Date().getTime() - this.lastUsed.getTime());
        const days = Math.trunc(diff.getTime() / millisecondsPerDay);
        if (days > 0) {
            return `${days} day${days > 1 ? 's' : ''}`;
        }
        const hours = Math.trunc(diff.getTime() / millisecondsPerHour);
        if (hours > 0) {
            return `${hours} hour${hours > 1 ? 's' : ''}`;
        }
        const minutes = Math.trunc(diff.getTime() / millisecondsPerMinute);
        if (minutes > 0) {
            return `${minutes} minute${minutes > 1 ? 's' : ''}`;
        }
        const seconds = Math.trunc(diff.getTime() / millisecondsPerSecond);
        return `${seconds} second${seconds > 1 ? 's' : ''}`;
    }
}

type DataTreeItem = RepoOwnerTreeItem | WorkspaceTreeItem;

export class WorkspacesExplorerView extends Disposable implements vscode.TreeDataProvider<DataTreeItem> {

    private readonly _onDidChangeTreeData = this._register(new vscode.EventEmitter<DataTreeItem | DataTreeItem[] | void>());
    public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private workspaces: WorkspaceTreeItem[] = [];
    private connectedWorkspaceId: string | undefined;

    private treeView: vscode.TreeView<DataTreeItem>;

    private workspacesBarrier = new Barrier();

    constructor(
        readonly context: vscode.ExtensionContext,
        readonly commandManager: CommandManager,
        readonly remoteService: IRemoteService,
        private readonly sessionService: ISessionService,
        private readonly hostService: IHostService,
        readonly experimentsService: IExperimentsService,
        readonly telemetryService: ITelemetryService,
        readonly logService: ILogService,
    ) {
        super();

        this.treeView = this._register(vscode.window.createTreeView('gitpod-workspaces', { treeDataProvider: this }));
        this.connectedWorkspaceId = getGitpodRemoteWindowConnectionInfo(context)?.connectionInfo.workspaceId;

        commandManager.register({ id: 'gitpod.workspaces.refresh', execute: () => this.refresh() });
        commandManager.register(new ConnectInNewWindowCommand(context, remoteService, sessionService, hostService, experimentsService, telemetryService, logService));
        commandManager.register(new ConnectInNewWindowCommandContext(context, remoteService, sessionService, hostService, experimentsService, telemetryService, logService));
        commandManager.register(new ConnectInCurrentWindowCommand(context, remoteService, sessionService, hostService, experimentsService, telemetryService, logService));
        commandManager.register(new ConnectInCurrentWindowCommandContext(context, remoteService, sessionService, hostService, experimentsService, telemetryService, logService));
        commandManager.register(new ConnectInCurrentWindowCommandContext_1(context, remoteService, sessionService, hostService, experimentsService, telemetryService, logService));
        commandManager.register(new ConnectInCurrentWindowCommandInline(context, remoteService, sessionService, hostService, experimentsService, telemetryService, logService));
        commandManager.register(new ConnectInCurrentWindowCommandInline_1(context, remoteService, sessionService, hostService, experimentsService, telemetryService, logService));
        commandManager.register(new StopWorkspaceCommand(sessionService, hostService, telemetryService));
        commandManager.register(new StopWorkspaceCommandContext(sessionService, hostService, telemetryService));
        commandManager.register(new StopWorkspaceCommandInline(sessionService, hostService, telemetryService));
        commandManager.register(new StopCurrentWorkspaceCommand(context, sessionService, hostService, telemetryService));
        commandManager.register(new StopCurrentWorkspaceCommandInline(context, sessionService, hostService, telemetryService));
        commandManager.register(new OpenInBrowserCommand(context, sessionService, hostService, telemetryService));
        commandManager.register(new DeleteWorkspaceCommand(sessionService, hostService, telemetryService));
        commandManager.register(new DeleteWorkspaceCommandContext(sessionService, hostService, telemetryService));
        commandManager.register(new OpenWorkspaceContextCommand(context, sessionService, hostService, telemetryService));
        commandManager.register(new DisconnectWorkspaceCommand());

        this._register(this.hostService.onDidChangeHost(() => this.refresh()));
    }

    getTreeItem(element: DataTreeItem): vscode.TreeItem {
        if (element instanceof RepoOwnerTreeItem) {
            const treeItem = new vscode.TreeItem(`${element.provider}/${element.owner}`);
            treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
            treeItem.contextValue = 'gitpod-workspaces.repo-owner';
            return treeItem;
        }

        const treeItem = new vscode.TreeItem(element.description);
        treeItem.description = !element.isRunning ? `${element.getLastUsedPretty()} ago` : (this.connectedWorkspaceId === element.id ? 'connected' : '');
        treeItem.collapsibleState = vscode.TreeItemCollapsibleState.None;
        treeItem.iconPath = new vscode.ThemeIcon(element.isRunning ? 'circle-filled' : (element.isStopped ? 'circle-outline' : 'loading~spin'));
        treeItem.contextValue = 'gitpod-workspaces.workspace' + (element.isRunning ? '.running' : '') + (this.connectedWorkspaceId === element.id ? '.connected' : '');

        const tooltipDescription = `$(repo) ${element.description}`;
        const tooltipId = `$(tag) ${element.id}`;
        const tooltipContext = `$(link-external) [${element.contextUrl}](${element.contextUrl})`;
        let tooltipState = `$(clock) Stopped - Last used ${element.getLastUsedPretty()} ago`;
        if (this.connectedWorkspaceId === element.id) {
            tooltipState = `$(clock) Running and Connected`;
        } else if (element.isRunning) {
            tooltipState = `$(clock) Running`;
        }
        treeItem.tooltip = new vscode.MarkdownString([tooltipDescription, tooltipId, tooltipContext, tooltipState].join('\n\n'), true);
        return treeItem;
    }

    async getChildren(element?: DataTreeItem): Promise<DataTreeItem[]> {
        if (!element) {
            let rawWorkspaces = await this.sessionService.getAPI().listWorkspaces();
            this.workspaces = rawWorkspaceToWorkspaceData(rawWorkspaces).map(ws => {
                return new WorkspaceTreeItem(
                    ws.provider,
                    ws.owner,
                    ws.repo,
                    ws.id,
                    ws.contextUrl ?? 'undefined',
                    ws.phase,
                    ws.description,
                    ws.lastUsed
                );
            });
            if (this.connectedWorkspaceId) {
                const element = this.workspaces.find(w => w.id === this.connectedWorkspaceId);
                const rest = this.workspaces.filter(w => w.id !== this.connectedWorkspaceId);
                if (element) {
                    this.workspaces = [element, ...rest];
                }
            }

            this.workspacesBarrier.open();

            return this.workspaces;
        }
        if (element instanceof RepoOwnerTreeItem) {
            return element.workspaces;
        }
        return [];
    }

    getParent(element: DataTreeItem): vscode.ProviderResult<DataTreeItem> {
        if (element instanceof WorkspaceTreeItem) {
            return;
        }

        return;
    }

    private refresh() {
        this._onDidChangeTreeData.fire();
    }

    async reveal(workspaceId: string, options?: { select?: boolean; focus?: boolean }) {
        await this.workspacesBarrier.wait();
        const element = this.workspaces.find(w => w.id === workspaceId);
        if (element) {
            return this.treeView.reveal(element, options);
        }
    }

    isVisible() {
        return this.treeView.visible;
    }
}
