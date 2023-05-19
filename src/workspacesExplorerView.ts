/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Disposable } from './common/dispose';
import { ISessionService } from './services/sessionService';
import { groupBy, stringCompare } from './common/utils';
import { CommandManager } from './commandManager';
import { WorkspaceInstanceStatus_Phase } from '@gitpod/public-api/lib/gitpod/experimental/v1/workspaces_pb';
import { rawWorkspaceToWorkspaceData } from './publicApi';
import { IHostService } from './services/hostService';

class RepoOwnerTreeItem {
    constructor(
        public readonly owner: string,
        public readonly provider: string,
        public readonly workspaces: WorkspaceTreeItem[],
    ) {
    }
}

class WorkspaceTreeItem {
    constructor(
        public readonly provider: string,
        public readonly owner: string,
        public readonly repo: string,
        public readonly id: string,
        public readonly contextUrl: string,
        public readonly isRunning: boolean
    ) {
    }
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

        commandManager.register({ id: 'gitpod.workspaces.refresh', execute: () => this.refresh() });

        this._register(this.hostService.onDidChangeHost(() => this.refresh()));
    }

    getTreeItem(element: DataTreeItem): vscode.TreeItem {
        if (element instanceof RepoOwnerTreeItem) {
            const treeItem = new vscode.TreeItem(`${element.provider}/${element.owner}`);
            treeItem.collapsibleState = element.workspaces.length ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None;
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
                    ws.phase === WorkspaceInstanceStatus_Phase.RUNNING
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

    private refresh() {
        this._onDidChangeTreeData.fire();
    }
}
