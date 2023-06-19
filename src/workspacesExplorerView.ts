/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Disposable } from './common/dispose';
import { ISessionService } from './services/sessionService';
import { groupBy, stringCompare } from './common/utils';
import { CommandManager } from './commandManager';
import { rawWorkspaceToWorkspaceData } from './publicApi';
import { IHostService } from './services/hostService';

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
        public readonly isRunning: boolean
    ) {
    }

    setParent(parent: RepoOwnerTreeItem) { this._parent = parent; }
    getParent() { return this._parent; }
}

type DataTreeItem = RepoOwnerTreeItem | WorkspaceTreeItem;

export class WorkspacesExplorerView extends Disposable implements vscode.TreeDataProvider<DataTreeItem> {

    private readonly _onDidChangeTreeData = this._register(new vscode.EventEmitter<DataTreeItem | DataTreeItem[] | void>());
    public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(
        readonly commandManager: CommandManager,
        private readonly sessionService: ISessionService,
        private readonly hostService: IHostService,
    ) {
        super();

        this._register(vscode.window.createTreeView('gitpod-workspaces', { treeDataProvider: this }));

        commandManager.register({ id: 'gitpod.workspaces.refresh', execute: () => this.refresh() });

        this._register(this.hostService.onDidChangeHost(() => this.refresh()));
    }

    getTreeItem(element: DataTreeItem): vscode.TreeItem {
        if (element instanceof RepoOwnerTreeItem) {
            const treeItem = new vscode.TreeItem(`${element.provider}/${element.owner}`);
            treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
            treeItem.contextValue = 'gitpod-workspaces.repo-owner';
            return treeItem;
        }

        const treeItem = new vscode.TreeItem(`${element.owner}/${element.repo}`);
        treeItem.description = element.id;
        treeItem.collapsibleState = vscode.TreeItemCollapsibleState.None;
        treeItem.iconPath = new vscode.ThemeIcon(element.isRunning ? 'vm-running' : 'vm-outline');
        treeItem.contextValue = 'gitpod-workspaces.workspace' + (element.isRunning ? '.running' : '');
        return treeItem;
    }

    async getChildren(element?: DataTreeItem): Promise<DataTreeItem[]> {
        if (!element) {
            let rawWorkspaces = await this.sessionService.getAPI().listWorkspaces();
            const workspaces = rawWorkspaceToWorkspaceData(rawWorkspaces).map(ws => {
                return new WorkspaceTreeItem(
                    ws.provider,
                    ws.owner,
                    ws.repo,
                    ws.id,
                    ws.contextUrl,
                    ws.phase === 'running'
                );
            });
            const groupedWorkspaces = groupBy(workspaces, (a, b) => { return stringCompare(a.provider, b.provider) || stringCompare(a.owner, b.owner); });
            return groupedWorkspaces.map(wsGroup => new RepoOwnerTreeItem(wsGroup[0].owner, wsGroup[0].provider, wsGroup));
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
}
