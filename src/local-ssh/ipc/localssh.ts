/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ActiveRequest, ExtensionServiceDefinition, GetDaemonVersionRequest, InactiveRequest, LocalSSHServiceDefinition, LocalSSHServiceImplementation, PingRequest, SendErrorReportRequest, SendLocalSSHUserFlowStatusRequest } from '../../proto/typescript/ipc/v1/ipc';
import { CallContext, Client, ServerError, Status, createChannel, createClient, createServer } from 'nice-grpc';
import { ExitCode, exitProcess, getDaemonVersion, getRunningExtensionVersion } from '../common';
import { retryWithStop } from '../../common/async';
import { ILogService } from '../../services/logService';

export class LocalSSHServiceImpl implements LocalSSHServiceImplementation {
    public extensionServices: { id: string; client: Client<ExtensionServiceDefinition> }[] = [];
    private exitCancel?: NodeJS.Timeout;

    constructor(private logger: ILogService) {
        this.pingExtensionServices();
    }

    async getDaemonVersion(_request: GetDaemonVersionRequest, _context: CallContext): Promise<{ version?: string | undefined }> {
        return {
            version: getDaemonVersion(),
        };
    }

    async active(request: ActiveRequest, _context: CallContext): Promise<{}> {
        this.activeExtension(request.id, request.ipcPort);
        return {};
    }

    async inactive(request: InactiveRequest, _context: CallContext): Promise<{}> {
        this.inactiveClientID(request.id, 'request');
        return {};
    }

    async ping(_request: PingRequest, _context: CallContext): Promise<{}> {
        return {};
    }

    private activeExtension(id: string, ipcPort: number) {
        if (this.extensionServices.find(e => e.id === id)) {
            return;
        }

        this.extensionServices.unshift({ id, client: createClient(ExtensionServiceDefinition, createChannel('127.0.0.1:' + ipcPort)) });
        this.logger.info(`extension svc activated, id: ${id}, port: ${ipcPort}, current clients: ${this.extensionServices.length}`);
    }

    private async inactiveClientID(id: string, reason: 'schedulePing' | 'request') {
        this.extensionServices = this.extensionServices.filter(e => e.id !== id);
        this.logger.info(`extension svc inactivated: ${reason}, id: ${id}, current clients: ${this.extensionServices.length}`);
    }

    private pingExtensionServices() {
        setInterval(async () => {
            const inactiveIdList = new Set<string>();
            for (let i = 0; i < this.extensionServices.length; i++) {
                const ext = this.extensionServices[i];
                try {
                    await ext.client.ping({});
                } catch (err) {
                    this.logger.debug('failed to ping extension service, id: ' + ext.id + ', err: ' + err);
                    inactiveIdList.add(ext.id);
                }
            }
            inactiveIdList.forEach(id => this.inactiveClientID(id, 'schedulePing'));
            if (this.extensionServices.length === 0) {
                if (this.exitCancel) {
                    return;
                }
                // exit immediately if no extension service client activated
                this.logger.info('no extension service client activated, exiting...');
                this.exitCancel = setTimeout(() => {
                    exitProcess(ExitCode.OK);
                }, 10000);
            } else if (this.exitCancel) {
                clearTimeout(this.exitCancel);
            }
        }, 1000);
    }

    public async getWorkspaceAuthInfo(workspaceId: string) {
        return retryWithStop(async (stop) => {
            const getAuthInfo = async (id: string, client: Client<ExtensionServiceDefinition>) => {
                try {
                    return await client.getWorkspaceAuthInfo({ workspaceId });
                } catch (e) {
                    if (e instanceof ServerError) {
                        if (e.code === Status.UNAVAILABLE && e.details.startsWith('workspace is not running')) {
                            stop();
                        }
                    }
                    this.logger.error(e, 'failed to get workspace auth info, id: ' + id);
                    throw e;
                }
            };
            return await Promise.any(this.extensionServices.map(ext => getAuthInfo(ext.id, ext.client)));
        }, 200, 3);
    }

    public async sendTelemetry(request: SendLocalSSHUserFlowStatusRequest) {
        for (const ext of this.extensionServices) {
            try {
                await ext.client.sendLocalSSHUserFlowStatus(request);
                break;
            } catch (e) {
                this.logger.error(e, 'failed to send telemetry');
            }
        }
    }

    public async sendErrorReport(gitpodHost: string, userId: string, workspaceId: string | undefined, instanceId: string | undefined, err: Error | any, message: string) {
        if (!err || this.extensionServices.length === 0) {
            return;
        }
        const request: SendErrorReportRequest = {
            gitpodHost,
            userId,
            workspaceId: workspaceId ?? '',
            instanceId: instanceId ?? '',
            errorName: '',
            errorMessage: '',
            errorStack: '',
            daemonVersion: getDaemonVersion(),
            extensionVersion: getRunningExtensionVersion(),
        };
        if (err instanceof Error) {
            request.errorName = err.name;
            request.errorMessage = message + ': ' + err.message;
            request.errorStack = err.stack ?? '';
        } else {
            request.errorName = err.toString();
            request.errorMessage = message + ': ' + err.toString();
        }
        for (const ext of this.extensionServices) {
            try {
                await ext.client.sendErrorReport(request);
                break;
            } catch (e) {
                this.logger.error(e, 'failed to send error report');
            }
        }
    }
}

export async function startLocalSSHService(logger: ILogService, port: number, serviceImpl: LocalSSHServiceImpl) {
    logger.info('going to start local ssh service with port: ' + port);
    const server = createServer();
    server.add(LocalSSHServiceDefinition, serviceImpl);
    await server.listen('127.0.0.1:' + port);
    return server;
}
