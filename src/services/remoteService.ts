/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import fsp from 'fs/promises';
import lockfile from 'proper-lockfile';
import { Disposable } from '../common/dispose';
import { ILogService } from './logService';
import { Configuration } from '../configuration';
import { IHostService } from './hostService';
import SSHConfiguration from '../ssh/sshConfig';
import { isWindows } from '../common/platform';
import { NoExtensionIPCServerError, NoLocalSSHSupportError, NoSSHGatewayError, WORKSPACE_STOPPED_PREFIX, WorkspaceRestartInfo, getGitpodRemoteWindowConnectionInfo, getLocalSSHDomain } from '../remote';
import { ITelemetryService, UserFlowTelemetryProperties } from '../common/telemetry';
import { ISessionService } from './sessionService';
import { WrapError, getServiceURL } from '../common/utils';
import { ExtensionServiceServer } from '../local-ssh/ipc/extensionServiceServer';
import { LocalSSHMetricsReporter } from './localSSHMetrics';
import SSHDestination from '../ssh/sshDestination';
import { WorkspaceData } from '../publicApi';
import { getAgentSock, testSSHConnection } from '../sshTestConnection';
import { addHostToHostFile, checkNewHostInHostkeys } from '../ssh/hostfile';
import { gatherIdentityFiles } from '../ssh/identityFiles';
import { ParsedKey } from 'ssh2-streams';
import * as crypto from 'crypto';
import { utils as sshUtils } from 'ssh2';
import { INotificationService } from './notificationService';
import { getOpenSSHVersion } from '../ssh/nativeSSH';
import { retry } from '../common/async';
import { IStoredProfileExtension } from '../profileExtensions';

export interface IRemoteService {
    flow?: UserFlowTelemetryProperties;

    setupSSHProxy: () => Promise<void>;
    startLocalSSHServiceServer: () => Promise<void>;
    saveRestartInfo: () => Promise<void>;
    checkForStoppedWorkspaces: (cb: (info: WorkspaceRestartInfo) => Promise<void>) => Promise<void>;

    getWorkspaceSSHDestination(wsData: WorkspaceData): Promise<{ destination: SSHDestination; password?: string }>;
    showSSHPasswordModal(wsData: WorkspaceData, password: string): Promise<void>;

    initializeRemoteExtensions(): Promise<void>;
}

type FailedToInitializeCode = 'Unknown' | 'LockFailed' | string;

// IgnoredFailedCodes contains the codes that don't need to send error report
const IgnoredFailedCodes: FailedToInitializeCode[] = ['ENOSPC'];

export class RemoteService extends Disposable implements IRemoteService {
    private setupProxyPromise!: Promise<void>;

    public flow?: UserFlowTelemetryProperties;

    private metricsReporter: LocalSSHMetricsReporter;
    private extensionServiceServer: ExtensionServiceServer | undefined;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly hostService: IHostService,
        private readonly sessionService: ISessionService,
        private readonly notificationService: INotificationService,
        private readonly telemetryService: ITelemetryService,
        private readonly logService: ILogService,
    ) {
        super();
        this.metricsReporter = new LocalSSHMetricsReporter(logService);
    }

    async setupSSHProxy(): Promise<void> {
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

                this.setupProxyPromise = this.setupProxyPromise.then(() => this.doSetupSSHProxy(), () => this.doSetupSSHProxy());
            }
        }));

        return this.setupProxyPromise;
    }

    async startLocalSSHServiceServer() {
        this.logService.trace('Starting local ssh service server');
        if (!this.extensionServiceServer) {
            this.extensionServiceServer = this._register(new ExtensionServiceServer(this.logService, this.sessionService, this.hostService, this.telemetryService));
        }

        try {
            await this.extensionServiceServer.canExtensionServiceServerWork();
            this.metricsReporter.reportPingExtensionStatus(this.hostService.gitpodHost, 'success');
            this.logService.trace('Local ssh service server started');
        } catch (e) {
            const failureCode = 'ExtensionServerUnavailable';
            const flow = {
                ...this.flow,
                flow: 'ping_extension_server',
                gitpodHost: this.hostService.gitpodHost,
                userId: this.sessionService.safeGetUserId(),
                failureCode,
            };
            const err = new WrapError('cannot ping extension ipc service server', e, failureCode);
            this.logService.error('Failed start local ssh service server', err);
            this.telemetryService.sendTelemetryException(err, {
                gitpodHost: flow.gitpodHost,
                userId: flow.userId,
                instanceId: flow.instanceId,
                workspaceId: flow.workspaceId,
            });
            this.telemetryService.sendUserFlowStatus('failure', flow);
            this.metricsReporter.reportPingExtensionStatus(this.hostService.gitpodHost, 'failure');

            throw new NoExtensionIPCServerError();
        }
    }

    private async doSetupSSHProxy(): Promise<void> {
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

            throw new NoLocalSSHSupportError();
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

    async saveRestartInfo() {
        const connInfo = getGitpodRemoteWindowConnectionInfo(this.context);
        if (!connInfo) {
            return;
        }

        await this.context.globalState.update(`${WORKSPACE_STOPPED_PREFIX}${connInfo.sshDestStr}`, { workspaceId: connInfo.connectionInfo.workspaceId, gitpodHost: connInfo.connectionInfo.gitpodHost, remoteUri: connInfo.remoteUri.toString() } as WorkspaceRestartInfo);
    }

    async checkForStoppedWorkspaces(cb: (info: WorkspaceRestartInfo) => Promise<void>) {
        const keys = this.context.globalState.keys();
        const stopped_ws_keys = keys.filter(k => k.startsWith(WORKSPACE_STOPPED_PREFIX));
        for (const k of stopped_ws_keys) {
            const ws = this.context.globalState.get<WorkspaceRestartInfo>(k)!;
            if (new URL(this.hostService.gitpodHost).host === new URL(ws.gitpodHost).host) {
                try {
                    await cb(ws);
                } catch {
                }
            }
            await this.context.globalState.update(k, undefined);
        }
    }

    async getWorkspaceSSHDestination({ id: workspaceId, workspaceUrl }: WorkspaceData): Promise<{ destination: SSHDestination; password?: string }> {
        const [ownerToken, registeredSSHKeys] = await Promise.all([
            this.sessionService.getAPI().getOwnerToken(workspaceId),
            this.sessionService.getAPI().getSSHKeys()
        ]);

        const wsUrl = new URL(workspaceUrl);
        const sshHostKeyEndPoint = `https://${wsUrl.host}/_ssh/host_keys`;
        const sshHostKeyResponse = await fetch(sshHostKeyEndPoint);
        if (!sshHostKeyResponse.ok) {
            // Gitpod SSH gateway not configured
            throw new NoSSHGatewayError(this.hostService.gitpodHost);
        }

        const sshHostKeys = (await sshHostKeyResponse.json()) as { type: string; host_key: string }[];
        let user = workspaceId;
        // See https://github.com/gitpod-io/gitpod/pull/9786 for reasoning about `.ssh` suffix
        let hostname = wsUrl.host.replace(workspaceId, `${workspaceId}.ssh`);

        const sshConfiguration = await SSHConfiguration.loadFromFS();

        const verifiedHostKey = await testSSHConnection({
            host: hostname,
            username: user,
            readyTimeout: 40000,
            password: ownerToken
        }, sshHostKeys, sshConfiguration, this.logService);

        // SSH connection successful, write host to known_hosts
        try {
            const result = sshUtils.parseKey(verifiedHostKey!);
            if (result instanceof Error) {
                throw result;
            }
            const parseKey = Array.isArray(result) ? result[0] : result;
            if (parseKey && await checkNewHostInHostkeys(hostname)) {
                await addHostToHostFile(hostname, verifiedHostKey!, parseKey.type);
                this.logService.info(`'${hostname}' host added to known_hosts file`);
            }
        } catch (e) {
            this.logService.error(`Couldn't write '${hostname}' host to known_hosts file:`, e);
        }

        const hostConfiguration = sshConfiguration.getHostConfiguration(hostname);
        const identityFiles: string[] = (hostConfiguration['IdentityFile'] as unknown as string[]) || [];
        let identityKeys = await gatherIdentityFiles(identityFiles, getAgentSock(hostConfiguration), false, this.logService);

        const registeredKeys = registeredSSHKeys.map(k => {
            const parsedResult = sshUtils.parseKey(k.key);
            if (parsedResult instanceof Error || !parsedResult) {
                this.logService.error(`Error while parsing SSH public key ${k.name}:`, parsedResult);
                return { name: k.name, fingerprint: '' };
            }

            const parsedKey = parsedResult as ParsedKey;
            return { name: k.name, fingerprint: crypto.createHash('sha256').update(parsedKey.getPublicSSH()).digest('base64') };
        });
        this.logService.trace(`Registered public keys in Gitpod account:`, registeredKeys.length ? registeredKeys.map(k => `${k.name} SHA256:${k.fingerprint}`).join('\n') : 'None');

        identityKeys = identityKeys.filter(k => !!registeredKeys.find(regKey => regKey.fingerprint === k.fingerprint));

        return {
            destination: new SSHDestination(hostname, user),
            password: identityKeys.length === 0 ? ownerToken : undefined
        };
    }

    async showSSHPasswordModal({ id: workspaceId }: WorkspaceData, password: string) {
        const maskedPassword = '•'.repeat(password.length - 3) + password.substring(password.length - 3);

        const copy: vscode.MessageItem = { title: 'Copy' };
        const configureSSH: vscode.MessageItem = { title: 'Configure SSH' };
        const showLogs: vscode.MessageItem = { title: 'Show logs', isCloseAffordance: true };
        const message = `You don't have registered any SSH public key for this machine in your Gitpod account.\nAlternatively, copy and use this temporary password until workspace restart: ${maskedPassword}`;
        const flow = { flow: 'ssh', gitpodHost: this.hostService.gitpodHost, kind: 'gateway', workspaceId, openSSHVersion: await getOpenSSHVersion(), userId: this.sessionService.getUserId() };
        const action = await this.notificationService.showWarningMessage(message, { flow, modal: true, id: 'ssh_gateway_modal' }, copy, configureSSH, showLogs);

        if (action === copy) {
            await vscode.env.clipboard.writeText(password);
            return;
        }

        const serviceUrl = getServiceURL(this.hostService.gitpodHost);
        const externalUrl = `${serviceUrl}/keys`;
        if (action === configureSSH) {
            await vscode.env.openExternal(vscode.Uri.parse(externalUrl));
            throw new Error(`SSH password modal dialog, Configure SSH`);
        }

        this.logService.info(`Configure your SSH keys in ${externalUrl} and try again. Or try again and select 'Copy' to connect using a temporary password until workspace restart`);
        this.logService.show();
        throw new Error('SSH password modal dialog, Canceled');
    }

    async initializeRemoteExtensions() {
        let flowData = this.flow ?? { gitpodHost: this.hostService.gitpodHost, userId: this.sessionService.safeGetUserId() };
        flowData = { ...flowData, flow: 'sync_local_extensions', useLocalAPP: String(Configuration.getUseLocalApp()) };

        try {
            let extensionsJson: IStoredProfileExtension[] = [];
            const extensionsDir = path.dirname(this.context.extensionMode === vscode.ExtensionMode.Production ? this.context.extensionPath : vscode.extensions.getExtension('ms-vscode-remote.remote-ssh')!.extensionPath);
            const extensionFile = path.join(extensionsDir, 'extensions.json');
            try {
                const rawContent = await vscode.workspace.fs.readFile(vscode.Uri.file(extensionFile));
                const jsonSting = new TextDecoder().decode(rawContent);
                extensionsJson = JSON.parse(jsonSting);
            } catch (e) {
                this.logService.error(`Could not read ${extensionFile} file contents`, e);
                throw e;
            }

            const localExtensions = extensionsJson.filter(e => !e.metadata?.isBuiltin && !e.metadata?.isSystem).map(e => ({ identifier: { id: e.identifier.id.toLowerCase() } }));

            const allUserActiveExtensions = vscode.extensions.all.filter(ext => !ext.packageJSON['isBuiltin'] && !ext.packageJSON['isUserBuiltin']);
            const localActiveExtensions = new Set<string>();
            allUserActiveExtensions.forEach(e => localActiveExtensions.add(e.id.toLowerCase()));

            const extensionsToInstall = localExtensions.filter(e => !localActiveExtensions.has(e.identifier.id));

            try {
                this.logService.trace(`Installing local extensions on remote: `, extensionsToInstall.map(e => e.identifier.id).join('\n'));
                await retry(async () => {
                    await vscode.commands.executeCommand('__gitpod.initializeRemoteExtensions', extensionsToInstall);
                }, 3000, 15);
            } catch (e) {
                this.logService.error(`Could not execute '__gitpod.initializeRemoteExtensions' command`);
                throw e;
            }
            this.telemetryService.sendUserFlowStatus('synced', flowData);
        } catch {
            const msg = `Error while installing local extensions on remote.`;
            this.logService.error(msg);

            const status = 'failed';
            const seeLogs = 'See Logs';
            const action = await this.notificationService.showErrorMessage(msg, { flow: flowData, id: status }, seeLogs);
            if (action === seeLogs) {
                this.logService.show();
            }
        }
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
}
