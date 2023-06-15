/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createConnectTransport } from '@bufbuild/connect-node';
import { createPromiseClient, Interceptor, PromiseClient, ConnectError, Code } from '@bufbuild/connect';
import { WorkspacesService } from '@gitpod/public-api/lib/gitpod/experimental/v1/workspaces_connectweb';
import { IDEClientService } from '@gitpod/public-api/lib/gitpod/experimental/v1/ide_client_connectweb';
import { UserService } from '@gitpod/public-api/lib/gitpod/experimental/v1/user_connectweb';
import { Workspace } from '@gitpod/public-api/lib/gitpod/experimental/v1/workspaces_pb';
import { SSHKey, User } from '@gitpod/public-api/lib/gitpod/experimental/v1/user_pb';
import * as vscode from 'vscode';
import { Disposable } from './common/dispose';
import { WorkspacesServiceClient, WorkspaceStatus } from './lib/gitpod/experimental/v1/workspaces.pb';
import * as grpc from '@grpc/grpc-js';
import { getErrorCode } from '@grpc/grpc-js/build/src/error';
import { timeout } from './common/async';
import { MetricsReporter, getConnectMetricsInterceptor, getGrpcMetricsInterceptor } from './metrics';
import { ILogService } from './services/logService';
import { WrapError } from './common/utils';

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

export interface IGitpodAPI {
    getWorkspace(workspaceId: string): Promise<Workspace>;
    startWorkspace(workspaceId: string): Promise<Workspace>;
    getOwnerToken(workspaceId: string): Promise<string>;
    getSSHKeys(): Promise<SSHKey[]>;
    sendHeartbeat(workspaceId: string): Promise<void>;
    sendDidClose(workspaceId: string): Promise<void>;
    getAuthenticatedUser(): Promise<User | undefined>;
    workspaceStatusStreaming(workspaceId: string): { onStatusChanged: vscode.Event<WorkspaceStatus>; dispose: () => void };
}

export class GitpodPublicApi extends Disposable implements IGitpodAPI {

    private workspaceService!: PromiseClient<typeof WorkspacesService>;
    private userService!: PromiseClient<typeof UserService>;
    private ideClientService!: PromiseClient<typeof IDEClientService>;

    private grpcWorkspaceClient!: WorkspacesServiceClient;
    private grpcMetadata: grpc.Metadata;

    private metricsReporter: MetricsReporter;

    private workspaceStatusStreamMap = new Map<string, { onStatusChanged: vscode.Event<WorkspaceStatus>; dispose: (force?: boolean) => void; increment: () => void }>();

    constructor(accessToken: string, gitpodHost: string, private logger: ILogService) {
        super();

        const serviceUrl = new URL(gitpodHost);
        serviceUrl.hostname = `api.${serviceUrl.hostname}`;

        const authInterceptor: Interceptor = (next) => async (req) => {
            req.header.set('Authorization', `Bearer ${accessToken}`);
            return await next(req);
        };
        const metricsInterceptor = getConnectMetricsInterceptor();
        const errorWrapInterceptor: Interceptor = (next) => async (req) => {
            try {
                return await next(req);
            } catch (err) {
                if (err instanceof ConnectError) {
                    // https://github.com/gitpod-io/gitpod/blob/d41a38ba83939856e5292e30912f52e749787db1/components/public-api-server/pkg/auth/middleware.go#L73
                    // https://github.com/gitpod-io/gitpod/blob/d41a38ba83939856e5292e30912f52e749787db1/components/public-api-server/pkg/proxy/errors.go#L30
                    // NOTE: WrapError will omit error's other properties
                    throw new WrapError('Failed to call public API', err, 'PublicAPI:' + Code[err.code]);
                }
                throw err;
            }
        };

        const transport = createConnectTransport({
            baseUrl: serviceUrl.toString(),
            httpVersion: '2',
            interceptors: [errorWrapInterceptor, authInterceptor, metricsInterceptor],
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
    async getWorkspace(workspaceId: string): Promise<Workspace> {
        const response = await this.workspaceService.getWorkspace({ workspaceId });
        return response.result!;
    }

    async startWorkspace(workspaceId: string): Promise<Workspace> {
        const response = await this.workspaceService.startWorkspace({ workspaceId });
        return response.result!;
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

    workspaceStatusStreaming(workspaceId: string) {
        if (!this.workspaceStatusStreamMap.has(workspaceId)) {
            const emitter = new vscode.EventEmitter<WorkspaceStatus>;
            let counter = 0;
            let isDisposed = false;

            const onStreamEnd = async () => {
                if (isDisposed) { return; }
                clearTimeout(stopTimer);
                await timeout(1000);
                if (isDisposed) { return; }
                this.grpcWorkspaceClient.getWorkspace({ workspaceId }, this.grpcMetadata, (err, resp) => {
                    if (isDisposed) { return; }
                    if (err) {
                        this.logger.error(`Error in streamWorkspaceStatus(getWorkspace) for ${workspaceId}`, err);
                        onStreamEnd();
                        return;
                    }
                    emitter.fire(resp.result!.status!);
                    [stream, stopTimer] = this._streamWorkspaceStatus(workspaceId, emitter, onStreamEnd);
                });
            };
            let [stream, stopTimer] = this._streamWorkspaceStatus(workspaceId, emitter, onStreamEnd);

            this.workspaceStatusStreamMap.set(workspaceId, {
                onStatusChanged: emitter.event,
                dispose: (force: boolean = false) => {
                    if (isDisposed) { return; }
                    if (!force && --counter > 0) { return; }
                    isDisposed = true;
                    emitter.dispose();
                    clearTimeout(stopTimer);
                    stream.cancel();
                    this.workspaceStatusStreamMap.delete(workspaceId);
                },
                increment: () => { ++counter; },
            });
        }

        const { increment, ...result } = this.workspaceStatusStreamMap.get(workspaceId)!;
        increment();
        return result;
    }

    private _streamWorkspaceStatus(workspaceId: string, onWorkspaceStatusUpdate: vscode.EventEmitter<WorkspaceStatus>, onStreamEnd: () => void) {
        const stream = this.grpcWorkspaceClient.streamWorkspaceStatus({ workspaceId }, this.grpcMetadata);
        stream.on('data', (res) => {
            onWorkspaceStatusUpdate.fire(res.result!);
        });
        stream.on('end', () => {
            this.logger.trace(`End streamWorkspaceStatus for ${workspaceId}`);
            onStreamEnd();
        });
        stream.on('error', (err) => {
            if (getErrorCode(err) !== grpc.status.CANCELLED) {
                this.logger.error(`Error in streamWorkspaceStatus for ${workspaceId}`, err);
            }
        });

        // force reconnect after 7m to avoid unexpected 10m reconnection (internal error)
        let stopTimer = setTimeout(() => {
            this.logger.trace(`streamWorkspaceStatus forcing cancel after 7 minutes`);
            stream.cancel();
        }, 7 * 60 * 1000 /* 7 min */);

        return [stream, stopTimer] as const;
    }

    public override dispose() {
        super.dispose();
        for (const { dispose } of this.workspaceStatusStreamMap.values()) {
            dispose(true);
        }
        this.workspaceStatusStreamMap.clear();
        this.metricsReporter.stopReporting();
    }
}
