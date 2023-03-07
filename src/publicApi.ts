/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createConnectTransport, createPromiseClient, Interceptor, PromiseClient } from '@bufbuild/connect-node';
import { WorkspacesService } from '@gitpod/public-api/lib/gitpod/experimental/v1/workspaces_connectweb';
import { IDEClientService } from '@gitpod/public-api/lib/gitpod/experimental/v1/ide_client_connectweb';
import { UserService } from '@gitpod/public-api/lib/gitpod/experimental/v1/user_connectweb';
import { Workspace } from '@gitpod/public-api/lib/gitpod/experimental/v1/workspaces_pb';
import { SSHKey, User } from '@gitpod/public-api/lib/gitpod/experimental/v1/user_pb';
import * as vscode from 'vscode';
import { Disposable } from './common/dispose';
import { WorkspacesServiceClient, WorkspaceStatus } from './lib/gitpod/experimental/v1/workspaces.pb';
import * as grpc from '@grpc/grpc-js';
import { timeout } from './common/async';
import { MetricsReporter, getConnectMetricsInterceptor, getGrpcMetricsInterceptor } from './metrics';

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

export class GitpodPublicApi extends Disposable {

    private workspaceService!: PromiseClient<typeof WorkspacesService>;
    private userService!: PromiseClient<typeof UserService>;
    private ideClientService!: PromiseClient<typeof IDEClientService>;

    private grpcWorkspaceClient!: WorkspacesServiceClient;
    private grpcMetadata: grpc.Metadata;

    private metricsReporter: MetricsReporter;

    private _onWorkspaceStatusUpdate = this._register(new vscode.EventEmitter<WorkspaceStatus>);
    public readonly onWorkspaceStatusUpdate = this._onWorkspaceStatusUpdate.event;

    constructor(accessToken: string, gitpodHost: string, private logger: vscode.LogOutputChannel) {
        super();

        const serviceUrl = new URL(gitpodHost);
        serviceUrl.hostname = `api.${serviceUrl.hostname}`;

        const authInterceptor: Interceptor = (next) => async (req) => {
            req.header.set('Authorization', `Bearer ${accessToken}`);
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
        this.grpcMetadata.add('Authorization', `Bearer ${accessToken}`);


        this.metricsReporter = new MetricsReporter(gitpodHost, logger);
        if (isTelemetryEnabled()) {
            this.metricsReporter.startReporting();
        }
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

    private _startWorkspaceStatusStreaming = false;
    async startWorkspaceStatusStreaming(workspaceId: string) {
        if (this._startWorkspaceStatusStreaming) {
            return;
        }
        this._startWorkspaceStatusStreaming = true;

        this._streamWorkspaceStatus(workspaceId);
    }

    private _streamWorkspaceStatus(workspaceId: string) {
        const call = this.grpcWorkspaceClient.streamWorkspaceStatus({ workspaceId }, this.grpcMetadata);
        call.on('data', (res) => {
            this._onWorkspaceStatusUpdate.fire(res.result!);
        });
        call.on('end', async () => {
            await timeout(2000);

            if (this.isDisposed) { return; }

            this.logger.trace(`streamWorkspaceStatus stream ended, retrying ...`);
            this._streamWorkspaceStatus(workspaceId);
        });
        call.on('error', (err) => {
            this.logger.trace(`Error in streamWorkspaceStatus`, err);
        });
    }

    public override dispose() {
        super.dispose();
        this.metricsReporter.stopReporting();
    }
}
