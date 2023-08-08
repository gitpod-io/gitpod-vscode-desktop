/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExtensionServiceDefinition, ExtensionServiceImplementation, GetWorkspaceAuthInfoRequest, GetWorkspaceAuthInfoResponse, PingRequest, SendErrorReportRequest, SendLocalSSHUserFlowStatusRequest } from '../../proto/typescript/ipc/v1/ipc';
import { Disposable } from '../../common/dispose';
import { ILogService } from '../../services/logService';
import { ISessionService } from '../../services/sessionService';
import { CallContext, ServerError, Status } from 'nice-grpc-common';
import { IHostService } from '../../services/hostService';
import { Server, createChannel, createClient, createServer } from 'nice-grpc';
import { ITelemetryService, UserFlowTelemetryProperties } from '../../common/telemetry';
import { Configuration } from '../../configuration';
import { timeout } from '../../common/async';
import { BrowserHeaders } from 'browser-headers';
import { ControlServiceClient, ServiceError } from '@gitpod/supervisor-api-grpcweb/lib/control_pb_service';
import { NodeHttpTransport } from '@improbable-eng/grpc-web-node-http-transport';
import { CreateSSHKeyPairRequest } from '@gitpod/supervisor-api-grpcweb/lib/control_pb';
import * as ssh2 from 'ssh2';
import { ParsedKey } from 'ssh2-streams';
import { WrapError } from '../../common/utils';
import { ConnectError, Code } from '@bufbuild/connect';
import { rawWorkspaceToWorkspaceData } from '../../publicApi';

function isServiceError(obj: any): obj is ServiceError {
    // eslint-disable-next-line eqeqeq
    return obj != null && typeof obj === 'object' && typeof obj.metadata != null && typeof obj.code === 'number' && typeof obj.message === 'string';
}

function wrapSupervisorAPIError<T>(callback: () => Promise<T>, opts?: { maxRetries?: number; signal?: AbortSignal }): Promise<T> {
    const maxRetries = opts?.maxRetries ?? 5;
    let retries = 0;

    const onError: (err: any) => Promise<T> = async (err) => {
        if (!isServiceError(err)) {
            throw err;
        }

        const shouldRetry = opts?.signal ? !opts.signal.aborted : retries++ < maxRetries;
        const isNetworkProblem = err.message.includes('Response closed without');
        if (shouldRetry && (err.code === Code.Unavailable || err.code === Code.Aborted || isNetworkProblem)) {
            await timeout(1000);
            return callback().catch(onError);
        }
        if (isNetworkProblem) {
            err.code = Code.Unavailable;
        }
        // codes of grpc-web are align with grpc and connect
        // see https://github.com/improbable-eng/grpc-web/blob/1d9bbb09a0990bdaff0e37499570dbc7d6e58ce8/client/grpc-web/src/Code.ts#L1
        throw new WrapError('Failed to call supervisor API', err, 'SupervisorAPI:' + Code[err.code]);
    };

    return callback().catch(onError);
}

class ExtensionServiceImpl implements ExtensionServiceImplementation {
    constructor(
        private logService: ILogService,
        private sessionService: ISessionService,
        private hostService: IHostService,
        private telemetryService: ITelemetryService
    ) {
    }

    private async getWorkspaceSSHKey(ownerToken: string, workspaceUrl: string, signal: AbortSignal) {
        const url = new URL(workspaceUrl);
        url.pathname = '/_supervisor/v1';
        const privateKey = await wrapSupervisorAPIError(() => new Promise<string>((resolve, reject) => {
            const metadata = new BrowserHeaders();
            metadata.append('x-gitpod-owner-token', ownerToken);
            const client = new ControlServiceClient(url.toString(), { transport: NodeHttpTransport() });
            client.createSSHKeyPair(new CreateSSHKeyPairRequest(), metadata, (err, resp) => {
                if (err) {
                    return reject(err);
                }
                resolve(resp!.toObject().privateKey);
            });
        }), { signal });

        const parsedResult = ssh2.utils.parseKey(privateKey);
        if (parsedResult instanceof Error || !parsedResult) {
            throw new Error('Error while parsing workspace SSH private key');
        }

        return (parsedResult as ParsedKey).getPrivatePEM();
    }

    async getWorkspaceAuthInfo(request: GetWorkspaceAuthInfoRequest, _context: CallContext): Promise<GetWorkspaceAuthInfoResponse> {
        let userId: string | undefined;
        let instanceId: string | undefined;
        try {
            if (new URL(this.hostService.gitpodHost).host !== new URL(request.gitpodHost).host) {
                this.logService.error(`gitpod host mismatch, actual: ${this.hostService.gitpodHost} target: ${request.gitpodHost}`);
                throw new ServerError(Status.FAILED_PRECONDITION, 'gitpod host mismatch');
            }
            const accessToken = this.sessionService.getGitpodToken();
            if (!accessToken) {
                throw new ServerError(Status.INTERNAL, 'no access token found');
            }
            userId = this.sessionService.getUserId();
            const workspaceId = request.workspaceId;
            let actualWorkspaceId = workspaceId;
            if (workspaceId.startsWith('debug-')) {
                actualWorkspaceId = workspaceId.substring('debug-'.length);
            }
            // TODO(lssh): Get auth info according to `request.gitpodHost`
            const gitpodHost = this.hostService.gitpodHost;

            const rawWorkspace = await this.sessionService.getAPI().getWorkspace(actualWorkspaceId, _context.signal);
            const wsData = rawWorkspaceToWorkspaceData(rawWorkspace);

            instanceId = rawWorkspace.status!.instance!.instanceId;

            let ownerToken = '';
            let workspaceHost = '';
            let sshkey = '';
            if (wsData.phase === 'running') {
                ownerToken = await this.sessionService.getAPI().getOwnerToken(actualWorkspaceId, _context.signal);

                const workspaceUrl = new URL(wsData.workspaceUrl);
                workspaceHost = workspaceUrl.host.substring(workspaceUrl.host.indexOf('.') + 1);
                let actualWorkspaceUrl = wsData.workspaceUrl;
                if (workspaceId !== actualWorkspaceId) {
                    // Public api doesn't take into account "debug" workspaces, readd 'debug-' prefix
                    actualWorkspaceUrl = actualWorkspaceUrl.replace(actualWorkspaceId, workspaceId);
                }

                sshkey = await this.getWorkspaceSSHKey(ownerToken, actualWorkspaceUrl, _context.signal);
            }

            return {
                gitpodHost,
                userId,
                workspaceId,
                instanceId,
                workspaceHost,
                ownerToken,
                sshkey,
                phase: wsData.phase,
            };
        } catch (e) {
            let code = Status.INTERNAL;
            if (e instanceof WrapError && (e.cause instanceof ConnectError || isServiceError(e.cause))) {
                code = e.cause.code;
            }
            const wrapErr = new WrapError('failed to get workspace auth info', e);
            this.logService.error(wrapErr);
            this.telemetryService.sendTelemetryException(wrapErr, {
                gitpodHost: request.gitpodHost,
                workspaceId: request.workspaceId,
                instanceId,
                userId,
                wrapCode: wrapErr.code,
            });

            throw new ServerError(code, wrapErr.toString());
        }
    }

    // TODO remove from protocol, don't pass sensitive info back and forth, only once for auth, daemon should do telemetry directly
    async sendLocalSSHUserFlowStatus(request: SendLocalSSHUserFlowStatusRequest, _context: CallContext): Promise<{}> {
        if (!request.flowStatus || request.flowStatus === '') {
            return {};
        }
        const flow: UserFlowTelemetryProperties = {
            flow: 'local_ssh',
            workspaceId: request.workspaceId,
            instanceId: request.instanceId,
            daemonVersion: request.daemonVersion,
            userId: request.userId,
            gitpodHost: request.gitpodHost,
            failureCode: request.flowFailureCode,
        };
        this.telemetryService.sendUserFlowStatus(request.flowStatus, flow);
        return {};
    }

    // TODO remove from protocol, don't pass sensitive info back and forth, only once for auth, daemon should do telemetry directly
    // local ssh daemon should be own component in reporting?
    async sendErrorReport(request: SendErrorReportRequest, _context: CallContext): Promise<{}> {
        const err = new Error(request.errorMessage);
        err.name = `${request.errorName}[local-ssh]`;
        err.stack = request.errorStack;
        this.telemetryService.sendTelemetryException(err, {
            gitpodHost: request.gitpodHost,
            workspaceId: request.workspaceId,
            instanceId: request.instanceId,
            daemonVersion: request.daemonVersion,
            extensionVersion: request.extensionVersion,
            userId: request.userId,
        });
        return {};
    }

    async ping(_request: PingRequest, _context: CallContext): Promise<{}> {
        return {};
    }
}

export class ExtensionServiceServer extends Disposable {
    private server: Server;
    private isListeningPromise: Promise<boolean>;

    constructor(
        private readonly logService: ILogService,
        private readonly sessionService: ISessionService,
        private readonly hostService: IHostService,
        private readonly telemetryService: ITelemetryService,
    ) {
        super();
        this.server = this.getServer();
        this.isListeningPromise = this.tryActive();
    }

    private getServer(): Server {
        const server = createServer();
        const serviceImpl = new ExtensionServiceImpl(this.logService, this.sessionService, this.hostService, this.telemetryService);
        server.add(ExtensionServiceDefinition, serviceImpl);
        return server;
    }

    private tryActive() {
        const port = Configuration.getLocalSshExtensionIpcPort();
        const promise = this.server.listen('127.0.0.1:' + port);
        promise.catch(async () => {
            if (this.isDisposed) {
                return;
            }

            await timeout(1000);
            return this.isListeningPromise = this.tryActive();
        });
        return promise.then(() => true, () => false);
    }

    async canExtensionServiceServerWork(): Promise<true> {
        if ((await this.isListeningPromise)) {
            return true;
        }

        const port = Configuration.getLocalSshExtensionIpcPort();
        const extensionIpc = createClient(ExtensionServiceDefinition, createChannel(`127.0.0.1:${port}`));
        await extensionIpc.ping({});
        return true;
    }

    public override dispose() {
        this.server.forceShutdown();
    }
}
