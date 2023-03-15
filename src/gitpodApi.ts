/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { createConnectTransport, createPromiseClient, Interceptor, PromiseClient } from '@bufbuild/connect-node';
import { WorkspacesService } from '@gitpod/public-api/lib/gitpod/experimental/v1/workspaces_connectweb';
import { IDEClientService } from '@gitpod/public-api/lib/gitpod/experimental/v1/ide_client_connectweb';
import { UserService } from '@gitpod/public-api/lib/gitpod/experimental/v1/user_connectweb';
import { Workspace, WorkspaceInstanceStatus_Phase } from '@gitpod/public-api/lib/gitpod/experimental/v1/workspaces_pb';
import { SSHKey, User } from '@gitpod/public-api/lib/gitpod/experimental/v1/user_pb';
import { Disposable } from './common/dispose';
import { WorkspacesServiceClient, WorkspaceStatus } from './lib/gitpod/experimental/v1/workspaces.pb';
import * as grpc from '@grpc/grpc-js';
import { timeout } from './common/async';
import { WorkspaceInfo, WorkspaceInstancePhase } from '@gitpod/gitpod-protocol';
import { MetricsReporter, getConnectMetricsInterceptor, getGrpcMetricsInterceptor } from './metrics';
import { withServerApi } from './internalApi';
import { ExperimentalSettings } from './experiments';

function isTelemetryEnabled(): boolean {
    const TELEMETRY_CONFIG_ID = 'telemetry';
    const TELEMETRY_CONFIG_ENABLED_ID = 'enableTelemetry';

    if (vscode.env.isTelemetryEnabled !== undefined) {
        return vscode.env.isTelemetryEnabled ? true : false;
    }

    // We use the old and new setting to determine the telemetry level as we must respect both
    const config = vscode.workspace.getConfiguration(TELEMETRY_CONFIG_ID);
    const enabled = config.get<boolean>(TELEMETRY_CONFIG_ENABLED_ID);
    return !!enabled;
}

interface GitpodApiOption {
    forceUse: "PublicAPI" | "ServerAPI",
}

export class GitpodApi extends Disposable {

    private workspaceService?: PromiseClient<typeof WorkspacesService>;
    private userService?: PromiseClient<typeof UserService>;
    private ideClientService?: PromiseClient<typeof IDEClientService>;
    private _usePublicApi: boolean | undefined;

    private grpcWorkspaceClient?: WorkspacesServiceClient;
    private grpcMetadata?: grpc.Metadata;

    private metricsReporter?: MetricsReporter;

    private _onWorkspaceStatusUpdate = this._register(new vscode.EventEmitter<WorkspaceStatus>);
    public readonly onWorkspaceStatusUpdate = this._onWorkspaceStatusUpdate.event;
    private accessToken?: string;
    private userID?: string;
    private gitpodHost?: string;

    constructor(
        private readonly experiments: ExperimentalSettings,
        private readonly logger: vscode.LogOutputChannel,
    ) {
        super();
        try {
            this.initPublicApi();
        } catch(e) {
            logger.error(e);
            // ignore
        }
    }

    switchOauthInfo(accessToken: string, userID: string, gitpodHost: string) {
        if (this.accessToken === accessToken && this.userID === userID && this.gitpodHost === gitpodHost) {
            return
        }
        this.accessToken = accessToken;
        this.userID = userID;
        this.gitpodHost = gitpodHost;
        try {
            this.initPublicApi();
        } catch (e) {
            this.logger.error(e)
        }
        // TODO: streaming api?
    }

    initPublicApi() {
        if (!this.gitpodHost) {
            throw new Error('gitpodHost is not initialized');
        }
        const serviceUrl = new URL(this.gitpodHost);
        serviceUrl.hostname = `api.${serviceUrl.hostname}`;

        const authInterceptor: Interceptor = (next) => async (req) => {
            req.header.set('Authorization', `Bearer ${this.accessToken}`);
            return await next(req);
        };
        const metricsInterceptor = getConnectMetricsInterceptor();

        const transport = createConnectTransport({
            baseUrl: serviceUrl.toString(),
            httpVersion: '2',
            interceptors: [authInterceptor, metricsInterceptor],
            useBinaryFormat: true,
        });

        this.workspaceService = createPromiseClient(WorkspacesService, transport);
        this.userService = createPromiseClient(UserService, transport);
        this.ideClientService = createPromiseClient(IDEClientService, transport);

        this.grpcWorkspaceClient = new WorkspacesServiceClient(`${serviceUrl.hostname}:443`, grpc.credentials.createSsl(), {
            'grpc.keepalive_time_ms': 120000,
            interceptors: [getGrpcMetricsInterceptor()]
        });
        this.grpcMetadata = new grpc.Metadata();
        this.grpcMetadata.add('Authorization', `Bearer ${this.accessToken}`);

        if (this.metricsReporter) {
            this.metricsReporter.stopReporting();
        }
        this.metricsReporter = new MetricsReporter(this.gitpodHost, this.logger);
        if (isTelemetryEnabled()) {
            this.metricsReporter.startReporting();
        }
    }

    async usePublicApi(opts?: Partial<GitpodApiOption>): Promise<boolean> {
        if (opts?.forceUse === "PublicAPI") {
            return true;
        } else if (opts?.forceUse === "ServerAPI") {
            return false;
        }
        if (!this.userID) {
            this.logger.info('not logged in yet, going to use server API');
            return false;
        }
        const usePublic = (await this.experiments.getRaw<boolean>('gitpod_experimental_publicApi', this.userID, { gitpodHost: this.gitpodHost! })) ?? false;
        if (this._usePublicApi === undefined) {
            this._usePublicApi = usePublic
            this.logger.info(`Going to use ${usePublic ? 'public' : 'server'} API`);
        } else if (this._usePublicApi !== usePublic) {
            this._usePublicApi = usePublic
            this.logger.info(`Switch to use ${usePublic ? 'public' : 'server'} API`);
        }
        return usePublic;
    }

    async getWorkspace(workspaceId: string, opts?: Partial<GitpodApiOption>): Promise<Workspace | undefined> {
        if (await this.usePublicApi(opts)) {
            if (!this.workspaceService) {
                throw new Error('workspaceService is not initialized');
            }
            const response = await this.workspaceService.getWorkspace({ workspaceId });
            return response.result;
        }
        return withServerApi(this.accessToken, this.gitpodHost, async (serverApi) => {
            const workspace = await serverApi.server.getWorkspace(workspaceId);
            workspace.latestInstance?.status.phase
            return this.mapWorkspaceInfo(workspace);
        }, this.logger);
    }

    private mapWorkspaceInfo(workspace: WorkspaceInfo): Workspace { 
        workspace.latestInstance?.status.phase
        const statusMap: Record<WorkspaceInstancePhase, WorkspaceInstanceStatus_Phase> = {
            unknown: WorkspaceInstanceStatus_Phase.UNSPECIFIED,
            preparing: WorkspaceInstanceStatus_Phase.PREPARING,
            building: WorkspaceInstanceStatus_Phase.IMAGEBUILD,
            pending: WorkspaceInstanceStatus_Phase.PENDING,
            creating: WorkspaceInstanceStatus_Phase.CREATING,
            initializing: WorkspaceInstanceStatus_Phase.INITIALIZING,
            running: WorkspaceInstanceStatus_Phase.RUNNING,
            interrupted: WorkspaceInstanceStatus_Phase.INTERRUPTED,
            stopping: WorkspaceInstanceStatus_Phase.STOPPING,
            stopped: WorkspaceInstanceStatus_Phase.STOPPED,
        }
        return new Workspace({
            workspaceId: workspace.workspace.id,
            ownerId: workspace.workspace.ownerId,
            projectId: workspace.workspace.projectId,
            // context?: {}
            description: workspace.workspace.description,
            status: {
                instance: {
                    status: {
                        url: workspace.latestInstance?.ideUrl,
                        phase: statusMap[workspace.latestInstance?.status.phase ?? 'unknown'],
                    }
                }
            }
        });
    }

    async getOwnerToken(workspaceId: string, opts?: Partial<GitpodApiOption>): Promise<string> {
        if (await this.usePublicApi(opts)) {
            if (!this.workspaceService) {
                throw new Error('workspaceService is not initialized');
            }
            const response = await this.workspaceService.getOwnerToken({ workspaceId });
            return response.token;
        }
        return withServerApi(this.accessToken, this.gitpodHost, async (serverApi) => {
            const token = await serverApi.server.getOwnerToken(workspaceId);
            return token;
        }, this.logger);
    }

    async getSSHKeys(opts?: Partial<GitpodApiOption>): Promise<SSHKey[]> {
        if (await this.usePublicApi(opts)) {
            if (!this.userService) {
                throw new Error('userService is not initialized');
            }
            const response = await this.userService.listSSHKeys({});
            return response.keys;
        }
        return withServerApi(this.accessToken, this.gitpodHost, async (serverApi) => {
            const keys = await serverApi.server.getSSHPublicKeys();
            return keys.map(key => new SSHKey({
                id: key.id,
                name: key.name,
                key: key.fingerprint,
                // createdAt: key.createdAt,
            }));
        }, this.logger);
    }

    async sendHeartbeat(workspaceId: string, instanceId: string, opts?: Partial<GitpodApiOption>): Promise<void> {
        if (await this.usePublicApi(opts)) {
            if (!this.ideClientService) {
                throw new Error('ideClientService is not initialized');
            }
            await this.ideClientService.sendHeartbeat({ workspaceId });
            return
        }
        await withServerApi(this.accessToken, this.gitpodHost, async (serverApi) => {
            await serverApi.server.sendHeartBeat({ instanceId })
        }, this.logger);
    }

    async sendDidClose(workspaceId: string, instanceId: string, opts?: Partial<GitpodApiOption>): Promise<void> {
        if (await this.usePublicApi(opts)) {
            if (!this.ideClientService) {
                throw new Error('ideClientService is not initialized');
            }
            await this.ideClientService.sendDidClose({ workspaceId });
            return
        }
        await withServerApi(this.accessToken, this.gitpodHost, async (serverApi) => {
            await serverApi.server.sendHeartBeat({ instanceId, wasClosed: true })
        }, this.logger);
    }

    async getAuthenticatedUser(opts?: Partial<GitpodApiOption>): Promise<User | undefined> {
        if (await this.usePublicApi(opts)) {
            if (!this.userService) {
                throw new Error('userService is not initialized');
            }
            const response = await this.userService.getAuthenticatedUser({});
            return response.user;
        }
        return withServerApi(this.accessToken, this.gitpodHost, async (serverApi) => {
            const user = await serverApi.server.getLoggedInUser();
            return new User({
                id: user.id,
                name: user.name,
                avatarUrl: user.avatarUrl,
            })
        }, this.logger);
    }

    private _startWorkspaceStatusStreaming = false;
    async startWorkspaceStatusStreaming(workspaceId: string) {
        // TODO: with server instance updates
        if (this._startWorkspaceStatusStreaming) {
            return;
        }
        this._startWorkspaceStatusStreaming = true;

        this._streamWorkspaceStatus(workspaceId);
    }

    private _stopTimer: NodeJS.Timeout | undefined;
    private _streamWorkspaceStatus(workspaceId: string) {
        if (!this.grpcWorkspaceClient) {
            throw new Error('grpcWorkspaceClient is not initialized');
        }
        const call = this.grpcWorkspaceClient.streamWorkspaceStatus({ workspaceId }, this.grpcMetadata);
        call.on('data', (res) => {
            this._onWorkspaceStatusUpdate.fire(res.result!);
        });
        call.on('end', async () => {
            clearTimeout(this._stopTimer);

            if (this.isDisposed) { return; }

            this.logger.trace(`streamWorkspaceStatus stream ended`);

            await timeout(1000);
            this._streamWorkspaceStatus(workspaceId);
        });
        call.on('error', (err) => {
            this.logger.trace(`Error in streamWorkspaceStatus`, err);
        });

        // force reconnect after 7m to avoid unexpected 10m reconnection (internal error)
        this._stopTimer = setTimeout(() => {
            this.logger.trace(`streamWorkspaceStatus forcing cancel after 7 minutes`);
            call.cancel();
        }, 7 * 60 * 1000 /* 7 min */);
    }

    public override dispose() {
        super.dispose();
        clearTimeout(this._stopTimer);
        this.metricsReporter?.stopReporting();
    }
}
