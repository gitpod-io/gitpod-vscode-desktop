/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExtensionServiceDefinition, ExtensionServiceImplementation, GetWorkspaceAuthInfoRequest, GetWorkspaceAuthInfoResponse, SendErrorReportRequest, SendLocalSSHUserFlowStatusRequest, SendLocalSSHUserFlowStatusRequest_Code, SendLocalSSHUserFlowStatusRequest_ConnType, SendLocalSSHUserFlowStatusRequest_Status } from '../../proto/typescript/ipc/v1/ipc';
import { Disposable } from '../../common/dispose';
export { ExtensionServiceDefinition } from '../../proto/typescript/ipc/v1/ipc';
import { withServerApi } from '../../internalApi';
import { Workspace, WorkspaceInstanceStatus_Phase } from '@gitpod/public-api/lib/gitpod/experimental/v1';
import { WorkspaceInfo, WorkspaceInstancePhase } from '@gitpod/gitpod-protocol';
import { ILogService } from '../../services/logService';
import { ISessionService } from '../../services/sessionService';
import { CallContext, ServerError, Status } from 'nice-grpc-common';
import { IHostService } from '../../services/hostService';
import { Server, createServer } from 'nice-grpc';
import { ITelemetryService, UserFlowTelemetry } from '../../services/telemetryService';
import { ExperimentalSettings } from '../../experiments';
import { Configuration } from '../../configuration';
import { timeout } from '../../common/async';

const phaseMap: Record<WorkspaceInstanceStatus_Phase, WorkspaceInstancePhase | undefined> = {
    [WorkspaceInstanceStatus_Phase.CREATING]: 'pending',
    [WorkspaceInstanceStatus_Phase.IMAGEBUILD]: 'building',
    [WorkspaceInstanceStatus_Phase.INITIALIZING]: 'initializing',
    [WorkspaceInstanceStatus_Phase.INTERRUPTED]: 'running',
    [WorkspaceInstanceStatus_Phase.PENDING]: 'stopping',
    [WorkspaceInstanceStatus_Phase.PREPARING]: 'stopped',
    [WorkspaceInstanceStatus_Phase.RUNNING]: 'running',
    [WorkspaceInstanceStatus_Phase.STOPPED]: 'stopped',
    [WorkspaceInstanceStatus_Phase.STOPPING]: 'stopping',
    [WorkspaceInstanceStatus_Phase.UNSPECIFIED]: undefined,
};

export class ExtensionServiceImpl implements ExtensionServiceImplementation {
    constructor(
        private logService: ILogService,
        private sessionService: ISessionService,
        private hostService: IHostService,
        private experiments: ExperimentalSettings,
        private telemetryService: ITelemetryService
    ) {

    }

    async getWorkspaceAuthInfo(request: GetWorkspaceAuthInfoRequest, _context: CallContext): Promise<GetWorkspaceAuthInfoResponse> {
        try {
            await this.sessionService.didFirstLoad;
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
            if (phase !== 'running') {
                // TODO(lssh): extension child ipc broadcasts this error to all windows
                throw new ServerError(Status.UNAVAILABLE, 'workspace is not running, current phase: ' + phase);
            }

            const ideUrl = usePublicApi ? (workspace as Workspace).status?.instance?.status?.url : (workspace as WorkspaceInfo).latestInstance?.ideUrl;
            if (!ideUrl) {
                throw new ServerError(Status.DATA_LOSS, 'no ide url found');
            }
            const url = new URL(ideUrl);
            const workspaceHost = url.host.substring(url.host.indexOf('.') + 1);
            const instanceId = (usePublicApi ? (workspace as Workspace).status?.instance?.instanceId : (workspace as WorkspaceInfo).latestInstance?.id) as string;
            return {
                gitpodHost,
                userId,
                workspaceId,
                instanceId,
                workspaceHost,
                ownerToken,
            };
        } catch (e) {
            this.logService.error(e, 'failed to get workspace auth info');
            throw e;
        }
    }

    // TODO remove from protocol, don't pass sensitive info back and forth, only once for auth, daemon should do telemtry directly
    async sendLocalSSHUserFlowStatus(request: SendLocalSSHUserFlowStatusRequest, _context: CallContext): Promise<{}> {
        const flow: UserFlowTelemetry = {
            flow: 'ssh',
            kind: 'local-ssh',
            connType: request.connType === SendLocalSSHUserFlowStatusRequest_ConnType.CONN_TYPE_SSH ? 'ssh' : 'tunnel',
            workspaceId: request.workspaceId,
            instanceId: request.instanceId,
            daemonVersion: request.daemonVersion,
            userId: request.userId,
            gitpodHost: request.gitpodHost,
            // extensionVersion: request.extensionVersion,
        };
        if (request.status !== SendLocalSSHUserFlowStatusRequest_Status.STATUS_SUCCESS && request.failureCode !== SendLocalSSHUserFlowStatusRequest_Code.CODE_UNSPECIFIED) {
            flow.reasonCode = SendLocalSSHUserFlowStatusRequest_Code[request.failureCode];
        }
        const status = request.status === SendLocalSSHUserFlowStatusRequest_Status.STATUS_SUCCESS ? 'local-ssh-success' : 'local-ssh-failure';
        this.telemetryService.sendUserFlowStatus(status, flow);
        return {};
    }

    // TODO remove from protocol, don't pass sensitive info back and forth, only once for auth, daemon should do telemtry directly
    // local ssh daemon should be own component in reporting?
    async sendErrorReport(request: SendErrorReportRequest, _context: CallContext): Promise<{}> {
        const err = new Error(request.errorMessage);
        err.name = `${request.errorName}[local-ssh]`;
        err.stack = request.errorStack;
        const properties: Record<string, any> = {
            workspaceId: request.workspaceId,
            instanceId: request.instanceId,
            daemonVersion: request.daemonVersion,
            extensionVersion: request.extensionVersion,
            userId: request.userId,
        };
        this.telemetryService.sendTelemetryException(request.gitpodHost, err, properties);
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
        this.hostService.onDidChangeHost(() => {
            this.tryActive();
        });
    }

    private getServer(): Server {
        const server = createServer();
        const serviceImpl = new ExtensionServiceImpl(this.logService, this.sessionService, this.hostService, this.experiments, this.telemetryService);
        server.add(ExtensionServiceDefinition, serviceImpl);
        return server;
    }

    private async tryActive() {
        const port = Configuration.getLocalSshExtensionIpcPort();
        this.logService.debug('going to try active extension ipc service server on port ' + port);
        this.server.listen('127.0.0.1:' + port).then(() => {
            this.logService.info('extension ipc service server started to listen');
        }).catch(e => {
            this.logService.debug(`extension ipc service server failed to listen`, e);
            // TODO(lssh): listen to port and wait until disconnect and try again
            timeout(1000).then(() => {
                this.tryActive();
            });
        });
    }

    public override dispose() {
        this.server.shutdown();
    }
}
