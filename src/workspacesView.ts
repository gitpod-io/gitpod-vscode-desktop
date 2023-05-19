/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Disposable } from './common/dispose';
import { ISessionService } from './services/sessionService';
import { groupBy, stringCompare } from './common/utils';
import { CommandManager } from './commandManager';

class RepoOwner {
    constructor(
        public readonly owner: string,
        public readonly provider: string,
        public readonly workspaces: WorkspaceItem[],
    ) {
    }
}

class WorkspaceItem {
    constructor(
        public readonly provider: string,
        public readonly owner: string,
        public readonly repo: string,
        public readonly id: string,
        public readonly contextUrl: string
    ) {
    }
}

type DataTreeItem = RepoOwner | WorkspaceItem;

export class WorkspacesView extends Disposable implements vscode.TreeDataProvider<DataTreeItem> {

    private readonly _onDidChangeTreeData = this._register(new vscode.EventEmitter<DataTreeItem | DataTreeItem[] | void>());
    public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(
        private readonly sessionService: ISessionService,
        readonly commandManager: CommandManager,
    ) {
        super();

        commandManager.register({ id: 'gitpod.workspaces.refresh', execute: () => this.refresh() });
    }

    getTreeItem(element: DataTreeItem): vscode.TreeItem {
        if (element instanceof RepoOwner) {
            const treeItem = new vscode.TreeItem(`${element.provider}/${element.owner}`);
            treeItem.collapsibleState = element.workspaces.length ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None;
            treeItem.contextValue = 'gitpod-workspaces.repo-owner';
            return treeItem;
        }

        const treeItem = new vscode.TreeItem(`${element.owner}/${element.repo}`);
        treeItem.description = element.id;
        treeItem.collapsibleState = vscode.TreeItemCollapsibleState.None;
        treeItem.iconPath = new vscode.ThemeIcon('vm');
        treeItem.contextValue = 'gitpod-workspaces.workspace';
        return treeItem;
    }

    async getChildren(element?: DataTreeItem): Promise<DataTreeItem[]> {
        if (!element) {
            let rawWorkspaces = await this.sessionService.getAPI().listWorkspaces();
            rawWorkspaces = rawWorkspaces.filter(ws => ws.context?.details.case === 'git');
            const workspaces = rawWorkspaces.map(ws => {
                const url = new URL(ws.context!.contextUrl);
                const provider = url.host.replace(/\..+?$/, ''); // remove '.com', etc
                const matches = url.pathname.match(/[^/]+/g)!; // match /owner/repo
                const owner = matches[0];
                const repo = matches[1];
                return new WorkspaceItem(
                    provider,
                    owner,
                    repo,
                    ws.workspaceId,
                    ws.context!.contextUrl
                );
            });
            const groupedWorkspaces = groupBy(workspaces, (a, b) => { return stringCompare(a.provider, b.provider) || stringCompare(a.owner, b.owner); });
            return groupedWorkspaces.map(wsGroup => new RepoOwner(wsGroup[0].owner, wsGroup[0].provider, wsGroup));
        }
        if (element instanceof RepoOwner) {
            return element.workspaces;
        }
        return [];
    }

    private refresh() {
        this._onDidChangeTreeData.fire();
    }
}
