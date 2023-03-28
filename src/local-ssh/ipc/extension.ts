/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExtensionServiceDefinition, ExtensionServiceImplementation, GetWorkspaceAuthInfoRequest, LocalSSHServiceDefinition, PingRequest } from '../../proto/typescript/ipc/v1/ipc';
import { Disposable } from '../../common/dispose';
import { retry, timeout } from '../../common/async';
import { LOCAL_SSH_SOCK_UNIX } from '../common';
export { ExtensionServiceDefinition } from '../../proto/typescript/ipc/v1/ipc';
import { ensureDaemonStarted } from '../../daemonStarter';
import { GitpodPublicApi } from '../../publicApi';
import { withServerApi } from '../../internalApi';
import { Workspace } from '@gitpod/public-api/lib/gitpod/experimental/v1';
import { WorkspaceInfo } from '@gitpod/gitpod-protocol';
import { ILogService } from '../../services/logService';
import { SessionService } from '../../services/sessionService';
import { CallContext, ServerError, Status } from 'nice-grpc-common';
import { HostService } from '../../services/hostService';
import { Server, createClient, createServer, createChannel } from 'nice-grpc';

export class ExtensionServiceImpl implements ExtensionServiceImplementation {
    async ping(_request: PingRequest, _context: CallContext): Promise<{}> {
        return {};
    }

    async getWorkspaceAuthInfo(request: GetWorkspaceAuthInfoRequest, _context: CallContext): Promise<{ workspaceId?: string | undefined; workspaceHost?: string | undefined; ownerToken?: string | undefined }> {
        const accessToken = this.sessionService.getGitpodToken();
        if (!accessToken) {
            throw new ServerError(Status.INTERNAL, 'no access token found');
        }
        const workspaceId = request.workspaceId;

        const [workspace, ownerToken] = await withServerApi(accessToken, this.hostService.gitpodHost, svc => Promise.all([
            this.usePublicApi ? this.sessionService.getAPI().getWorkspace(workspaceId) : svc.server.getWorkspace(workspaceId),
            this.usePublicApi ? this.sessionService.getAPI().getOwnerToken(workspaceId) : svc.server.getOwnerToken(workspaceId),
        ]), this.logService);

        const ideUrl = this.usePublicApi ? (workspace as Workspace).status?.instance?.status?.url : (workspace as WorkspaceInfo).latestInstance?.ideUrl;
        if (!ideUrl) {
            throw new ServerError(Status.DATA_LOSS, 'no ide url found');
        }
        const url = new URL(ideUrl);
        const workspaceHost = url.host.substring(url.host.indexOf('.') + 1);
        return {
            workspaceId,
            workspaceHost,
            ownerToken,
        };
    }

    // TODO(hw): get from experiment
    public usePublicApi: boolean = false;

    constructor(private logService: ILogService, private sessionService: SessionService, private hostService: HostService) { }
}

export class ExtensionServiceServer extends Disposable {
    private server: Server;
    private localSSHServiceClient = createClient(LocalSSHServiceDefinition, createChannel(LOCAL_SSH_SOCK_UNIX));
    public publicApi: GitpodPublicApi | undefined;
    private readonly id: string = Math.random().toString(36).slice(2);
    constructor(
        private readonly logService: ILogService,
        private readonly sessionService: SessionService,
        private readonly hostService: HostService,
    ) {
        super();
        this.logService.info('going to start extension ipc service server with id', this.id);
        const server = createServer();
        const serviceImpl = new ExtensionServiceImpl(this.logService, this.sessionService, this.hostService);
        server.add(ExtensionServiceDefinition, serviceImpl);
        server.listen(`unix:///tmp/gp-ext-${this.id}.sock`).then(() => {
            this.logService.info('extension ipc service server started to listen with id: ' + this.id);
        }).catch(this.logService.error);
        this.server = server;

        this.backoffActive();

        setTimeout(() => this.pingLocalSSHService(), 1000);

        // TODO(hw): ping local ssh service to make sure it's alive
        // if not, restart it
    }

    private async backoffActive() {
        try {
            await retry(async () => {
                await this.localSSHServiceClient.active({ id: this.id });
                this.logService.info('extension ipc svc activated id: ' + this.id);
            }, 200, 10);
        } catch (e) {
            this.logService.error(e, 'failed to active extension ipc svc');
        }
    }

    public override dispose() {
        this.server.shutdown();
    }

    private async pingLocalSSHService() {
        while (true) {
            try {
                await this.localSSHServiceClient.ping({});
            } catch (err) {
                // TODO: backoff
                this.logService.error('failed to ping local ssh service, going to start a new one', err);
                ensureDaemonStarted(this.logService);
                this.backoffActive();
            }
            await timeout(1000 * 1);
        }
    }
}
