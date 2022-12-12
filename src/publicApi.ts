/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createConnectTransport, createPromiseClient, Interceptor, PromiseClient } from '@bufbuild/connect-web';
import { WorkspacesService } from '@gitpod/public-api/lib/gitpod/experimental/v1/workspaces_connectweb';
import { IDEClientService } from '@gitpod/public-api/lib/gitpod/experimental/v1/ide_client_connectweb';
import { UserService } from '@gitpod/public-api/lib/gitpod/experimental/v1/user_connectweb';
import { Workspace } from '@gitpod/public-api/lib/gitpod/experimental/v1/workspaces_pb';
import { SSHKey, User } from '@gitpod/public-api/lib/gitpod/experimental/v1/user_pb';

export class GitpodPublicApi {

    private workspaceService!: PromiseClient<typeof WorkspacesService>;
    private userService!: PromiseClient<typeof UserService>;
    private ideClientService!: PromiseClient<typeof IDEClientService>;

    constructor(accessToken: string, gitpodHost: string) {
        const serviceUrl = new URL(gitpodHost);
        serviceUrl.hostname = `api.${serviceUrl.hostname}`;

        const authInterceptor: Interceptor = (next) => async (req) => {
            req.header.set('Authorization', `Bearer ${accessToken}`);
            return await next(req);
        };

        const transport = createConnectTransport({
            baseUrl: serviceUrl.toString(),
            interceptors: [authInterceptor],
            useBinaryFormat: true,
        });

        this.workspaceService = createPromiseClient(WorkspacesService, transport);
        this.userService = createPromiseClient(UserService, transport);
        this.ideClientService = createPromiseClient(IDEClientService, transport);
    }

    async getWorkspace(workspaceId: string): Promise<Workspace | undefined> {
        const response = await this.workspaceService.getWorkspace({ workspaceId });
        return response.result;
    }

    async getOwnerToken(workspaceId: string): Promise<string> {
        const response = await this.workspaceService.getOwnerToken({ workspaceId });
        return response.token;
    }

    async getSSHKeys(): Promise<SSHKey[]> {
        const response = await this.userService.listSSHKeys({});
        return response.keys;
    }

    async sendHeartbeat(workspaceId: string): Promise<void> {
        await this.ideClientService.sendHeartbeat({ workspaceId });
    }

    async sendDidClose(workspaceId: string): Promise<void> {
        await this.ideClientService.sendDidClose({ workspaceId });
    }

    async getAuthenticatedUser(): Promise<User | undefined> {
        const response = await this.userService.getAuthenticatedUser({});
        return response.user;
    }
}
