/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ActiveRequest, ExtensionServiceDefinition, InactiveRequest, LocalSSHServiceDefinition, LocalSSHServiceImplementation, PingRequest } from '../../proto/typescript/ipc/v1/ipc';
import { CallContext, Client, createChannel, createClient, createServer } from 'nice-grpc';
import { ExitCode, exitProcess, getExtensionIPCHandlePath, getLocalSSHIPCHandlePath, Logger } from '../common';
import { existsSync, unlinkSync } from 'fs';
import { retry } from '../../common/async';

export class LocalSSHServiceImpl implements LocalSSHServiceImplementation {
    public extensionServices: { id: string; client: Client<ExtensionServiceDefinition> }[] = [];
    private exitCancel?: NodeJS.Timeout;

    constructor(private logger: Logger) {
        this.pingExtensionServices();
    }

    async active(request: ActiveRequest, _context: CallContext): Promise<{}> {
        this.activeExtension(request.id);
        return {};
    }

    async inactive(request: InactiveRequest, _context: CallContext): Promise<{}> {
        this.inactiveClientID(request.id);
        return {};
    }

    async ping(_request: PingRequest, _context: CallContext): Promise<{}> {
        return {};
    }

    private activeExtension(id: string) {
        if (this.extensionServices.find(e => e.id === id)) {
            return;
        }

        this.extensionServices.unshift({ id, client: createClient(ExtensionServiceDefinition, createChannel('unix://' + getExtensionIPCHandlePath(id))) });
        this.logger.info(`extension svc activated, id: ${id}, current clients: ${this.extensionServices.length}`);
    }

    private async inactiveClientID(id: string) {
        this.extensionServices = this.extensionServices.filter(e => e.id !== id);
        this.logger.info(`extension svc inactivated, id: ${id}, current clients: ${this.extensionServices.length}`);
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
            inactiveIdList.forEach(id => this.inactiveClientID(id));
            if (this.extensionServices.length === 0) {
                if (this.exitCancel) {
                    return;
                }
                exitProcess(this.logger, ExitCode.OK, true);
                // this.logger.info('no extension service client activated, going to stop daemon in 3m');
                // this.exitCancel = setTimeout(() => {
                //     exitProcess(this.logger, ExitCode.OK, true);
                // }, 3 * 60 * 1000);
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
                    e.message = 'failed to get workspace auth info, id: ' + ext.id + ', err: ' + e.message;
                    this.logger.error(e);
                    throw e;
                }
            }
            throw new Error('no extension service client activated');
        }, 200, 3);

    }
}

export async function startLocalSSHService(serviceImpl: LocalSSHServiceImpl) {
    const sockFile = getLocalSSHIPCHandlePath();
    if (existsSync(sockFile)) {
        unlinkSync(sockFile);
    }
    const server = createServer();
    server.add(LocalSSHServiceDefinition, serviceImpl);
    await server.listen('unix://' + sockFile);
    return server;
}
