/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ActiveRequest, ExtensionServiceDefinition, GetDaemonVersionRequest, InactiveRequest, LocalSSHServiceDefinition, LocalSSHServiceImplementation, PingRequest, SendErrorReportRequest, SendLocalSSHUserFlowStatusRequest } from '../../proto/typescript/ipc/v1/ipc';
import { CallContext, Client, createChannel, createClient, createServer } from 'nice-grpc';
import { ExitCode, exitProcess, getDaemonVersion, getExtensionIPCHandleAddr, getLocalSSHIPCHandleAddr, getLocalSSHIPCHandlePath, getRunningExtensionVersion } from '../common';
import { existsSync, unlinkSync } from 'fs';
import { retry } from '../../common/async';
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
        this.activeExtension(request.id);
        return {};
    }

    async inactive(request: InactiveRequest, _context: CallContext): Promise<{}> {
        this.inactiveClientID(request.id, 'request');
        return {};
    }

    async ping(_request: PingRequest, _context: CallContext): Promise<{}> {
        return {};
    }

    private activeExtension(id: string) {
        if (this.extensionServices.find(e => e.id === id)) {
            return;
        }

        this.extensionServices.unshift({ id, client: createClient(ExtensionServiceDefinition, createChannel(getExtensionIPCHandleAddr(id))) });
        this.logger.info(`channel: ${getExtensionIPCHandleAddr(id)}`);
        this.logger.info(`extension svc activated, id: ${id}, current clients: ${this.extensionServices.length}`);
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
        return retry(async () => {
            for (const ext of this.extensionServices) {
                try {
                    const authInfo = await ext.client.getWorkspaceAuthInfo({ workspaceId });
                    return authInfo;
                } catch (e) {
                    this.logger.error(e, 'failed to get workspace auth info, id: ' + ext.id);
                    throw e;
                }
            }
            throw new Error('no extension service client activated');
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

    public async sendErrorReport(workspaceId: string | undefined, instanceId: string | undefined, err: Error | any, message: string) {
        if (!err || this.extensionServices.length === 0) {
            return;
        }
        const request: SendErrorReportRequest = {
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

export async function startLocalSSHService(serviceImpl: LocalSSHServiceImpl) {
    const sockFile = getLocalSSHIPCHandlePath();
    if (existsSync(sockFile)) {
        unlinkSync(sockFile);
    }
    const server = createServer();
    server.add(LocalSSHServiceDefinition, serviceImpl);
    await server.listen(getLocalSSHIPCHandleAddr());
    return server;
}