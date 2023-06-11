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
import { WORKSPACE_STOPPED_PREFIX, WorkspaceRestartInfo, getGitpodRemoteWindowConnectionInfo, getLocalSSHDomain } from '../remote';
import { ITelemetryService, UserFlowTelemetryProperties } from '../common/telemetry';
import { ISessionService } from './sessionService';
import { WrapError } from '../common/utils';
import { canExtensionServiceServerWork } from '../local-ssh/ipc/extensionServiceServer';
import { INotificationService } from './notificationService';
import { LocalSSHMetricsReporter } from './localSSHMetrics';

export interface IRemoteService {
    flow?: UserFlowTelemetryProperties;

    setupSSHProxy: () => Promise<boolean>;
    extensionServerReady: () => Promise<boolean>;

    saveRestartInfo(): Promise<void>;
    checkForStoppedWorkspaces(flow: UserFlowTelemetryProperties): void;
}

type FailedToInitializeCode = 'Unknown' | 'LockFailed' | string;

// IgnoredFailedCodes contains the codes that don't need to send error report
const IgnoredFailedCodes: FailedToInitializeCode[] = ['ENOSPC'];

export class RemoteService extends Disposable implements IRemoteService {
    private setupProxyPromise!: Promise<boolean>;

    public flow?: UserFlowTelemetryProperties;

    private metricsReporter: LocalSSHMetricsReporter;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly hostService: IHostService,
        private readonly notificationService: INotificationService,
        private readonly telemetryService: ITelemetryService,
        private readonly sessionService: ISessionService,
        private readonly logService: ILogService,
    ) {
        super();
        this.metricsReporter = new LocalSSHMetricsReporter(logService);
    }

    async setupSSHProxy(): Promise<boolean> {
        if (this.setupProxyPromise) {
            return this.setupProxyPromise;
        }

        this.setupProxyPromise = this.doSetupSSHProxy();
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

                await this.setupProxyPromise;
                this.setupProxyPromise = this.doSetupSSHProxy();
            }
        }));

        return this.setupProxyPromise;
    }

    async extensionServerReady(): Promise<boolean> {
        try {
            await canExtensionServiceServerWork();
            this.metricsReporter.reportPingExtensionStatus(this.flow?.gitpodHost, 'success');
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
            this.metricsReporter.reportPingExtensionStatus(flow.gitpodHost, 'failure');
            return false;
        }
    }

    private async doSetupSSHProxy(): Promise<boolean> {
        let flowData = this.flow ?? { gitpodHost: this.hostService.gitpodHost, userId: this.sessionService.safeGetUserId() };
        flowData = { ...flowData, flow: 'local_ssh_config', useLocalAPP: String(Configuration.getUseLocalApp()) };
        try {
            const lockFolder = vscode.Uri.joinPath(this.context.globalStorageUri, 'initialize');
            await this.withLock(lockFolder.fsPath, async () => {
                const locations = await this.copyProxyScript();
                await this.configureSettings(locations);
            });

            this.metricsReporter.reportConfigStatus(flowData.gitpodHost, 'success');
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
                this.telemetryService.sendTelemetryException(e, { gitpodHost: flowData.gitpodHost, useLocalAPP: String(Configuration.getUseLocalApp()) });
            }

            this.metricsReporter.reportConfigStatus(flowData.gitpodHost, 'failure', failureCode);
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

    private async withLock(path: string, cb: () => Promise<void>) {
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

    async saveRestartInfo() {
        const connInfo = getGitpodRemoteWindowConnectionInfo(this.context);
        if (!connInfo) {
            return;
        }

        await this.context.globalState.update(`${WORKSPACE_STOPPED_PREFIX}${connInfo.sshDestStr}`, { workspaceId: connInfo.connectionInfo.workspaceId, gitpodHost: connInfo.connectionInfo.gitpodHost, remoteUri: connInfo.remoteUri.toString() } as WorkspaceRestartInfo);
    }

    checkForStoppedWorkspaces(flow: UserFlowTelemetryProperties) {
        const keys = this.context.globalState.keys();
        const stopped_ws_keys = keys.filter(k => k.startsWith(WORKSPACE_STOPPED_PREFIX));
        for (const k of stopped_ws_keys) {
            const ws = this.context.globalState.get<WorkspaceRestartInfo>(k)!;
            this.context.globalState.update(k, undefined);
            if (new URL(flow.gitpodHost).host === new URL(ws.gitpodHost).host) {
                this.showWsNotRunningDialog(ws, { ...flow, workspaceId: ws.workspaceId, gitpodHost: ws.gitpodHost });
            }
        }
    }

    private async showWsNotRunningDialog({ workspaceId, gitpodHost, remoteUri }: WorkspaceRestartInfo, flow: UserFlowTelemetryProperties) {
        const msg = `Workspace ${workspaceId} is not running. Please restart the workspace.`;
        this.logService.error(msg);

        const startWorkspace: vscode.MessageItem = { title: 'Start workspace' };
        const resp = await this.notificationService.showErrorMessage(msg, { id: 'ws_not_running', flow, modal: true }, startWorkspace);
        if (resp === startWorkspace) {
            vscode.commands.executeCommand('gitpod.workspaces.connectInCurrentWindow', workspaceId, gitpodHost, vscode.Uri.parse(remoteUri));
        }
    }
}
