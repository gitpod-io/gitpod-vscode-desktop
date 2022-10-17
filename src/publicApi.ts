/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createConnectTransport, createPromiseClient, Interceptor, PromiseClient } from '@bufbuild/connect-web';
import { WorkspacesService } from '@gitpod/public-api/lib/gitpod/v1/workspaces_connectweb';
import { Workspace, WorkspaceInstance } from '@gitpod/public-api/lib/gitpod/v1/workspaces_pb';

export class GitpodPublicApi {

    private workspaceService!: PromiseClient<typeof WorkspacesService>;

    constructor() {
    }

    async init(accessToken: string, gitpodHost:string){
        const serviceUrl = new URL(gitpodHost);
        serviceUrl.hostname = `api.${serviceUrl.hostname}`;

        const authInterceptor: Interceptor = (next) => async (req) => {
            req.header.set('Authorization', `Bearer ${accessToken}`);
            return await next(req);
        };

        const transport = createConnectTransport({
            baseUrl: serviceUrl.toString(),
            interceptors: [authInterceptor],
        });

        this.workspaceService = createPromiseClient(WorkspacesService, transport);
    }

    async getWorkspace(workspaceId: string): Promise<Workspace | undefined> {
        const response = await this.workspaceService.getWorkspace({ workspaceId });
        return response.result;
    }

    async getActiveWorkspaceInstance(workspaceId: string): Promise<WorkspaceInstance | undefined> {
        const response = await this.workspaceService.getActiveWorkspaceInstance({ workspaceId });
        return response.instance;
    }

    async getOwnerToken(workspaceId: string): Promise<string> {
        const response = await this.workspaceService.getOwnerToken({ workspaceId });
        return response.token;
    }
}
