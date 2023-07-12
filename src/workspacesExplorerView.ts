/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Disposable } from './common/dispose';
import { ISessionService } from './services/sessionService';
import { CommandManager } from './commandManager';
import { rawWorkspaceToWorkspaceData } from './publicApi';
import { IHostService } from './services/hostService';
import { getGitpodRemoteWindowConnectionInfo } from './remote';

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
        public readonly isRunning: boolean,
        public readonly description: string,
        public readonly lastUsed: Date
    ) {
    }

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

    constructor(
        readonly context: vscode.ExtensionContext,
        readonly commandManager: CommandManager,
        private readonly sessionService: ISessionService,
        private readonly hostService: IHostService,
    ) {
        super();

        this.treeView = this._register(vscode.window.createTreeView('gitpod-workspaces', { treeDataProvider: this }));

        commandManager.register({ id: 'gitpod.workspaces.refresh', execute: () => this.refresh() });

        this._register(this.hostService.onDidChangeHost(() => this.refresh()));

        this.connectedWorkspaceId = getGitpodRemoteWindowConnectionInfo(context)?.connectionInfo.workspaceId;
    }

    getTreeItem(element: DataTreeItem): vscode.TreeItem {
        if (element instanceof RepoOwnerTreeItem) {
            const treeItem = new vscode.TreeItem(`${element.provider}/${element.owner}`);
            treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
            treeItem.contextValue = 'gitpod-workspaces.repo-owner';
            return treeItem;
        }

        const treeItem = new vscode.TreeItem(element.description);
        treeItem.description = !element.isRunning ? `${element.getLastUsedPretty()} ago` : '';
        treeItem.collapsibleState = vscode.TreeItemCollapsibleState.None;
        treeItem.iconPath = new vscode.ThemeIcon(element.isRunning ? 'vm-running' : 'vm-outline');
        treeItem.contextValue = 'gitpod-workspaces.workspace' + (element.isRunning ? '.running' : '') + (this.connectedWorkspaceId === element.id ? '.connected' : '');
        treeItem.tooltip = new vscode.MarkdownString(`$(repo) ${element.description}\n\n $(tag) ${element.id}\n\n $(link-external) [${element.contextUrl}](${element.contextUrl})\n\n $(clock) Last used ${element.getLastUsedPretty()} ago`, true);
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
                    ws.contextUrl,
                    ws.phase === 'running',
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

            return this.workspaces;
        }
        if (element instanceof RepoOwnerTreeItem) {
            return element.workspaces;
        }
        return [];
    }

    getParent(element: DataTreeItem): vscode.ProviderResult<DataTreeItem> {
        if (element instanceof RepoOwnerTreeItem) {
            return;
        }

        return element.getParent();
    }

    private refresh() {
        this._onDidChangeTreeData.fire();
    }

    async reveal(workspaceId: string, options?: { select?: boolean; focus?: boolean; }) {
        const element = this.workspaces.find(w => w.id === workspaceId);
        if (element) {
            return this.treeView.reveal(element, options);
        }
    }

    isVisible() {
        return this.treeView.visible
    }
}
