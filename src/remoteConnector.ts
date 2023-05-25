/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AutoTunnelRequest, ResolveSSHConnectionRequest, ResolveSSHConnectionResponse } from '@gitpod/local-app-api-grpcweb/lib/localapp_pb';
import { LocalAppClient } from '@gitpod/local-app-api-grpcweb/lib/localapp_pb_service';
import { NodeHttpTransport } from '@improbable-eng/grpc-web-node-http-transport';
import { grpc } from '@improbable-eng/grpc-web';
import { Workspace, WorkspaceInstanceStatus_Phase } from '@gitpod/public-api/lib/gitpod/experimental/v1/workspaces_pb';
import { UserSSHPublicKeyValue, WorkspaceInfo } from '@gitpod/gitpod-protocol';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
import * as crypto from 'crypto';
import { utils as sshUtils } from 'ssh2';
import { ParsedKey } from 'ssh2-streams';
import * as tmp from 'tmp';
import * as path from 'path';
import * as vscode from 'vscode';
import { Disposable } from './common/dispose';
import { withServerApi } from './internalApi';
import { ITelemetryService, UserFlowTelemetry } from './services/telemetryService';
import { addHostToHostFile, checkNewHostInHostkeys } from './ssh/hostfile';
import { ScopeFeature } from './featureSupport';
import SSHConfiguration from './ssh/sshConfig';
import { ExperimentalSettings, isUserOverrideSetting } from './experiments';
import { getOpenSSHVersion } from './ssh/sshVersion';
import { INotificationService } from './services/notificationService';
import { SSHKey } from '@gitpod/public-api/lib/gitpod/experimental/v1/user_pb';
import { getAgentSock, SSHError, testSSHConnection } from './sshTestConnection';
import { gatherIdentityFiles } from './ssh/identityFiles';
import { isWindows } from './common/platform';
import SSHDestination from './ssh/sshDestination';
import { NoRunningInstanceError, NoSSHGatewayError, SSHConnectionParams, SSH_DEST_KEY, getLocalSSHDomain } from './remote';
import { ISessionService } from './services/sessionService';
import { ILogService } from './services/logService';
import { IHostService } from './services/hostService';
import { Configuration } from './configuration';
import { getServiceURL } from './common/utils';
import { ILocalSSHService } from './services/localSSHService';

interface LocalAppConfig {
	gitpodHost: string;
	configFile: string;
	apiPort: number;
	pid: number;
	logPath: string;
}

interface Lock {
	pid?: number;
	value: string;
	deadline: number;
}

interface LocalAppInstallation {
	path: string;
	etag: string | null;
}

// TODO(ak) commands to show logs and stop local apps
// TODO(ak) auto stop local apps if not used for 3 hours

function throwIfCancelled(token?: vscode.CancellationToken): void {
	if (token?.isCancellationRequested) {
		throw new Error('cancelled');
	}
}

const lockPrefix = 'lock/';
const checkStaleInterval = 30000;
const installLockTimeout = 300000;
function isLock(lock: any): lock is Lock {
	return !!lock && typeof lock === 'object';
}

function checkRunning(pid: number): true | Error {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return e;
	}
}

class LocalAppError extends Error {
	constructor(cause: Error, readonly logPath?: string) {
		super();
		this.name = cause.name;
		this.message = cause.message;
		this.stack = cause.stack;
	}
}

export class RemoteConnector extends Disposable {

	public static AUTH_COMPLETE_PATH = '/auth-complete';
	private static LOCK_COUNT = 0;

	private usePublicApi: boolean = false;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly sessionService: ISessionService,
		private readonly hostService: IHostService,
		private readonly experiments: ExperimentalSettings,
		private readonly logService: ILogService,
		private readonly telemetryService: ITelemetryService,
		private readonly notificationService: INotificationService,
		private readonly localSSHService: ILocalSSHService,
	) {
		super();

		this.releaseStaleLocks();
	}

	private releaseStaleLocks(): void {
		const releaseLocks = () => {
			for (const key of this.context.globalState.keys()) {
				if (key.startsWith(lockPrefix)) {
					const lock = this.context.globalState.get(key);
					if (!isLock(lock) || Date.now() >= lock.deadline || (typeof lock.pid === 'number' && checkRunning(lock.pid) !== true)) {
						const lockName = key.slice(0, lockPrefix.length);
						this.logService.info(`cancel stale lock: ${lockName}`);
						this.context.globalState.update(key, undefined);
					}
				}
			}
		};

		releaseLocks();
		const releaseStaleLocksTimer = setInterval(releaseLocks, checkStaleInterval);
		this._register(new vscode.Disposable(() => clearInterval(releaseStaleLocksTimer)));
	}

	private async withLock<T>(lockName: string, op: (token: vscode.CancellationToken) => Promise<T>, timeout: number, token?: vscode.CancellationToken): Promise<T> {
		this.logService.info(`acquiring lock: ${lockName}`);
		const lockKey = lockPrefix + lockName;
		const value = vscode.env.sessionId + '/' + RemoteConnector.LOCK_COUNT++;
		let currentLock: Lock | undefined;
		let deadline: number | undefined;
		const updateTimeout = 150;
		while (currentLock?.value !== value) {
			currentLock = this.context.globalState.get<Lock>(lockKey);
			if (!currentLock) {
				deadline = Date.now() + timeout + updateTimeout * 2;
				await this.context.globalState.update(lockKey, <Lock>{ value, deadline, pid: process.pid });
			}
			// TODO(ak) env.globalState.onDidChange instead, see https://github.com/microsoft/vscode/issues/131182
			await new Promise(resolve => setTimeout(resolve, updateTimeout));
			currentLock = this.context.globalState.get<Lock>(lockKey);
		}
		this.logService.info(`acquired lock: ${lockName}`);
		const tokenSource = new vscode.CancellationTokenSource();
		token?.onCancellationRequested(() => tokenSource.cancel());
		let timer = setInterval(() => {
			currentLock = this.context.globalState.get<Lock>(lockKey);
			if (currentLock?.value !== value) {
				tokenSource.cancel();
			}
		}, updateTimeout);
		try {
			const result = await op(tokenSource.token);
			return result;
		} finally {
			if (timer) {
				clearTimeout(timer);
			}
			this.logService.info(`released lock: ${lockName}`);
			await this.context.globalState.update(lockKey, undefined);
		}
	}

	private downloadLocalApp(gitpodHost: string): Promise<Response> {
		let downloadUri = vscode.Uri.parse(gitpodHost);
		let arch = '';
		if (process.arch === 'arm64') {
			arch = '-arm64';
		} if (process.arch === 'x32' && process.platform === 'win32') {
			arch = '-386';
		}
		if (process.platform === 'win32') {
			downloadUri = downloadUri.with({
				path: `/static/bin/gitpod-local-companion-windows${arch}.exe`
			});
		} else if (process.platform === 'darwin') {
			downloadUri = downloadUri.with({
				path: `/static/bin/gitpod-local-companion-darwin${arch}`
			});
		} else {
			downloadUri = downloadUri.with({
				path: `/static/bin/gitpod-local-companion-linux${arch}`
			});
		}
		this.logService.info(`fetching the local app from ${downloadUri.toString()}`);
		return fetch(downloadUri.toString());
	}

	private async installLocalApp(download: Response, token: vscode.CancellationToken): Promise<LocalAppInstallation> {
		try {
			const fileExtension = process.platform === 'win32' ? '.exe' : undefined;
			const installationPath = await new Promise<string>((resolve, reject) =>
				tmp.file({ prefix: 'gitpod-local-companion', postfix: fileExtension, keep: true, discardDescriptor: true }, (err, path) => {
					if (err) {
						return reject(err);
					}
					return resolve(path);
				})
			);
			throwIfCancelled(token);
			this.logService.info(`installing the local app to ${installationPath}`);
			const installationStream = fs.createWriteStream(installationPath);
			const cancelInstallationListener = token.onCancellationRequested(() => installationStream.destroy(new Error('cancelled')));
			await new Promise((resolve, reject) => {
				(download.body as unknown as NodeJS.ReadableStream)!.pipe(installationStream)
					.on('error', reject)
					.on('finish', resolve);
			}).finally(() => {
				cancelInstallationListener.dispose();
				installationStream.destroy();
			});

			throwIfCancelled(token);
			if (process.platform !== 'win32') {
				await fs.promises.chmod(installationPath, '755');
				throwIfCancelled(token);
			}
			const installation: LocalAppInstallation = { path: installationPath, etag: download.headers.get('etag') };
			this.logService.info(`installing the local app: ${JSON.stringify(installation, undefined, 2)}`);
			return installation;
		} catch (e) {
			this.logService.error(`failed to install the local app: ${e}`);
			throw e;
		}
	}

	private async startLocalApp(gitpodHost: string, installation: LocalAppInstallation, token: vscode.CancellationToken): Promise<LocalAppConfig> {
		try {
			const [configFile, apiPort] = await Promise.all([new Promise<string>((resolve, reject) =>
				tmp.file({ prefix: 'gitpod_ssh_config', keep: true, discardDescriptor: true }, (err, path) => {
					if (err) {
						return reject(err);
					}
					return resolve(path);
				})
			), new Promise<number>(resolve => {
				const server = http.createServer();
				server.listen(0, 'localhost', () => {
					resolve((server.address() as net.AddressInfo).port);
					server.close();
				});
			})]);
			throwIfCancelled(token);
			this.logService.info(`starting the local app with the config: ${JSON.stringify({ gitpodHost, configFile: vscode.Uri.file(configFile).toString(), apiPort }, undefined, 2)}`);

			const parsed = path.parse(installation.path);
			const logPath = path.join(parsed.dir, parsed.name) + '.log';
			const logStream = fs.createWriteStream(logPath);
			const cancelLogStreamListener = token.onCancellationRequested(() => logStream.destroy(new Error('cancelled')));
			await new Promise((resolve, reject) => {
				logStream.on('error', reject);
				logStream.on('open', resolve);
			}).finally(() => {
				cancelLogStreamListener.dispose();
			});

			const localAppProcess = cp.spawn(installation.path, {
				detached: true,
				stdio: ['ignore', logStream, logStream],
				env: {
					...process.env,
					GITPOD_HOST: gitpodHost,
					GITPOD_LCA_SSH_CONFIG: configFile,
					GITPOD_LCA_API_PORT: String(apiPort),
					GITPOD_LCA_AUTO_TUNNEL: String(false),
					GITPOD_LCA_AUTH_REDIRECT_URL: `${vscode.env.uriScheme}://${this.context.extension.id}${RemoteConnector.AUTH_COMPLETE_PATH}`,
					GITPOD_LCA_VERBOSE: String(vscode.workspace.getConfiguration('gitpod').get<boolean>('verbose', false)),
					GITPOD_LCA_TIMEOUT: String(vscode.workspace.getConfiguration('gitpod').get<string>('timeout', '3h'))
				}
			});
			localAppProcess.unref();
			const cancelLocalAppProcessListener = token.onCancellationRequested(() => localAppProcess.kill());
			const pid = await new Promise<number>((resolve, reject) => {
				localAppProcess.on('error', reject);
				localAppProcess.on('exit', code => reject(new Error('unexpectedly exit with code: ' + code)));
				localAppProcess.on('spawn', () => resolve(localAppProcess.pid!));
			}).finally(() => {
				cancelLocalAppProcessListener.dispose();
			});

			this.logService.info(`the local app has been stared: ${JSON.stringify({ pid, log: vscode.Uri.file(logPath).toString() }, undefined, 2)}`);
			return { gitpodHost, configFile, apiPort, pid, logPath };
		} catch (e) {
			this.logService.error(`failed to start the local app: ${e}`);
			throw e;
		}
	}

	/**
	 * Important: it should not call the local app to manage in 30sec
	 */
	private async ensureLocalApp(gitpodHost: string, configKey: string, installationKey: string, token: vscode.CancellationToken): Promise<LocalAppConfig> {
		let config = this.context.globalState.get<LocalAppConfig>(configKey);
		let installation = this.context.globalState.get<LocalAppInstallation>(installationKey);

		if (config && checkRunning(config?.pid) !== true) {
			config = undefined;
		}

		const gitpodConfig = vscode.workspace.getConfiguration('gitpod');
		const configuredInstallationPath = gitpodConfig.get<string>('installationPath');
		if (configuredInstallationPath) {
			if (installation && installation.path !== configuredInstallationPath) {
				this.logService.info(`the local app is different from configured, switching: ${JSON.stringify({ installed: installation.path, configured: configuredInstallationPath }, undefined, 2)}`);
				installation = undefined;
				if (config) {
					try {
						process.kill(config.pid);
					} catch (e) {
						this.logService.error(`failed to kill the outdated local app (pid: ${config.pid}): ${e}`);
					}
				}
				config = undefined;
			}
			if (config) {
				return config;
			}
			await fs.promises.access(configuredInstallationPath, fs.constants.X_OK);
			throwIfCancelled(token);
			installation = { path: configuredInstallationPath, etag: null };
			await this.context.globalState.update(installationKey, installation);
			throwIfCancelled(token);
		} else {
			let download: Response | Error;
			try {
				download = await this.downloadLocalApp(gitpodHost);
				throwIfCancelled(token);
				if (!download.ok) {
					download = new Error(`unexpected download response ${download.statusText} (${download.status})`);
				}
			} catch (e) {
				download = e;
			}
			if (installation) {
				const upgrade = !(download instanceof Error) && { etag: download.headers.get('etag'), url: download.url };
				if (upgrade && upgrade.etag && upgrade.etag !== installation.etag) {
					this.logService.info(`the local app is outdated, upgrading: ${JSON.stringify({ installation, upgrade }, undefined, 2)}`);
					installation = undefined;
					if (config) {
						try {
							process.kill(config.pid);
						} catch (e) {
							this.logService.error(`failed to kill the outdated local app (pid: ${config.pid}): ${e}`);
						}
					}
					config = undefined;
				}
			}
			if (config) {
				return config;
			}
			if (installation) {
				try {
					await fs.promises.access(installation.path, fs.constants.X_OK);
				} catch {
					installation = undefined;
				}
				throwIfCancelled(token);
			}
			if (!installation) {
				if (download instanceof Error) {
					throw download;
				}
				installation = await this.installLocalApp(download, token);
				await this.context.globalState.update(installationKey, installation);
				throwIfCancelled(token);
			}
		}
		config = await this.startLocalApp(gitpodHost, installation, token);
		await this.context.globalState.update(configKey, config);
		throwIfCancelled(token);
		return config;
	}

	private async withLocalApp<T>(gitpodHost: string, op: (client: LocalAppClient, config: LocalAppConfig) => Promise<T>, token?: vscode.CancellationToken): Promise<T> {
		const gitpodAuthority = vscode.Uri.parse(gitpodHost).authority;
		const configKey = 'config/' + gitpodAuthority;
		const installationKey = 'installation/' + gitpodAuthority;
		const config = await this.withLock(gitpodAuthority, token =>
			this.ensureLocalApp(gitpodHost, configKey, installationKey, token)
			, installLockTimeout, token);
		throwIfCancelled(token);
		while (true) {
			const client = new LocalAppClient('http://localhost:' + config.apiPort, { transport: NodeHttpTransport() });
			try {
				const result = await op(client, config);
				throwIfCancelled(token);
				return result;
			} catch (e) {
				throwIfCancelled(token);
				const running = checkRunning(config.pid);
				if (running === true && (e.code === grpc.Code.Unavailable || e.code === grpc.Code.Unknown)) {
					this.logService.info(`the local app (pid: ${config.pid}) is running, but the api endpoint is not ready: ${e}`);
					this.logService.info(`retying again after 1s delay...`);
					await new Promise(resolve => setTimeout(resolve, 1000));
					throwIfCancelled(token);
					continue;
				}
				if (running !== true) {
					this.logService.info(`the local app (pid: ${config.pid}) is not running: ${running}`);
				}
				this.logService.error(`failed to access the local app: ${e}`);
				throw e;
			}
		}
	}

	private async getWorkspaceSSHDestination({ workspaceId, gitpodHost, debugWorkspace }: SSHConnectionParams): Promise<{ destination: SSHDestination; password?: string }> {
		const sshKeysSupported = this.sessionService.getScopes().includes(ScopeFeature.SSHPublicKeys);

		const [workspaceInfo, ownerToken, registeredSSHKeys] = await withServerApi(this.sessionService.getGitpodToken(), getServiceURL(gitpodHost), service => Promise.all([
			this.usePublicApi ? this.sessionService.getAPI().getWorkspace(workspaceId) : service.server.getWorkspace(workspaceId),
			this.usePublicApi ? this.sessionService.getAPI().getOwnerToken(workspaceId) : service.server.getOwnerToken(workspaceId),
			sshKeysSupported ? (this.usePublicApi ? this.sessionService.getAPI().getSSHKeys() : service.server.getSSHPublicKeys()) : undefined
		]), this.logService);

		const isNotRunning = this.usePublicApi
			? !((workspaceInfo as Workspace)?.status?.instance) || (workspaceInfo as Workspace)?.status?.instance?.status?.phase === WorkspaceInstanceStatus_Phase.STOPPING || (workspaceInfo as Workspace)?.status?.instance?.status?.phase === WorkspaceInstanceStatus_Phase.STOPPED
			: !((workspaceInfo as WorkspaceInfo).latestInstance) || (workspaceInfo as WorkspaceInfo).latestInstance?.status?.phase === 'stopping' || (workspaceInfo as WorkspaceInfo).latestInstance?.status?.phase === 'stopped';
		if (isNotRunning) {
			throw new NoRunningInstanceError(
				workspaceId,
				this.usePublicApi
					? (workspaceInfo as Workspace)?.status?.instance?.status?.phase ? WorkspaceInstanceStatus_Phase[(workspaceInfo as Workspace)?.status?.instance?.status?.phase!] : undefined
					: (workspaceInfo as WorkspaceInfo).latestInstance?.status?.phase
			);
		}

		const workspaceUrl = this.usePublicApi
			? new URL((workspaceInfo as Workspace).status!.instance!.status!.url)
			: new URL((workspaceInfo as WorkspaceInfo).latestInstance!.ideUrl);

		const sshHostKeyEndPoint = `https://${workspaceUrl.host}/_ssh/host_keys`;
		const sshHostKeyResponse = await fetch(sshHostKeyEndPoint);
		if (!sshHostKeyResponse.ok) {
			// Gitpod SSH gateway not configured
			throw new NoSSHGatewayError(gitpodHost);
		}

		const sshHostKeys = (await sshHostKeyResponse.json()) as { type: string; host_key: string }[];
		let user = workspaceId;
		// See https://github.com/gitpod-io/gitpod/pull/9786 for reasoning about `.ssh` suffix
		let hostname = workspaceUrl.host.replace(workspaceId, `${workspaceId}.ssh`);
		if (debugWorkspace) {
			user = 'debug-' + workspaceId;
			hostname = hostname.replace(workspaceId, user);
		}

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

		if (registeredSSHKeys) {
			const registeredKeys = this.usePublicApi
				? (registeredSSHKeys as SSHKey[]).map(k => {
					const parsedResult = sshUtils.parseKey(k.key);
					if (parsedResult instanceof Error || !parsedResult) {
						this.logService.error(`Error while parsing SSH public key ${k.name}:`, parsedResult);
						return { name: k.name, fingerprint: '' };
					}

					const parsedKey = parsedResult as ParsedKey;
					return { name: k.name, fingerprint: crypto.createHash('sha256').update(parsedKey.getPublicSSH()).digest('base64') };
				})
				: (registeredSSHKeys as UserSSHPublicKeyValue[]).map(k => ({ name: k.name, fingerprint: k.fingerprint }));
			this.logService.trace(`Registered public keys in Gitpod account:`, registeredKeys.length ? registeredKeys.map(k => `${k.name} SHA256:${k.fingerprint}`).join('\n') : 'None');

			identityKeys = identityKeys.filter(k => !!registeredKeys.find(regKey => regKey.fingerprint === k.fingerprint));
		} else {
			if (identityKeys.length) {
				user = `${user}#${ownerToken}`;
			}
			const gitpodVersion = await this.hostService.getVersion();
			this.logService.warn(`Registered SSH public keys not supported in ${gitpodHost}, using version ${gitpodVersion.raw}`);
		}

		return {
			destination: new SSHDestination(hostname, user),
			password: identityKeys.length === 0 ? ownerToken : undefined
		};
	}

	private async getLocalSSHWorkspaceSSHDestination({ workspaceId, gitpodHost, debugWorkspace }: SSHConnectionParams): Promise<{ destination: SSHDestination; password?: string }> {
		const workspaceInfo = await withServerApi(this.sessionService.getGitpodToken(), getServiceURL(gitpodHost), async service => this.usePublicApi ? this.sessionService.getAPI().getWorkspace(workspaceId) : service.server.getWorkspace(workspaceId), this.logService);

		const isNotRunning = this.usePublicApi
			? !((workspaceInfo as Workspace)?.status?.instance) || (workspaceInfo as Workspace)?.status?.instance?.status?.phase === WorkspaceInstanceStatus_Phase.STOPPING || (workspaceInfo as Workspace)?.status?.instance?.status?.phase === WorkspaceInstanceStatus_Phase.STOPPED
			: !((workspaceInfo as WorkspaceInfo).latestInstance) || (workspaceInfo as WorkspaceInfo).latestInstance?.status?.phase === 'stopping' || (workspaceInfo as WorkspaceInfo).latestInstance?.status?.phase === 'stopped';

		if (isNotRunning) {
			throw new NoRunningInstanceError(
				workspaceId,
				this.usePublicApi
					? (workspaceInfo as Workspace)?.status?.instance?.status?.phase ? WorkspaceInstanceStatus_Phase[(workspaceInfo as Workspace)?.status?.instance?.status?.phase!] : undefined
					: (workspaceInfo as WorkspaceInfo).latestInstance?.status?.phase
			);
		}

		const domain = getLocalSSHDomain(gitpodHost);
		const hostname = `${workspaceId}.${domain}`;

		const user = debugWorkspace ? ('debug-' + workspaceId) : workspaceId;
		this.logService.info('connecting with local ssh destination', { domain });
		return {
			destination: new SSHDestination(hostname, user),
			password: '',
		};
	}

	private async getWorkspaceLocalAppSSHDestination(params: SSHConnectionParams): Promise<{ destination: SSHDestination; localAppSSHConfigPath: string }> {
		return vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			cancellable: true,
			title: `Connecting to ${params.workspaceId} Gitpod workspace`
		}, async (_, token) => {
			let localAppLogPath: string | undefined;
			try {
				const connection = await this.withLocalApp(params.gitpodHost, (client, config) => {
					localAppLogPath = config.logPath;

					const request = new ResolveSSHConnectionRequest();
					request.setInstanceId(params.instanceId);
					request.setWorkspaceId(params.workspaceId);
					return new Promise<ResolveSSHConnectionResponse>((resolve, reject) =>
						client.resolveSSHConnection(request, (e, r) => r ? resolve(r) : reject(e))
					);
				}, token);

				return {
					destination: new SSHDestination(connection.getHost()),
					localAppSSHConfigPath: connection.getConfigFile()
				};
			} catch (e) {
				if (e instanceof Error && e.message === 'cancelled') {
					throw e;
				}

				throw new LocalAppError(e, localAppLogPath);
			}
		});
	}

	private async updateRemoteSSHConfig(usingSSHGateway: boolean, localAppSSHConfigPath: string | undefined) {
		const remoteSSHconfig = vscode.workspace.getConfiguration('remote.SSH');
		const defaultExtConfigInfo = remoteSSHconfig.inspect<string[]>('defaultExtensions');
		const defaultExtensions = defaultExtConfigInfo?.globalValue ?? [];
		if (!defaultExtensions.includes('gitpod.gitpod-remote-ssh')) {
			defaultExtensions.unshift('gitpod.gitpod-remote-ssh');
			await remoteSSHconfig.update('defaultExtensions', defaultExtensions, vscode.ConfigurationTarget.Global);
		}

		const currentConfigFile = remoteSSHconfig.get<string>('configFile');
		if (usingSSHGateway) {
			if (currentConfigFile?.includes('gitpod_ssh_config')) {
				await remoteSSHconfig.update('configFile', undefined, vscode.ConfigurationTarget.Global);
			}
		} else {
			// TODO(ak) notify a user about config file changes?
			if (currentConfigFile === localAppSSHConfigPath) {
				// invalidate cached SSH targets from the current config file
				await remoteSSHconfig.update('configFile', undefined, vscode.ConfigurationTarget.Global);
			}
			await remoteSSHconfig.update('configFile', localAppSSHConfigPath, vscode.ConfigurationTarget.Global);
		}
	}

	private async ensureRemoteSSHExtInstalled(flow: UserFlowTelemetry): Promise<boolean> {
		const msVscodeRemoteExt = vscode.extensions.getExtension('ms-vscode-remote.remote-ssh');
		if (msVscodeRemoteExt) {
			return true;
		}

		const install = 'Install';
		const cancel = 'Cancel';

		const action = await this.notificationService.showInformationMessage('Please install "Remote - SSH" extension to connect to a Gitpod workspace.', { id: 'install_remote_ssh', flow }, install, cancel);
		if (action === cancel) {
			return false;
		}

		this.logService.info('Installing "ms-vscode-remote.remote-ssh" extension');

		await vscode.commands.executeCommand('extension.open', 'ms-vscode-remote.remote-ssh');
		await vscode.commands.executeCommand('workbench.extensions.installExtension', 'ms-vscode-remote.remote-ssh');

		return true;
	}

	private async showSSHPasswordModal(password: string, flow: UserFlowTelemetry) {
		const maskedPassword = '•'.repeat(password.length - 3) + password.substring(password.length - 3);

		const sshKeysSupported = this.sessionService.getScopes().includes(ScopeFeature.SSHPublicKeys);

		const copy: vscode.MessageItem = { title: 'Copy' };
		const configureSSH: vscode.MessageItem = { title: 'Configure SSH' };
		const showLogs: vscode.MessageItem = { title: 'Show logs', isCloseAffordance: true };
		const message = sshKeysSupported
			? `You don't have registered any SSH public key for this machine in your Gitpod account.\nAlternatively, copy and use this temporary password until workspace restart: ${maskedPassword}`
			: `An SSH key is required for passwordless authentication.\nAlternatively, copy and use this password: ${maskedPassword}`;
		const action = await this.notificationService.showWarningMessage(message, { flow, modal: true, id: 'ssh_gateway_modal' }, copy, configureSSH, showLogs);

		if (action === copy) {
			await vscode.env.clipboard.writeText(password);
			return;
		}

		const serviceUrl = getServiceURL(flow.gitpodHost!);
		const externalUrl = sshKeysSupported ? `${serviceUrl}/keys` : 'https://www.gitpod.io/docs/configure/ssh#create-an-ssh-key';
		if (action === configureSSH) {
			await vscode.env.openExternal(vscode.Uri.parse(externalUrl));
			throw new Error(`SSH password modal dialog, Configure SSH`);
		}

		const logMessage = sshKeysSupported
			? `Configure your SSH keys in ${externalUrl} and try again. Or try again and select 'Copy' to connect using a temporary password until workspace restart`
			: `Create an SSH key (${externalUrl}) and try again. Or try again and select 'Copy' to connect using a temporary password until workspace restart`;
		this.logService.info(logMessage);
		this.logService.show();
		throw new Error('SSH password modal dialog, Canceled');
	}

	public async handleUri(uri: vscode.Uri) {
		if (uri.path === RemoteConnector.AUTH_COMPLETE_PATH) {
			this.logService.info('auth completed');
			return;
		}

		const params: SSHConnectionParams = JSON.parse(uri.query);
		const sshFlow: UserFlowTelemetry = { ...params, flow: 'ssh' };
		const isRemoteSSHExtInstalled = await this.ensureRemoteSSHExtInstalled(sshFlow);
		if (!isRemoteSSHExtInstalled) {
			return;
		}

		await this.sessionService.signIn(params.gitpodHost);
		if (!this.sessionService.isSignedIn()) {
			return;
		}

		sshFlow.userId = this.sessionService.getUserId();
		sshFlow.gitpodVersion = (await this.hostService.getVersion()).raw;

		this.logService.info('Opening Gitpod workspace', uri.toString());

		const sshDestination = await vscode.window.withProgress(
			{
				title: `Connecting to ${params.workspaceId}`,
				location: vscode.ProgressLocation.Notification
			},
			async () => {
				this.usePublicApi = await this.experiments.getUsePublicAPI(params.gitpodHost);
				this.logService.info(`Going to use ${this.usePublicApi ? 'public' : 'server'} API`);

				let useLocalSSH = await this.experiments.getUseLocalSSHProxy();
				if (useLocalSSH) {
					// we need to update the remote ssh config first, since another call is too late for local-ssh
					await this.updateRemoteSSHConfig(true, undefined);
					this.localSSHService.flow = sshFlow;
					await this.localSSHService.initialized;
					if (!this.localSSHService.isSupportLocalSSH) {
						this.logService.error('Local SSH is not supported on this platform');
						useLocalSSH = false;
					}
				}
				if (useLocalSSH) {
					this.logService.info('Going to use lssh');
				}

				const forceUseLocalApp = Configuration.getUseLocalApp();
				const userOverride = String(isUserOverrideSetting('gitpod.remote.useLocalApp'));
				let sshDestination: SSHDestination | undefined;
				if (!forceUseLocalApp) {
					const openSSHVersion = await getOpenSSHVersion();
					const gatewayFlow: UserFlowTelemetry = { kind: useLocalSSH ? 'local-ssh' : 'gateway', openSSHVersion, userOverride, ...sshFlow };
					try {
						this.telemetryService.sendUserFlowStatus('connecting', gatewayFlow);

						const { destination, password } = useLocalSSH ? await this.getLocalSSHWorkspaceSSHDestination(params) : await this.getWorkspaceSSHDestination(params);
						params.connType = useLocalSSH ? 'local-ssh' : 'ssh-gateway';

						sshDestination = destination;

						Object.assign(gatewayFlow, { auth: password ? 'password' : 'key' });

						if (password) {
							await this.showSSHPasswordModal(password, gatewayFlow);
						}

						this.telemetryService.sendUserFlowStatus('connected', gatewayFlow);
					} catch (e) {
						this.telemetryService.sendUserFlowStatus('failed', { ...gatewayFlow, reason: e.toString() });
						if (e instanceof NoSSHGatewayError) {
							this.logService.error('No SSH gateway:', e);
							const ok = 'OK';
							await this.notificationService.showWarningMessage(`${e.host} does not support [direct SSH access](https://github.com/gitpod-io/gitpod/blob/main/install/installer/docs/workspace-ssh-access.md), connecting via the deprecated SSH tunnel over WebSocket.`, { flow: gatewayFlow, id: 'no_ssh_gateway' }, ok);
							// Do nothing and continue execution
						} else if (e instanceof SSHError && e.message === 'Timed out while waiting for handshake') {
							this.logService.error('SSH test connection error:', e);
							const ok = 'OK';
							await this.notificationService.showWarningMessage(`Timed out while waiting for the SSH handshake. It's possible, that SSH connections on port 22 are blocked, or your network is too slow. Connecting via the deprecated SSH tunnel over WebSocket instead.`, { flow: gatewayFlow, id: 'ssh_timeout' }, ok);
							// Do nothing and continue execution
						} else if (e instanceof NoRunningInstanceError) {
							this.logService.error('No Running instance:', e);
							gatewayFlow['phase'] = e.phase;
							this.notificationService.showErrorMessage(`Failed to connect to ${e.workspaceId} Gitpod workspace: workspace not running`, { flow: gatewayFlow, id: 'no_running_instance' });
							return undefined;
						} else {
							if (e instanceof SSHError) {
								this.logService.error('SSH test connection error:', e);
							} else {
								this.logService.error(`Failed to connect to ${params.workspaceId} Gitpod workspace:`, e);
							}
							const seeLogs = 'See Logs';
							const showTroubleshooting = 'Show Troubleshooting';
							this.notificationService.showErrorMessage(`Failed to connect to ${params.workspaceId} Gitpod workspace`, { flow: gatewayFlow, id: 'failed_to_connect' }, seeLogs, showTroubleshooting)
								.then(action => {
									if (action === seeLogs) {
										this.logService.show();
									} else if (action === showTroubleshooting) {
										vscode.env.openExternal(vscode.Uri.parse('https://www.gitpod.io/docs/ides-and-editors/vscode#connecting-to-vs-code-desktop-ssh'));
									}
								});
							return undefined;
						}
					}
				}

				const usingSSHGateway = !!sshDestination;
				let localAppSSHConfigPath: string | undefined;
				if (!usingSSHGateway && !params.debugWorkspace) {
					// debug workspace does not support local app mode
					const localAppFlow = { kind: 'local-app', userOverride, ...sshFlow };
					try {
						this.telemetryService.sendUserFlowStatus('connecting', localAppFlow);

						const localAppDestData = await this.getWorkspaceLocalAppSSHDestination(params);
						params.connType = 'local-app';
						sshDestination = localAppDestData.destination;
						localAppSSHConfigPath = localAppDestData.localAppSSHConfigPath;

						this.telemetryService.sendUserFlowStatus('connected', localAppFlow);
					} catch (e) {
						this.telemetryService.sendUserFlowStatus('failed', { reason: e.toString(), ...localAppFlow });
						this.logService.error(`Failed to connect ${params.workspaceId} Gitpod workspace:`, e);
						if (e instanceof LocalAppError) {
							const seeLogs = 'See Logs';
							const showTroubleshooting = 'Show Troubleshooting';
							this.notificationService.showErrorMessage(`Failed to connect to ${params.workspaceId} Gitpod workspace`, { flow: localAppFlow, id: 'failed_to_connect' }, seeLogs, showTroubleshooting)
								.then(action => {
									if (action === seeLogs) {
										this.logService.show();
										if (e.logPath) {
											vscode.workspace.openTextDocument(vscode.Uri.file(e.logPath)).then(d => vscode.window.showTextDocument(d));
										}
									} else if (action === showTroubleshooting) {
										vscode.env.openExternal(vscode.Uri.parse('https://www.gitpod.io/docs/ides-and-editors/vscode#connecting-to-vs-code-desktop-ssh'));
									}
								});
						} else {
							// Do nothing, user cancelled the operation
						}
						return undefined;
					}
				}

				await this.updateRemoteSSHConfig(usingSSHGateway, localAppSSHConfigPath);

				await this.context.globalState.update(`${SSH_DEST_KEY}${sshDestination!.toRemoteSSHString()}`, { ...params } as SSHConnectionParams);

				// Force Linux as host platform (https://github.com/gitpod-io/gitpod/issues/16058)
				if (isWindows) {
					const existingSSHHostPlatforms = vscode.workspace.getConfiguration('remote.SSH').get<{ [host: string]: string }>('remotePlatform', {});
					if (!existingSSHHostPlatforms[sshDestination!.hostname]) {
						await vscode.workspace.getConfiguration('remote.SSH').update('remotePlatform', { ...existingSSHHostPlatforms, [sshDestination!.hostname]: 'linux' }, vscode.ConfigurationTarget.Global);
					}
				}

				return sshDestination;
			}
		);

		if (!sshDestination) {
			return;
		}

		const forceNewWindow = this.context.extensionMode === vscode.ExtensionMode.Production
			&& (!!vscode.env.remoteName || !!vscode.workspace.workspaceFile || !!vscode.workspace.workspaceFolders || !!vscode.window.visibleTextEditors.length || !!vscode.window.visibleNotebookEditors.length);
		vscode.commands.executeCommand(
			'vscode.openFolder',
			vscode.Uri.parse(`vscode-remote://ssh-remote+${sshDestination.toRemoteSSHString()}${uri.path || '/'}`),
			{ forceNewWindow }
		);
	}

	public async autoTunnelCommand(gitpodHost: string, instanceId: string, enabled: boolean) {
		if (this.sessionService.isSignedIn()) {
			const forceUseLocalApp = Configuration.getUseLocalApp();
			if (!forceUseLocalApp) {
				const authority = vscode.Uri.parse(gitpodHost).authority;
				const configKey = `config/${authority}`;
				const localAppconfig = this.context.globalState.get<LocalAppConfig>(configKey);
				if (!localAppconfig || checkRunning(localAppconfig.pid) !== true) {
					// Do nothing if we are using SSH gateway and local app is not running
					return;
				}
			}
		}

		try {
			await this.withLocalApp(gitpodHost, client => {
				const request = new AutoTunnelRequest();
				request.setInstanceId(instanceId);
				request.setEnabled(enabled);
				return new Promise<void>((resolve, reject) =>
					client.autoTunnel(request, (e, r) => r ? resolve(undefined) : reject(e))
				);
			});
		} catch (e) {
			this.logService.error('Failed to disable auto tunneling:', e);
		}
	}
}
