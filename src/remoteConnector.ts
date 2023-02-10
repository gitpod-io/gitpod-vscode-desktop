/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { v4 as uuid } from 'uuid';
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
import TelemetryReporter from './telemetryReporter';
import { addHostToHostFile, checkNewHostInHostkeys } from './ssh/hostfile';
import { HeartbeatManager } from './heartbeat';
import { getGitpodVersion, isFeatureSupported, isOauthInspectSupported, ScopeFeature } from './featureSupport';
import SSHConfiguration from './ssh/sshConfig';
import { ExperimentalSettings, isUserOverrideSetting } from './experiments';
import { ISyncExtension, NoSettingsSyncSession, NoSyncStoreError, parseSyncData, SettingsSync, SyncResource } from './settingsSync';
import { retry } from './common/async';
import { getOpenSSHVersion } from './ssh/sshVersion';
import { NotificationService } from './notification';
import { UserFlowTelemetry } from './common/telemetry';
import { GitpodPublicApi } from './publicApi';
import { SSHKey } from '@gitpod/public-api/lib/gitpod/experimental/v1/user_pb';
import { getAgentSock, SSHError, testSSHConnection } from './sshTestConnection';
import { gatherIdentityFiles } from './ssh/identityFiles';
import { isWindows } from './common/platform';
import SSHDestination from './ssh/sshDestination';
import { WorkspaceState } from './workspaceState';

interface SSHConnectionParams {
	workspaceId: string;
	instanceId: string;
	gitpodHost: string;
	debugWorkspace?: boolean;
}

interface SSHConnectionInfo extends SSHConnectionParams {
	isFirstConnection: boolean;
}

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

class NoRunningInstanceError extends Error {
	constructor(readonly workspaceId: string) {
		super(`Failed to connect to ${workspaceId} Gitpod workspace, workspace not running`);
	}
}

class NoSSHGatewayError extends Error {
	constructor(readonly host: string) {
		super(`SSH gateway not configured for this Gitpod Host ${host}`);
	}
}

export default class RemoteConnector extends Disposable {

	public static SSH_DEST_KEY = 'ssh-dest:';
	public static AUTH_COMPLETE_PATH = '/auth-complete';
	private static LOCK_COUNT = 0;

	private heartbeatManager: HeartbeatManager | undefined;
	private workspaceState: WorkspaceState | undefined;

	private publicApi: GitpodPublicApi | undefined;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly settingsSync: SettingsSync,
		private readonly experiments: ExperimentalSettings,
		private readonly logger: vscode.LogOutputChannel,
		private readonly telemetry: TelemetryReporter,
		private readonly notifications: NotificationService
	) {
		super();

		if (isGitpodRemoteWindow(context)) {
			context.subscriptions.push(vscode.commands.registerCommand('gitpod.api.autoTunnel', this.autoTunnelCommand, this));

			// Don't await this on purpose so it doesn't block extension activation.
			// Internally requesting a Gitpod Session requires the extension to be already activated.
			this.onGitpodRemoteConnection();
		}

		this.releaseStaleLocks();
	}

	private async initPublicApi(session: vscode.AuthenticationSession, gitpodHost: string) {
		if (this.publicApi) {
			return;
		}

		const usePublicApi = await this.experiments.getRaw<boolean>('gitpod_experimental_publicApi', session.account.id, { gitpodHost });
		this.logger.info(`Going to use ${usePublicApi ? 'public' : 'server'} API`);
		if (usePublicApi) {
			this.publicApi = new GitpodPublicApi(session.accessToken, gitpodHost, this.logger);
		}
	}

	private releaseStaleLocks(): void {
		const releaseLocks = () => {
			for (const key of this.context.globalState.keys()) {
				if (key.startsWith(lockPrefix)) {
					const lock = this.context.globalState.get(key);
					if (!isLock(lock) || Date.now() >= lock.deadline || (typeof lock.pid === 'number' && checkRunning(lock.pid) !== true)) {
						const lockName = key.slice(0, lockPrefix.length);
						this.logger.info(`cancel stale lock: ${lockName}`);
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
		this.logger.info(`acquiring lock: ${lockName}`);
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
			// TODO(ak) env.globaState.onDidChange instead, see https://github.com/microsoft/vscode/issues/131182
			await new Promise(resolve => setTimeout(resolve, updateTimeout));
			currentLock = this.context.globalState.get<Lock>(lockKey);
		}
		this.logger.info(`acquired lock: ${lockName}`);
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
			this.logger.info(`released lock: ${lockName}`);
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
		this.logger.info(`fetching the local app from ${downloadUri.toString()}`);
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
			this.logger.info(`installing the local app to ${installationPath}`);
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
			this.logger.info(`installing the local app: ${JSON.stringify(installation, undefined, 2)}`);
			return installation;
		} catch (e) {
			this.logger.error(`failed to install the local app: ${e}`);
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
			this.logger.info(`starting the local app with the config: ${JSON.stringify({ gitpodHost, configFile: vscode.Uri.file(configFile).toString(), apiPort }, undefined, 2)}`);

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

			this.logger.info(`the local app has been stared: ${JSON.stringify({ pid, log: vscode.Uri.file(logPath).toString() }, undefined, 2)}`);
			return { gitpodHost, configFile, apiPort, pid, logPath };
		} catch (e) {
			this.logger.error(`failed to start the local app: ${e}`);
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
				this.logger.info(`the local app is different from configured, switching: ${JSON.stringify({ installed: installation.path, configured: configuredInstallationPath }, undefined, 2)}`);
				installation = undefined;
				if (config) {
					try {
						process.kill(config.pid);
					} catch (e) {
						this.logger.error(`failed to kill the outdated local app (pid: ${config.pid}): ${e}`);
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
					this.logger.info(`the local app is outdated, upgrading: ${JSON.stringify({ installation, upgrade }, undefined, 2)}`);
					installation = undefined;
					if (config) {
						try {
							process.kill(config.pid);
						} catch (e) {
							this.logger.error(`failed to kill the outdated local app (pid: ${config.pid}): ${e}`);
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
					this.logger.info(`the local app (pid: ${config.pid}) is running, but the api endpoint is not ready: ${e}`);
					this.logger.info(`retying again after 1s delay...`);
					await new Promise(resolve => setTimeout(resolve, 1000));
					throwIfCancelled(token);
					continue;
				}
				if (running !== true) {
					this.logger.info(`the local app (pid: ${config.pid}) is not running: ${running}`);
				}
				this.logger.error(`failed to access the local app: ${e}`);
				throw e;
			}
		}
	}

	private async getWorkspaceSSHDestination(session: vscode.AuthenticationSession, { workspaceId, gitpodHost, debugWorkspace }: SSHConnectionParams): Promise<{ destination: SSHDestination; password?: string }> {
		const sshKeysSupported = session.scopes.includes(ScopeFeature.SSHPublicKeys);

		const [workspaceInfo, ownerToken, registeredSSHKeys] = await withServerApi(session.accessToken, getServiceURL(gitpodHost), service => Promise.all([
			this.publicApi ? this.publicApi.getWorkspace(workspaceId) : service.server.getWorkspace(workspaceId),
			this.publicApi ? this.publicApi.getOwnerToken(workspaceId) : service.server.getOwnerToken(workspaceId),
			sshKeysSupported ? (this.publicApi ? this.publicApi.getSSHKeys() : service.server.getSSHPublicKeys()) : undefined
		]), this.logger);

		const isRunning = this.publicApi
			? (workspaceInfo as Workspace)?.status?.instance?.status?.phase === WorkspaceInstanceStatus_Phase.RUNNING
			: (workspaceInfo as WorkspaceInfo).latestInstance?.status?.phase === 'running';
		if (!isRunning) {
			throw new NoRunningInstanceError(workspaceId);
		}

		const workspaceUrl = this.publicApi
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
		}, sshHostKeys, sshConfiguration, this.logger);

		// SSH connection successful, write host to known_hosts
		try {
			const result = sshUtils.parseKey(verifiedHostKey!);
			if (result instanceof Error) {
				throw result;
			}
			const parseKey = Array.isArray(result) ? result[0] : result;
			if (parseKey && await checkNewHostInHostkeys(hostname)) {
				await addHostToHostFile(hostname, verifiedHostKey!, parseKey.type);
				this.logger.info(`'${hostname}' host added to known_hosts file`);
			}
		} catch (e) {
			this.logger.error(`Couldn't write '${hostname}' host to known_hosts file:`, e);
		}

		const hostConfiguration = sshConfiguration.getHostConfiguration(hostname);
		let identityKeys = await gatherIdentityFiles([], getAgentSock(hostConfiguration), false, this.logger);

		if (registeredSSHKeys) {
			const registeredKeys = this.publicApi
				? (registeredSSHKeys as SSHKey[]).map(k => {
					const parsedResult = sshUtils.parseKey(k.key);
					if (parsedResult instanceof Error || !parsedResult) {
						this.logger.error(`Error while parsing SSH public key ${k.name}:`, parsedResult);
						return { name: k.name, fingerprint: '' };
					}

					const parsedKey = parsedResult as ParsedKey;
					return { name: k.name, fingerprint: crypto.createHash('sha256').update(parsedKey.getPublicSSH()).digest('base64') };
				})
				: (registeredSSHKeys as UserSSHPublicKeyValue[]).map(k => ({ name: k.name, fingerprint: k.fingerprint }));
			this.logger.trace(`Registered public keys in Gitpod account:`, registeredKeys.length ? registeredKeys.map(k => `${k.name} SHA256:${k.fingerprint}`).join('\n') : 'None');

			identityKeys = identityKeys.filter(k => !!registeredKeys.find(regKey => regKey.fingerprint === k.fingerprint));
		} else {
			if (identityKeys.length) {
				user = `${user}#${ownerToken}`;
			}
			const gitpodVersion = await getGitpodVersion(gitpodHost, this.logger);
			this.logger.warn(`Registered SSH public keys not supported in ${gitpodHost}, using version ${gitpodVersion.raw}`);
		}

		return {
			destination: new SSHDestination(hostname, user),
			password: identityKeys.length === 0 ? ownerToken : undefined
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

		const action = await this.notifications.showInformationMessage('Please install "Remote - SSH" extension to connect to a Gitpod workspace.', { id: 'install_remote_ssh', flow }, install, cancel);
		if (action === cancel) {
			return false;
		}

		this.logger.info('Installing "ms-vscode-remote.remote-ssh" extension');

		await vscode.commands.executeCommand('extension.open', 'ms-vscode-remote.remote-ssh');
		await vscode.commands.executeCommand('workbench.extensions.installExtension', 'ms-vscode-remote.remote-ssh');

		return true;
	}

	private async showSSHPasswordModal(password: string, session: vscode.AuthenticationSession, flow: UserFlowTelemetry) {
		const maskedPassword = '•'.repeat(password.length - 3) + password.substring(password.length - 3);

		const sshKeysSupported = session.scopes.includes(ScopeFeature.SSHPublicKeys);

		const copy: vscode.MessageItem = { title: 'Copy' };
		const configureSSH: vscode.MessageItem = { title: 'Configure SSH' };
		const showLogs: vscode.MessageItem = { title: 'Show logs', isCloseAffordance: true };
		const message = sshKeysSupported
			? `You don't have registered any SSH public key for this machine in your Gitpod account.\nAlternatively, copy and use this temporary password until workspace restart: ${maskedPassword}`
			: `An SSH key is required for passwordless authentication.\nAlternatively, copy and use this password: ${maskedPassword}`;
		const action = await this.notifications.showWarningMessage(message, { flow, modal: true, id: 'ssh_gateway_modal' }, copy, configureSSH, showLogs);

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
		this.logger.info(logMessage);
		this.logger.show();
		throw new Error('SSH password modal dialog, Canceled');
	}

	private async ensureValidGitpodHost(gitpodHost: string, flow: UserFlowTelemetry): Promise<boolean> {
		const config = vscode.workspace.getConfiguration('gitpod');
		const currentGitpodHost = config.get<string>('host')!;
		if (new URL(gitpodHost).host !== new URL(currentGitpodHost).host) {
			const yes = 'Yes';
			const cancel = 'Cancel';
			const action = await this.notifications.showInformationMessage(`Connecting to a Gitpod workspace in '${gitpodHost}'. Would you like to switch from '${currentGitpodHost}' and continue?`, { id: 'switch_gitpod_host', flow }, yes, cancel);
			if (action === cancel) {
				return false;
			}

			await config.update('host', gitpodHost, vscode.ConfigurationTarget.Global);
			this.logger.info(`Updated 'gitpod.host' setting to '${gitpodHost}' while trying to connect to a Gitpod workspace`);
		}

		return true;
	}

	private async getGitpodSession(gitpodHost: string) {
		const gitpodVersion = await getGitpodVersion(gitpodHost, this.logger);
		const sessionScopes = ['function:getWorkspace', 'function:getOwnerToken', 'function:getLoggedInUser', 'resource:default'];
		if (await isOauthInspectSupported(gitpodHost) || isFeatureSupported(gitpodVersion, 'SSHPublicKeys') /* && isFeatureSupported('', 'sendHeartBeat') */) {
			sessionScopes.push('function:getSSHPublicKeys', 'function:sendHeartBeat');
		} else {
			this.logger.warn(`function:getSSHPublicKeys and function:sendHeartBeat session scopes not supported in ${gitpodHost}, using version ${gitpodVersion.raw}`);
		}

		return vscode.authentication.getSession(
			'gitpod',
			sessionScopes,
			{ createIfNone: true }
		);
	}

	public async handleUri(uri: vscode.Uri) {
		if (uri.path === RemoteConnector.AUTH_COMPLETE_PATH) {
			this.logger.info('auth completed');
			return;
		}

		const params: SSHConnectionParams = JSON.parse(uri.query);
		const gitpodVersion = await getGitpodVersion(params.gitpodHost, this.logger);
		const sshFlow: UserFlowTelemetry = { ...params, gitpodVersion: gitpodVersion.raw, flow: 'ssh' };
		const isRemoteSSHExtInstalled = await this.ensureRemoteSSHExtInstalled(sshFlow);
		if (!isRemoteSSHExtInstalled) {
			return;
		}

		const isGitpodHostValid = await this.ensureValidGitpodHost(params.gitpodHost, sshFlow);
		if (!isGitpodHostValid) {
			return;
		}

		const session = await this.getGitpodSession(params.gitpodHost);
		if (!session) {
			return;
		}
		sshFlow.userId = session.account.id;

		this.logger.info('Opening Gitpod workspace', uri.toString());

		await this.initPublicApi(session, params.gitpodHost);

		const forceUseLocalApp = getServiceURL(params.gitpodHost) === 'https://gitpod.io'
			? (await this.experiments.get<boolean>('gitpod.remote.useLocalApp', session.account.id, { gitpodHost: params.gitpodHost }))!
			: (await this.experiments.get<boolean>('gitpod.remote.useLocalApp', session.account.id, { gitpodHost: params.gitpodHost }, 'gitpod_remote_useLocalApp_sh'))!;
		const userOverride = String(isUserOverrideSetting('gitpod.remote.useLocalApp'));
		let sshDestination: SSHDestination | undefined;
		if (!forceUseLocalApp) {
			const openSSHVersion = await getOpenSSHVersion();
			const gatewayFlow = { kind: 'gateway', openSSHVersion, userOverride, ...sshFlow };
			try {
				this.telemetry.sendUserFlowStatus('connecting', gatewayFlow);

				const { destination, password } = await this.getWorkspaceSSHDestination(session, params);
				sshDestination = destination;

				Object.assign(gatewayFlow, { auth: password ? 'password' : 'key' });

				if (password) {
					await this.showSSHPasswordModal(password, session, gatewayFlow);
				}

				this.telemetry.sendUserFlowStatus('connected', gatewayFlow);
			} catch (e) {
				this.telemetry.sendUserFlowStatus('failed', { ...gatewayFlow, reason: e.toString() });
				if (e instanceof NoSSHGatewayError) {
					this.logger.error('No SSH gateway:', e);
					const ok = 'OK';
					await this.notifications.showWarningMessage(`${e.host} does not support [direct SSH access](https://github.com/gitpod-io/gitpod/blob/main/install/installer/docs/workspace-ssh-access.md), connecting via the deprecated SSH tunnel over WebSocket.`, { flow: gatewayFlow, id: 'no_ssh_gateway' }, ok);
					// Do nothing and continue execution
				} else if (e instanceof SSHError && e.message === 'Timed out while waiting for handshake') {
					this.logger.error('SSH test connection error:', e);
					const ok = 'OK';
					await this.notifications.showWarningMessage(`Timed out while waiting for the SSH handshake. It's possible, that SSH connections on port 22 are blocked, or your network is too slow. Connecting via the deprecated SSH tunnel over WebSocket instead.`, { flow: gatewayFlow, id: 'ssh_timeout' }, ok);
					// Do nothing and continue execution
				} else if (e instanceof NoRunningInstanceError) {
					this.logger.error('No Running instance:', e);
					this.notifications.showErrorMessage(`Failed to connect to ${e.workspaceId} Gitpod workspace: workspace not running`, { flow: gatewayFlow, id: 'no_running_instance' });
					return;
				} else {
					if (e instanceof SSHError) {
						this.logger.error('SSH test connection error:', e);
					} else {
						this.logger.error(`Failed to connect to ${params.workspaceId} Gitpod workspace:`, e);
					}
					const seeLogs = 'See Logs';
					const showTroubleshooting = 'Show Troubleshooting';
					const action = await this.notifications.showErrorMessage(`Failed to connect to ${params.workspaceId} Gitpod workspace`, { flow: gatewayFlow, id: 'failed_to_connect' }, seeLogs, showTroubleshooting);
					if (action === seeLogs) {
						this.logger.show();
					} else if (action === showTroubleshooting) {
						vscode.env.openExternal(vscode.Uri.parse('https://www.gitpod.io/docs/ides-and-editors/vscode#connecting-to-vs-code-desktop-ssh'));
					}
					return;
				}
			}
		}

		const usingSSHGateway = !!sshDestination;
		let localAppSSHConfigPath: string | undefined;
		if (!usingSSHGateway && !params.debugWorkspace) {
			// debug workspace does not support local app mode
			const localAppFlow = { kind: 'local-app', userOverride, ...sshFlow };
			try {
				this.telemetry.sendUserFlowStatus('connecting', localAppFlow);

				const localAppDestData = await this.getWorkspaceLocalAppSSHDestination(params);
				sshDestination = localAppDestData.destination;
				localAppSSHConfigPath = localAppDestData.localAppSSHConfigPath;

				this.telemetry.sendUserFlowStatus('connected', localAppFlow);
			} catch (e) {
				this.telemetry.sendUserFlowStatus('failed', { reason: e.toString(), ...localAppFlow });
				this.logger.error(`Failed to connect ${params.workspaceId} Gitpod workspace:`, e);
				if (e instanceof LocalAppError) {
					const seeLogs = 'See Logs';
					const showTroubleshooting = 'Show Troubleshooting';
					const action = await this.notifications.showErrorMessage(`Failed to connect to ${params.workspaceId} Gitpod workspace`, { flow: localAppFlow, id: 'failed_to_connect' }, seeLogs, showTroubleshooting);
					if (action === seeLogs) {
						this.logger.show();
						if (e.logPath) {
							const document = await vscode.workspace.openTextDocument(vscode.Uri.file(e.logPath));
							vscode.window.showTextDocument(document);
						}
					} else if (action === showTroubleshooting) {
						vscode.env.openExternal(vscode.Uri.parse('https://www.gitpod.io/docs/ides-and-editors/vscode#connecting-to-vs-code-desktop-ssh'));
					}
				} else {
					// Do nothing, user cancelled the operation
				}
				return;
			}
		}

		await this.updateRemoteSSHConfig(usingSSHGateway, localAppSSHConfigPath);

		await this.context.globalState.update(`${RemoteConnector.SSH_DEST_KEY}${sshDestination!.toRemoteSSHString()}`, { ...params, isFirstConnection: true } as SSHConnectionParams);

		const forceNewWindow = this.context.extensionMode === vscode.ExtensionMode.Production;

		// Force Linux as host platform (https://github.com/gitpod-io/gitpod/issues/16058)
		if (isWindows) {
			const existingSSHHostPlatforms = vscode.workspace.getConfiguration('remote.SSH').get<{ [host: string]: string }>('remotePlatform', {});
			if (!existingSSHHostPlatforms[sshDestination!.hostname]) {
				await vscode.workspace.getConfiguration('remote.SSH').update('remotePlatform', { ...existingSSHHostPlatforms, [sshDestination!.hostname]: 'linux' }, vscode.ConfigurationTarget.Global);
			}
		}

		vscode.commands.executeCommand(
			'vscode.openFolder',
			vscode.Uri.parse(`vscode-remote://ssh-remote+${sshDestination!.toRemoteSSHString()}${uri.path || '/'}`),
			{ forceNewWindow }
		);
	}

	public async autoTunnelCommand(gitpodHost: string, instanceId: string, enabled: boolean) {
		const session = await this.getGitpodSession(gitpodHost);
		if (session) {
			const forceUseLocalApp = getServiceURL(gitpodHost) === 'https://gitpod.io'
				? (await this.experiments.get<boolean>('gitpod.remote.useLocalApp', session.account.id, { gitpodHost }))!
				: (await this.experiments.get<boolean>('gitpod.remote.useLocalApp', session.account.id, { gitpodHost }, 'gitpod_remote_useLocalApp_sh'))!;
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
			this.logger.error('Failed to disable auto tunneling:', e);
		}
	}

	private async startHeartBeat(session: vscode.AuthenticationSession, connectionInfo: SSHConnectionParams) {
		if (this.heartbeatManager) {
			return;
		}

		this.heartbeatManager = new HeartbeatManager(connectionInfo.gitpodHost, connectionInfo.workspaceId, connectionInfo.instanceId, !!connectionInfo.debugWorkspace, session.accessToken, this.publicApi, this.logger, this.telemetry);

		try {
			// TODO: remove this in the future, gitpod-remote no longer has the heartbeat logic, it's just here until users
			// update to the latest version of gitpod-remote
			await retry(async () => {
				await vscode.commands.executeCommand('__gitpod.cancelGitpodRemoteHeartbeat');
			}, 3000, 15);
		} catch {
		}
	}

	private async initializeRemoteExtensions(flow: UserFlowTelemetry & { quiet: boolean; flowId: string }) {
		this.telemetry.sendUserFlowStatus('enabled', flow);
		let syncData: { ref: string; content: string } | undefined;
		try {
			syncData = await this.settingsSync.readResource(SyncResource.Extensions);
		} catch (e) {
			if (e instanceof NoSyncStoreError) {
				const msg = `Could not install local extensions on remote workspace. Please enable [Settings Sync](https://www.gitpod.io/docs/ides-and-editors/settings-sync#enabling-settings-sync-in-vs-code-desktop) with Gitpod.`;
				this.logger.error(msg);

				const status = 'no_sync_store';
				if (flow.quiet) {
					this.telemetry.sendUserFlowStatus(status, flow);
				} else {
					const addSyncProvider = 'Settings Sync: Enable Sign In with Gitpod';
					const action = await this.notifications.showInformationMessage(msg, { flow, id: status }, addSyncProvider);
					if (action === addSyncProvider) {
						vscode.commands.executeCommand('gitpod.syncProvider.add');
					}
				}
			} else if (e instanceof NoSettingsSyncSession) {
				const msg = `Could not install local extensions on remote workspace. Please enable [Settings Sync](https://www.gitpod.io/docs/ides-and-editors/settings-sync#enabling-settings-sync-in-vs-code-desktop) with Gitpod.`;
				this.logger.error(msg);

				const status = 'no_settings_sync';
				if (flow.quiet) {
					this.telemetry.sendUserFlowStatus(status, flow);
				} else {
					const enableSettingsSync = 'Enable Settings Sync';
					const action = await this.notifications.showInformationMessage(msg, { flow, id: status }, enableSettingsSync);
					if (action === enableSettingsSync) {
						vscode.commands.executeCommand('workbench.userDataSync.actions.turnOn');
					}
				}
			} else {
				this.logger.error('Error while fetching settings sync extension data:', e);

				const status = 'failed_to_fetch';
				if (flow.quiet) {
					this.telemetry.sendUserFlowStatus(status, flow);
				} else {
					const seeLogs = 'See Logs';
					const action = await this.notifications.showErrorMessage(`Error while fetching settings sync extension data.`, { flow, id: status }, seeLogs);
					if (action === seeLogs) {
						this.logger.show();
					}
				}
			}
			return;
		}

		const syncDataContent = parseSyncData(syncData.content);
		if (!syncDataContent) {
			const msg = `Error while parsing settings sync extension data.`;
			this.logger.error(msg);

			const status = 'failed_to_parse_content';
			if (flow.quiet) {
				this.telemetry.sendUserFlowStatus(status, flow);
			} else {
				await this.notifications.showErrorMessage(msg, { flow, id: status });
			}
			return;
		}

		let extensions: ISyncExtension[];
		try {
			extensions = JSON.parse(syncDataContent.content);
		} catch {
			const msg = `Error while parsing settings sync extension data, malformed JSON.`;
			this.logger.error(msg);

			const status = 'failed_to_parse_json';
			if (flow.quiet) {
				this.telemetry.sendUserFlowStatus(status, flow);
			} else {
				await this.notifications.showErrorMessage(msg, { flow, id: status });
			}
			return;
		}

		extensions = extensions.filter(e => e.installed);
		flow.extensions = extensions.length;
		if (!extensions.length) {
			this.telemetry.sendUserFlowStatus('synced', flow);
			return;
		}

		try {
			try {
				this.logger.trace(`Installing local extensions on remote: `, extensions.map(e => e.identifier.id).join('\n'));
				await retry(async () => {
					await vscode.commands.executeCommand('__gitpod.initializeRemoteExtensions', extensions);
				}, 3000, 15);
			} catch (e) {
				this.logger.error(`Could not execute '__gitpod.initializeRemoteExtensions' command`);
				throw e;
			}
			this.telemetry.sendUserFlowStatus('synced', flow);
		} catch {
			const msg = `Error while installing local extensions on remote.`;
			this.logger.error(msg);

			const status = 'failed';
			if (flow.quiet) {
				this.telemetry.sendUserFlowStatus(status, flow);
			} else {
				const seeLogs = 'See Logs';
				const action = await this.notifications.showErrorMessage(msg, { flow, id: status }, seeLogs);
				if (action === seeLogs) {
					this.logger.show();
				}
			}
		}
	}

	private async showWsNotRunningDialog(workspaceId: string, workspaceUrl: string | undefined, flow: UserFlowTelemetry) {
		const msg = workspaceUrl
			? `Workspace ${workspaceId} is not running. Please restart the workspace.`
			: `Workspace not found. Please start the workspace from dashboard.`;
		this.logger.error(msg);

		const openUrl = 'Start workspace';
		const resp = await this.notifications.showErrorMessage(msg, { modal: true, id: uuid(), flow }, openUrl);
		if (resp === openUrl) {
			await vscode.env.openExternal(vscode.Uri.parse(workspaceUrl || 'https://gitpod.io/workspaces'));
			vscode.commands.executeCommand('workbench.action.closeWindow');
		}
	}

	private async onGitpodRemoteConnection() {
		const remoteUri = vscode.workspace.workspaceFile || vscode.workspace.workspaceFolders?.[0].uri;
		if (!remoteUri) {
			return;
		}

		const [, sshDestStr] = remoteUri.authority.split('+');
		const connectionInfo = this.context.globalState.get<SSHConnectionInfo>(`${RemoteConnector.SSH_DEST_KEY}${sshDestStr}`);
		if (!connectionInfo) {
			return;
		}

		const session = await this.getGitpodSession(connectionInfo.gitpodHost);
		if (!session) {
			return;
		}

		const workspaceInfo = await withServerApi(session.accessToken, connectionInfo.gitpodHost, service => service.server.getWorkspace(connectionInfo.workspaceId), this.logger);
		if (workspaceInfo.latestInstance?.status?.phase !== 'running') {
			return;
		}

		if (workspaceInfo.latestInstance.id !== connectionInfo.instanceId) {
			this.logger.info(`Updating workspace ${connectionInfo.workspaceId} latest instance id ${connectionInfo.instanceId} => ${workspaceInfo.latestInstance.id}`);
			connectionInfo.instanceId = workspaceInfo.latestInstance.id;
		}

		await this.context.globalState.update(`${RemoteConnector.SSH_DEST_KEY}${sshDestStr}`, { ...connectionInfo, isFirstConnection: false } as SSHConnectionParams);

		const gitpodVersion = await getGitpodVersion(connectionInfo.gitpodHost, this.logger);

		await this.initPublicApi(session, connectionInfo.gitpodHost);

		if (this.publicApi) {
			this.workspaceState = new WorkspaceState(connectionInfo.workspaceId, this.publicApi, this.logger);
			await this.workspaceState.workspaceStatePromise;

			const reconnectFlow = { ...connectionInfo, gitpodVersion: gitpodVersion.raw, userId: session.account.id, flow: 'reconnect_workspace' };
			if (!this.workspaceState.isWorkspaceRunning()) {
				this.showWsNotRunningDialog(connectionInfo.workspaceId, this.workspaceState.workspaceUrl(), reconnectFlow);
				return;
			}

			let messageShown = false;
			this._register(this.workspaceState.onWorkspaceStatusChanged(() => {
				if (!this.workspaceState!.isWorkspaceRunning() && !messageShown) {
					messageShown = true;
					this.showWsNotRunningDialog(connectionInfo.workspaceId, this.workspaceState!.workspaceUrl(), reconnectFlow);
				}
			}));
		}

		const heartbeatSupported = session.scopes.includes(ScopeFeature.LocalHeartbeat);
		if (heartbeatSupported) {
			this.startHeartBeat(session, connectionInfo);
		} else {
			this.logger.warn(`Local heartbeat not supported in ${connectionInfo.gitpodHost}, using version ${gitpodVersion.raw}`);
		}

		const syncExtFlow = { ...connectionInfo, gitpodVersion: gitpodVersion.raw, userId: session.account.id, flow: 'sync_local_extensions' };
		this.initializeRemoteExtensions({ ...syncExtFlow, quiet: true, flowId: uuid() });
		this.context.subscriptions.push(vscode.commands.registerCommand('gitpod.installLocalExtensions', () => {
			this.initializeRemoteExtensions({ ...syncExtFlow, quiet: false, flowId: uuid() });
		}));

		vscode.commands.executeCommand('setContext', 'gitpod.inWorkspace', true);
	}

	public override async dispose(): Promise<void> {
		await this.heartbeatManager?.dispose();
		this.workspaceState?.dispose();
		super.dispose();
	}
}

function isGitpodRemoteWindow(context: vscode.ExtensionContext) {
	const remoteUri = vscode.workspace.workspaceFile || vscode.workspace.workspaceFolders?.[0].uri;
	if (vscode.env.remoteName === 'ssh-remote' && context.extension.extensionKind === vscode.ExtensionKind.UI && remoteUri) {
		const [, sshDestStr] = remoteUri.authority.split('+');
		const connectionInfo = context.globalState.get<SSHConnectionInfo>(`${RemoteConnector.SSH_DEST_KEY}${sshDestStr}`);

		return !!connectionInfo;
	}

	return false;
}

function getServiceURL(gitpodHost: string): string {
	return new URL(gitpodHost).toString().replace(/\/$/, '');
}
