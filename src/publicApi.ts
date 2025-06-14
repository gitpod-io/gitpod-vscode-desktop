/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createConnectTransport } from '@connectrpc/connect-node';
import { createPromiseClient, Interceptor, PromiseClient, ConnectError, Code } from '@connectrpc/connect';
import { WorkspacesService } from '@gitpod/public-api/lib/gitpod/experimental/v1/workspaces_connectweb';
import { IDEClientService } from '@gitpod/public-api/lib/gitpod/experimental/v1/ide_client_connectweb';
import { UserService } from '@gitpod/public-api/lib/gitpod/experimental/v1/user_connectweb';
import { Workspace, WorkspaceInstanceStatus_Phase, WorkspaceStatus } from '@gitpod/public-api/lib/gitpod/experimental/v1/workspaces_pb';
import { SSHKey, User } from '@gitpod/public-api/lib/gitpod/experimental/v1/user_pb';
import * as vscode from 'vscode';
import { Disposable } from './common/dispose';
import { timeout } from './common/async';
import { MetricsReporter, getConnectMetricsInterceptor } from './metrics';
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
    listWorkspaces(): Promise<Workspace[]>;
    getWorkspace(workspaceId: string, signal?: AbortSignal): Promise<Workspace>;
    startWorkspace(workspaceId: string): Promise<Workspace>;
    stopWorkspace(workspaceId: string): Promise<Workspace>;
    deleteWorkspace(workspaceId: string): Promise<void>;
    getOwnerToken(workspaceId: string, signal?: AbortSignal): Promise<string>;
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

    private metricsReporter: MetricsReporter;

    private workspaceStatusStreamMap = new Map<string, { onStatusChanged: vscode.Event<WorkspaceStatus>; dispose: (force?: boolean) => void; increment: () => void }>();

    constructor(
        private readonly accessToken: string,
        private readonly gitpodHost: string,
        private readonly logger: ILogService,
    ) {
        super();

        this.createClients();

        this.metricsReporter = new MetricsReporter(gitpodHost, logger);
        if (isTelemetryEnabled()) {
            this.metricsReporter.startReporting();
        }
    }

    private createClients() {
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
            useBinaryFormat: false,
            pingIntervalMs: 120000,
            pingTimeoutMs: 10000
        });

        this.workspaceService = createPromiseClient(WorkspacesService, transport);
        this.userService = createPromiseClient(UserService, transport);
        this.ideClientService = createPromiseClient(IDEClientService, transport);
    }

    async listWorkspaces(): Promise<Workspace[]> {
        return this._wrapError(async () => {
            const response = await this.workspaceService.listWorkspaces({});
            return response.result;
        });
    }

    async getWorkspace(workspaceId: string, signal?: AbortSignal): Promise<Workspace> {
        return this._wrapError(async () => {
            const response = await this.workspaceService.getWorkspace({ workspaceId });
            return response.result!;
        }, { signal });
    }

    async startWorkspace(workspaceId: string): Promise<Workspace> {
        return this._wrapError(async () => {
            const response = await this.workspaceService.startWorkspace({ workspaceId });
            return response.result!;
        });
    }

    async stopWorkspace(workspaceId: string): Promise<Workspace> {
        return this._wrapError(async () => {
            const response = await this.workspaceService.stopWorkspace({ workspaceId });
            return response.result!;
        });
    }

    async deleteWorkspace(workspaceId: string): Promise<void> {
        return this._wrapError(async () => {
            await this.workspaceService.deleteWorkspace({ workspaceId });
        });
    }

    async getOwnerToken(workspaceId: string, signal?: AbortSignal): Promise<string> {
        return this._wrapError(async () => {
            const response = await this.workspaceService.getOwnerToken({ workspaceId });
            return response.token;
        }, { signal });
    }

    async getSSHKeys(): Promise<SSHKey[]> {
        return this._wrapError(async () => {
            const response = await this.userService.listSSHKeys({});
            return response.keys;
        });
    }

    async sendHeartbeat(workspaceId: string): Promise<void> {
        return this._wrapError(async () => {
            await this.ideClientService.sendHeartbeat({ workspaceId });
        });
    }

    async sendDidClose(workspaceId: string): Promise<void> {
        return this._wrapError(async () => {
            await this.ideClientService.sendDidClose({ workspaceId });
        });
    }

    async getAuthenticatedUser(): Promise<User | undefined> {
        return this._wrapError(async () => {
            const response = await this.userService.getAuthenticatedUser({});
            return response.user;
        });
    }

    workspaceStatusStreaming(workspaceId: string) {
        if (!this.workspaceStatusStreamMap.has(workspaceId)) {
            const emitter = new vscode.EventEmitter<WorkspaceStatus>;
            let counter = 0;
            let isDisposed = false;

            const onStreamEnd: () => Promise<void> = async () => {
                if (isDisposed) { return; }
                clearTimeout(stopTimer);
                await timeout(1000);
                if (isDisposed) { return; }

                try {
                    const resp = await this.workspaceService.getWorkspace({ workspaceId });
                    if (isDisposed) { return; }
                    emitter.fire(resp.result!.status!);
                } catch (err) {
                    if (isDisposed) { return; }
                    this.logger.error(`Error in streamWorkspaceStatus(getWorkspace) for ${workspaceId}`, err);
                    return onStreamEnd();
                }

                controller = new AbortController();
                stopTimer = setTimeout(() => controller.abort(), 7 * 60 * 1000 /* 7 min */);
                return this._streamWorkspaceStatus(workspaceId, emitter, controller.signal).then(onStreamEnd);
            };

            let controller = new AbortController();
            let stopTimer = setTimeout(() => controller.abort(), 7 * 60 * 1000 /* 7 min */);
            this._streamWorkspaceStatus(workspaceId, emitter, controller.signal).then(onStreamEnd);

            this.workspaceStatusStreamMap.set(workspaceId, {
                onStatusChanged: emitter.event,
                dispose: (force: boolean = false) => {
                    if (isDisposed) { return; }
                    if (!force && --counter > 0) { return; }
                    isDisposed = true;
                    emitter.dispose();
                    clearTimeout(stopTimer);
                    controller.abort();
                    this.workspaceStatusStreamMap.delete(workspaceId);
                },
                increment: () => { ++counter; },
            });
        }

        const { increment, ...result } = this.workspaceStatusStreamMap.get(workspaceId)!;
        increment();
        return result;
    }

    private async _streamWorkspaceStatus(workspaceId: string, onWorkspaceStatusUpdate: vscode.EventEmitter<WorkspaceStatus>, signal: AbortSignal) {
        try {
            for await (const res of this.workspaceService.streamWorkspaceStatus({ workspaceId }, { signal })) {
                onWorkspaceStatusUpdate.fire(res.result!);
            }
            this.logger.trace(`End streamWorkspaceStatus for ${workspaceId}`);
        } catch (e) {
            if (ConnectError.from(e).code === Code.Canceled) {
                return;
            }
            this.logger.error(`Error in streamWorkspaceStatus for ${workspaceId}`, e);
        }
    }

    private async _wrapError<T>(callback: () => Promise<T>, opts?: { maxRetries?: number; signal?: AbortSignal }): Promise<T> {
        const maxRetries = opts?.maxRetries ?? 5;
        let retries = 0;

        const onError: (e: any) => Promise<T> = async (e) => {
            const err = ConnectError.from(e);
            const shouldRetry = opts?.signal ? !opts.signal.aborted : retries++ < maxRetries;
            if (shouldRetry && (err.code === Code.Unavailable || err.code === Code.Aborted)) {
                await timeout(1000);
                return callback().catch(onError);
            }

            // https://github.com/gitpod-io/gitpod/blob/d41a38ba83939856e5292e30912f52e749787db1/components/public-api-server/pkg/auth/middleware.go#L73
            // https://github.com/gitpod-io/gitpod/blob/d41a38ba83939856e5292e30912f52e749787db1/components/public-api-server/pkg/proxy/errors.go#L30
            // NOTE: WrapError will omit error's other properties
            throw new WrapError('Failed to call public API', err, 'PublicAPI:' + Code[err.code]);
        };

        return callback().catch(onError);
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

export type WorkspacePhase = 'unspecified' | 'preparing' | 'imagebuild' | 'pending' | 'creating' | 'initializing' | 'running' | 'interrupted' | 'stopping' | 'stopped';

export interface WorkspaceData {
    provider: string;
    owner: string;
    repo: string;
    id: string;
    contextUrl: string | undefined;
    workspaceUrl: string;
    phase: WorkspacePhase;
    description: string;
    lastUsed: Date;
    recentFolders: string[];
}

export function rawWorkspaceToWorkspaceData(rawWorkspaces: Workspace): WorkspaceData;
export function rawWorkspaceToWorkspaceData(rawWorkspaces: Workspace[]): WorkspaceData[];
export function rawWorkspaceToWorkspaceData(rawWorkspaces: Workspace | Workspace[]) {
    const toWorkspaceData = (ws: Workspace) => {
        const normalizedUrl = getNormalizedURL(ws.context!.contextUrl);
        let provider = 'undefined';
        let matches = ['undefined', 'undefined'];
        if (normalizedUrl) {
            const url = new URL(normalizedUrl);
            provider = url.host.replace(/\..+?$/, ''); // remove '.com', etc
            matches = url.pathname.match(/[^/]+/g)!; // match /owner/repo
        }
        const owner = matches[0];
        const repo = matches[1];
        return {
            provider,
            owner,
            repo,
            id: ws.workspaceId,
            contextUrl: normalizedUrl,
            workspaceUrl: ws.status!.instance!.status!.url,
            phase: WorkspaceInstanceStatus_Phase[ws.status!.instance!.status!.phase ?? WorkspaceInstanceStatus_Phase.UNSPECIFIED].toLowerCase() as WorkspacePhase,
            description: ws.description,
            lastUsed: ws.status!.instance!.createdAt!.toDate(),
            recentFolders: ws.status!.instance!.status!.recentFolders
        };
    };

    if (Array.isArray(rawWorkspaces)) {
        rawWorkspaces = rawWorkspaces.filter(ws => ws.context?.details.case === 'git');
        return rawWorkspaces.map(toWorkspaceData);
    }

    return toWorkspaceData(rawWorkspaces);
}

// TODO: remove this once public api is fixed, ref https://github.com/gitpod-io/gitpod/pull/18292
function getNormalizedURL(contextUrl: string | undefined): string | undefined {
    if (!contextUrl) {
        return;
    }

    const idx = contextUrl.search(/http[s]?:\/\//);
    let normalized = contextUrl;
    if (idx > 0) {
        normalized = contextUrl.substring(idx);
    }

    try {
        new URL(normalized);
        return normalized;
    } catch {
    }

    return;
}
