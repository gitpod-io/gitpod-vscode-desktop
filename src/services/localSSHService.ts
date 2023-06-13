/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import fsp from 'fs/promises';
import lockfile from 'proper-lockfile';
import { Disposable } from '../common/dispose';
import { ILogService } from './logService';
import { Configuration } from '../configuration';
import { IHostService } from './hostService';
import SSHConfiguration from '../ssh/sshConfig';
import { isWindows } from '../common/platform';
import { getLocalSSHDomain } from '../remote';
import { ITelemetryService, UserFlowTelemetryProperties } from '../common/telemetry';
import { ISessionService } from './sessionService';
import { WrapError } from '../common/utils';
import { canExtensionServiceServerWork } from '../local-ssh/ipc/extensionServiceServer';
import { LocalSSHMetricsReporter } from './localSSHMetrics';

export interface ILocalSSHService {
    flow?: UserFlowTelemetryProperties;

    initialize: () => Promise<boolean>;
    extensionServerReady: () => Promise<boolean>;
}

type FailedToInitializeCode = 'Unknown' | 'LockFailed' | string;

// IgnoredFailedCodes contains the codes that don't need to send error report
const IgnoredFailedCodes: FailedToInitializeCode[] = ['ENOSPC'];

export class LocalSSHService extends Disposable implements ILocalSSHService {
    private initPromise!: Promise<boolean>;

    public flow?: UserFlowTelemetryProperties;

    private metricsReporter: LocalSSHMetricsReporter;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly hostService: IHostService,
        private readonly telemetryService: ITelemetryService,
        private readonly sessionService: ISessionService,
        private readonly logService: ILogService,
    ) {
        super();
        this.metricsReporter = new LocalSSHMetricsReporter(hostService.gitpodHost);
        hostService.onDidChangeHost(() => {
            this.metricsReporter = new LocalSSHMetricsReporter(hostService.gitpodHost);
        });
    }

    async initialize(): Promise<boolean> {
        if (this.initPromise) {
            return this.initPromise;
        }

        this.initPromise = this.doInitialize();
        this._register(vscode.workspace.onDidChangeConfiguration(async e => {
            if (
                e.affectsConfiguration('gitpod.lsshExtensionIpcPort') ||
                e.affectsConfiguration('gitpod.host') ||
                e.affectsConfiguration('remote.SSH.configFile')
            ) {
                if (e.affectsConfiguration('[javascript]') && e.affectsConfiguration('[markdown]')) {
                    // Seems onDidChangeConfiguration fires many times while resolving the remote (once with all settings),
                    // and because now we active the extension earlier with onResolveRemoteAuthority we get this false positive
                    // event, so ignore it if more settings are affected at the same time.
                    return;
                }

                await this.initPromise;
                this.initPromise = this.doInitialize();
            }
        }));

        return this.initPromise;
    }

    async extensionServerReady(): Promise<boolean> {
        try {
            await canExtensionServiceServerWork();
            this.metricsReporter.reportPingExtensionStatus('succeed');
            return true;
        } catch (e) {
            const failureCode = 'ExtensionServerUnavailable';
            const err = new WrapError('cannot ping extension ipc service server', e, failureCode);
            const flow = {
                ...this.flow,
                flow: 'ping_extension_server',
                gitpodHost: this.hostService.gitpodHost,
                userId: this.sessionService.safeGetUserId(),
                failureCode,
            };
            this.telemetryService.sendTelemetryException(err, {
                gitpodHost: flow.gitpodHost,
                userId: flow.userId,
                instanceId: flow.instanceId,
                workspaceId: flow.workspaceId,
            });
            this.telemetryService.sendUserFlowStatus('failure', flow);
            this.metricsReporter.reportPingExtensionStatus('failure');
            return false;
        }
    }

    private async doInitialize(): Promise<boolean> {
        let flowData = this.flow ?? { gitpodHost: this.hostService.gitpodHost, userId: this.sessionService.safeGetUserId() };
        flowData = { ...flowData, flow: 'local_ssh_config', useLocalAPP: String(Configuration.getUseLocalApp()) };
        try {
            const lockFolder = vscode.Uri.joinPath(this.context.globalStorageUri, 'initialize');
            await this.lock(lockFolder.fsPath, async () => {
                const locations = await this.copyProxyScript();
                await this.configureSettings(locations);
            });

            this.metricsReporter.reportConfigStatus('success');
            this.telemetryService.sendUserFlowStatus('success', flowData);
            return true;
        } catch (e) {
            this.logService.error('Failed to initialize ssh proxy config', e);

            let sendErrorReport = true;
            let failureCode: FailedToInitializeCode = 'Unknown';
            if (e?.code) {
                failureCode = e.code;
                sendErrorReport = !IgnoredFailedCodes.includes(e.code);
            }
            if (e?.message) {
                e.message = `Failed to initialize: ${e.message}`;
            }
            if (sendErrorReport) {
                this.telemetryService.sendTelemetryException(e, { gitpodHost: this.hostService.gitpodHost, useLocalAPP: String(Configuration.getUseLocalApp()) });
            }

            this.metricsReporter.reportConfigStatus('failure', failureCode);
            this.telemetryService.sendUserFlowStatus('failure', { ...flowData, failureCode });
            return false;
        }
    }

    private async configureSettings({ proxyScript, launcher }: { proxyScript: string; launcher: string }) {
        const extIpcPort = Configuration.getLocalSshExtensionIpcPort();
        const hostConfig = this.getHostSSHConfig(this.hostService.gitpodHost, launcher, proxyScript, extIpcPort);
        await SSHConfiguration.ensureIncludeGitpodSSHConfig();
        const gitpodConfig = await SSHConfiguration.loadGitpodSSHConfig();
        gitpodConfig.addHostConfiguration(hostConfig);
        await SSHConfiguration.saveGitpodSSHConfig(gitpodConfig);
    }

    private getHostSSHConfig(host: string, launcher: string, proxyScript: string, extIpcPort: number) {
        return {
            Host: '*.' + getLocalSSHDomain(host),
            StrictHostKeyChecking: 'no',
            ProxyCommand: `"${launcher}" "${process.execPath}" "${proxyScript}" --ms-enable-electron-run-as-node %h ${extIpcPort} ${vscode.env.machineId}`
        };
    }

    private async copyProxyScript() {
        try {
            const [proxyScript, launcher] = await Promise.all([
                this.copyFileToGlobalStorage('out/local-ssh/proxy.js', 'sshproxy/proxy.js'),
                isWindows ? this.copyFileToGlobalStorage('out/local-ssh/proxylauncher.bat', 'sshproxy/proxylauncher.bat') : this.copyFileToGlobalStorage('out/local-ssh/proxylauncher.sh', 'sshproxy/proxylauncher.sh')
            ]);
            if (!isWindows) {
                await fsp.chmod(launcher, 0o755);
            }
            return { proxyScript, launcher };
        } catch (e) {
            throw new WrapError('Failed to copy local ssh proxy scripts', e);
        }
    }

    private async copyFileToGlobalStorage(filepath: string, destPath: string) {
        const absFilepath = this.context.asAbsolutePath(filepath);
        const fileUri = vscode.Uri.file(absFilepath);
        const destUri = vscode.Uri.joinPath(this.context.globalStorageUri, destPath);
        await vscode.workspace.fs.copy(fileUri, destUri, { overwrite: true });
        return destUri.fsPath;
    }

    private async lock(path: string, cb: () => Promise<void>) {
        let release: () => Promise<void>;
        try {
            release = await lockfile.lock(path, {
                stale: 1000 * 10, // 10s
                retries: {
                    retries: 3,
                    factor: 1,
                    minTimeout: 1 * 1000,
                    randomize: true,
                },
                realpath: false,
            });
        } catch (e) {
            throw new WrapError('Failed to lock file', e, 'LockFailed');
        }
        try {
            await cb();
        } catch (e) {
            throw e;
        } finally {
            await release();
        }
    }
}
