/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExtensionServiceDefinition, ExtensionServiceImplementation, GetWorkspaceAuthInfoRequest, GetWorkspaceAuthInfoResponse, PingRequest, SendErrorReportRequest, SendLocalSSHUserFlowStatusRequest } from '../../proto/typescript/ipc/v1/ipc';
import { Disposable } from '../../common/dispose';
export { ExtensionServiceDefinition } from '../../proto/typescript/ipc/v1/ipc';
import { withServerApi } from '../../internalApi';
import { Workspace, WorkspaceInstanceStatus_Phase } from '@gitpod/public-api/lib/gitpod/experimental/v1';
import { WorkspaceInfo, WorkspaceInstancePhase } from '@gitpod/gitpod-protocol';
import { ILogService } from '../../services/logService';
import { ISessionService } from '../../services/sessionService';
import { CallContext, ServerError, Status } from 'nice-grpc-common';
import { IHostService } from '../../services/hostService';
import { Server, createChannel, createClient, createServer } from 'nice-grpc';
import { ITelemetryService, UserFlowTelemetryProperties } from '../../common/telemetry';
import { ExperimentalSettings } from '../../experiments';
import { Configuration } from '../../configuration';
import { timeout } from '../../common/async';
import { BrowserHeaders } from 'browser-headers';
import { ControlServiceClient } from '@gitpod/supervisor-api-grpcweb/lib/control_pb_service';
import { NodeHttpTransport } from '@improbable-eng/grpc-web-node-http-transport';
import { CreateSSHKeyPairRequest } from '@gitpod/supervisor-api-grpcweb/lib/control_pb';
import * as ssh2 from 'ssh2';
import { ParsedKey } from 'ssh2-streams';
import { createServer as netCreateServer } from 'net';

const phaseMap: Record<WorkspaceInstanceStatus_Phase, WorkspaceInstancePhase | undefined> = {
    [WorkspaceInstanceStatus_Phase.CREATING]: 'pending',
    [WorkspaceInstanceStatus_Phase.IMAGEBUILD]: 'building',
    [WorkspaceInstanceStatus_Phase.INITIALIZING]: 'initializing',
    [WorkspaceInstanceStatus_Phase.INTERRUPTED]: 'interrupted',
    [WorkspaceInstanceStatus_Phase.PENDING]: 'stopping',
    [WorkspaceInstanceStatus_Phase.PREPARING]: 'stopped',
    [WorkspaceInstanceStatus_Phase.RUNNING]: 'running',
    [WorkspaceInstanceStatus_Phase.STOPPED]: 'stopped',
    [WorkspaceInstanceStatus_Phase.STOPPING]: 'stopping',
    [WorkspaceInstanceStatus_Phase.UNSPECIFIED]: undefined,
};

class ExtensionServiceImpl implements ExtensionServiceImplementation {
    constructor(
        private logService: ILogService,
        private sessionService: ISessionService,
        private hostService: IHostService,
        private experiments: ExperimentalSettings,
        private telemetryService: ITelemetryService
    ) {

    }

    private async getWorkspaceSSHKey(ownerToken: string, workspaceId: string, workspaceHost: string) {
        const workspaceUrl = `https://${workspaceId}.${workspaceHost}`;
        const metadata = new BrowserHeaders();
        metadata.append('x-gitpod-owner-token', ownerToken);
        const client = new ControlServiceClient(`${workspaceUrl}/_supervisor/v1`, { transport: NodeHttpTransport() });

        const privateKey = await new Promise<string>((resolve, reject) => {
            client.createSSHKeyPair(new CreateSSHKeyPairRequest(), metadata, (err, resp) => {
                if (err) {
                    return reject(err);
                }
                resolve(resp!.toObject().privateKey);
            });
        });

        const parsedResult = ssh2.utils.parseKey(privateKey);
        if (parsedResult instanceof Error || !parsedResult) {
            throw new Error('Error while parsing workspace SSH private key');
        }

        return (parsedResult as ParsedKey).getPrivatePEM();
    }

    async getWorkspaceAuthInfo(request: GetWorkspaceAuthInfoRequest, _context: CallContext): Promise<GetWorkspaceAuthInfoResponse> {
        try {
            const accessToken = this.sessionService.getGitpodToken();
            if (!accessToken) {
                throw new ServerError(Status.INTERNAL, 'no access token found');
            }
            const userId = this.sessionService.getUserId();
            const workspaceId = request.workspaceId;
            // TODO(lssh): Get auth info according to `request.gitpodHost`
            const gitpodHost = this.hostService.gitpodHost;
            const usePublicApi = await this.experiments.getUsePublicAPI(gitpodHost);
            const [workspace, ownerToken] = await withServerApi(accessToken, gitpodHost, svc => Promise.all([
                usePublicApi ? this.sessionService.getAPI().getWorkspace(workspaceId) : svc.server.getWorkspace(workspaceId),
                usePublicApi ? this.sessionService.getAPI().getOwnerToken(workspaceId) : svc.server.getOwnerToken(workspaceId),
            ]), this.logService);

            const phase = usePublicApi ? phaseMap[(workspace as Workspace).status?.instance?.status?.phase ?? WorkspaceInstanceStatus_Phase.UNSPECIFIED] : (workspace as WorkspaceInfo).latestInstance?.status.phase;

            const ideUrl = usePublicApi ? (workspace as Workspace).status?.instance?.status?.url : (workspace as WorkspaceInfo).latestInstance?.ideUrl;
            if (!ideUrl) {
                throw new ServerError(Status.DATA_LOSS, 'no ide url found');
            }
            const url = new URL(ideUrl);
            const workspaceHost = url.host.substring(url.host.indexOf('.') + 1);
            const instanceId = (usePublicApi ? (workspace as Workspace).status?.instance?.instanceId : (workspace as WorkspaceInfo).latestInstance?.id) as string;

            const sshkey = phase === 'running' ? (await this.getWorkspaceSSHKey(ownerToken, workspaceId, workspaceHost)) : '';

            return {
                gitpodHost,
                userId,
                workspaceId,
                instanceId,
                workspaceHost,
                ownerToken,
                sshkey,
                phase: phase ?? 'unknown',
            };
        } catch (e) {
            this.logService.error(e, 'failed to get workspace auth info');
            throw new ServerError(Status.UNAVAILABLE, e.toString());
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
    static MAX_LOCAL_SSH_PING_RETRY_COUNT = 10;
    static MAX_EXTENSION_ACTIVE_RETRY_COUNT = 10;

    private server: Server;

    constructor(
        private readonly logService: ILogService,
        private readonly sessionService: ISessionService,
        private readonly hostService: IHostService,
        private readonly telemetryService: ITelemetryService,
        private experiments: ExperimentalSettings,
    ) {
        super();
        this.server = this.getServer();
        this.tryActive();
    }

    private getServer(): Server {
        const server = createServer();
        const serviceImpl = new ExtensionServiceImpl(this.logService, this.sessionService, this.hostService, this.experiments, this.telemetryService);
        server.add(ExtensionServiceDefinition, serviceImpl);
        return server;
    }

    private async tryActive() {
        const port = Configuration.getLocalSshExtensionIpcPort();
        // TODO:
        // commenting this as it pollutes extension logs
        // verify port is used by our extension or show message to user
        // this.logService.debug('going to try active extension ipc service server on port ' + port);
        this.server.listen('127.0.0.1:' + port).then(() => {
            this.logService.info('extension ipc service server started to listen');
        }).catch(_e => {
            // this.logService.debug(`extension ipc service server failed to listen`, e);
            // TODO(lssh): listen to port and wait until disconnect and try again
            timeout(1000).then(() => {
                this.tryActive();
            });
        });
    }

    public override dispose() {
        this.server.forceShutdown();
    }
}

async function isPortUsed(port: number): Promise<boolean> {
    return new Promise<boolean>((resolve, _reject) => {
        const server = netCreateServer();
        server.once('error', () => {
            resolve(true);
        });
        server.once('listening', () => {
            server.close();
            resolve(false);
        });
        server.listen(port);
    });
}

export async function canExtensionServiceServerWork(): Promise<true> {
    const port = Configuration.getLocalSshExtensionIpcPort();
    if (!(await isPortUsed(port))) {
        return true;
    }
    const extensionIpc = createClient(ExtensionServiceDefinition, createChannel(`127.0.0.1:${port}`));
    await extensionIpc.ping({});
    return true;
}