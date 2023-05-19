/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Disposable } from './common/dispose';
import { ISessionService } from './services/sessionService';
import { rawWorkspaceToWorkspaceData } from './publicApi';

class RepoTreeItem {
    constructor(
        public readonly owner: string,
        public readonly repo: string,
    ) {
    }
}

class WorkspaceIdTreeItem {
    constructor(
        public readonly id: string,
    ) {
    }
}

type DataTreeItem = RepoTreeItem | WorkspaceIdTreeItem;

export class WorkspaceView extends Disposable implements vscode.TreeDataProvider<DataTreeItem> {

    private readonly _onDidChangeTreeData = this._register(new vscode.EventEmitter<DataTreeItem | DataTreeItem[] | void>());
    public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(
        private readonly workspaceId: string,
        private readonly sessionService: ISessionService,
    ) {
        super();
    }

    getTreeItem(element: DataTreeItem): vscode.TreeItem {
        if (element instanceof RepoTreeItem) {
            const treeItem = new vscode.TreeItem(`${element.owner}/${element.repo}`);
            treeItem.collapsibleState = vscode.TreeItemCollapsibleState.None;
            treeItem.iconPath = new vscode.ThemeIcon('repo');
            treeItem.contextValue = 'gitpod-workspace.repo';
            return treeItem;
        }

        const treeItem = new vscode.TreeItem(element.id);
        treeItem.collapsibleState = vscode.TreeItemCollapsibleState.None;
        treeItem.iconPath = new vscode.ThemeIcon('tag');
        treeItem.contextValue = 'gitpod-workspace.id';
        return treeItem;
    }

    async getChildren(element?: DataTreeItem): Promise<DataTreeItem[]> {
        if (!element) {
            let rawWorkspace = await this.sessionService.getAPI().getWorkspace(this.workspaceId);
            const workspace = rawWorkspaceToWorkspaceData(rawWorkspace);
            return [
                new RepoTreeItem(workspace.owner, workspace.repo),
                new WorkspaceIdTreeItem(workspace.id),
            ];
        }
        return [];
    }

    // private refresh() {
    //     this._onDidChangeTreeData.fire();
    // }
}
