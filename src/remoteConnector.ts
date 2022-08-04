/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AutoTunnelRequest, ResolveSSHConnectionRequest, ResolveSSHConnectionResponse } from '@gitpod/local-app-api-grpcweb/lib/localapp_pb';
import { LocalAppClient } from '@gitpod/local-app-api-grpcweb/lib/localapp_pb_service';
import { NodeHttpTransport } from '@improbable-eng/grpc-web-node-http-transport';
import { grpc } from '@improbable-eng/grpc-web';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
import * as crypto from 'crypto';
import fetch, { Response } from 'node-fetch';
import { Client as sshClient, OpenSSHAgent, utils as sshUtils } from 'ssh2';
import { ParsedKey } from 'ssh2-streams';
import * as tmp from 'tmp';
import * as path from 'path';
import * as vscode from 'vscode';
import Log from './common/logger';
import { Disposable } from './common/dispose';
import { withServerApi } from './internalApi';
import TelemetryReporter from './telemetryReporter';
import { addHostToHostFile, checkNewHostInHostkeys } from './ssh/hostfile';
import { DEFAULT_IDENTITY_FILES } from './ssh/identityFiles';
import { HeartbeatManager } from './heartbeat';
import { getGitpodVersion, isFeatureSupported } from './featureSupport';
import SSHConfiguration from './ssh/sshConfig';
import { isWindows } from './common/platform';
import { untildify } from './common/files';

interface SSHConnectionParams {
	workspaceId: string;
	instanceId: string;
	gitpodHost: string;
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

class SSHError extends Error {
	constructor(cause: Error) {
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

	constructor(private readonly context: vscode.ExtensionContext, private readonly logger: Log, private readonly telemetry: TelemetryReporter) {
		super();

		if (isGitpodRemoteWindow(context)) {
			context.subscriptions.push(vscode.commands.registerCommand('gitpod.api.autoTunnel', this.autoTunnelCommand, this));

			// Don't await this on purpose so it doesn't block extension activation.
			// Internally requesting a Gitpod Session requires the extension to be already activated.
			this.onGitpodRemoteConnection();
		}

		this.releaseStaleLocks();
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
				download.body.pipe(installationStream)
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

	// From https://github.com/openssh/openssh-portable/blob/acb2059febaddd71ee06c2ebf63dcf211d9ab9f2/sshconnect2.c#L1689-L1690
	private async getIdentityKeys(hostConfig: Record<string, string>) {
		const identityFiles: string[] = ((hostConfig['IdentityFile'] as unknown as string[]) || []).map(untildify);
		if (identityFiles.length === 0) {
			identityFiles.push(...DEFAULT_IDENTITY_FILES);
		}

		const identityFileContentsResult = await Promise.allSettled(identityFiles.map(async path => fs.promises.readFile(path + '.pub')));
		const fileKeys = identityFileContentsResult.map((result, i) => {
			if (result.status === 'rejected') {
				return undefined;
			}

			const parsedResult = sshUtils.parseKey(result.value);
			if (parsedResult instanceof Error || !parsedResult) {
				this.logger.error(`Error while parsing SSH public key ${identityFiles[i] + '.pub'}:`, parsedResult);
				return undefined;
			}

			const parsedKey = Array.isArray(parsedResult) ? parsedResult[0] : parsedResult;
			const fingerprint = crypto.createHash('sha256').update(parsedKey.getPublicSSH()).digest('base64');

			return {
				filename: identityFiles[i],
				parsedKey,
				fingerprint
			};
		}).filter(<T>(v: T | undefined): v is T => !!v);

		let sshAgentParsedKeys: ParsedKey[] = [];
		try {
			let sshAgentSock = isWindows ? `\\.\pipe\openssh-ssh-agent` : (hostConfig['IdentityAgent'] || process.env['SSH_AUTH_SOCK']);
			if (!sshAgentSock) {
				throw new Error(`SSH_AUTH_SOCK environment variable not defined`);
			}
			sshAgentSock = untildify(sshAgentSock);

			sshAgentParsedKeys = await new Promise<ParsedKey[]>((resolve, reject) => {
				const sshAgent = new OpenSSHAgent(sshAgentSock!);
				sshAgent.getIdentities((err, publicKeys) => {
					if (err) {
						reject(err);
					} else {
						resolve(publicKeys || []);
					}
				});
			});
		} catch (e) {
			this.logger.error(`Couldn't get identities from OpenSSH agent`, e);
		}

		const sshAgentKeys = sshAgentParsedKeys.map(parsedKey => {
			const fingerprint = crypto.createHash('sha256').update(parsedKey.getPublicSSH()).digest('base64');
			return {
				filename: parsedKey.comment,
				parsedKey,
				fingerprint
			};
		});

		const identitiesOnly = (hostConfig['IdentitiesOnly'] || '').toLowerCase() === 'yes';
		const agentKeys: { filename: string; parsedKey: ParsedKey; fingerprint: string }[] = [];
		const preferredIdentityKeys: { filename: string; parsedKey: ParsedKey; fingerprint: string }[] = [];
		for (const agentKey of sshAgentKeys) {
			const foundIdx = fileKeys.findIndex(k => agentKey.parsedKey.type === k.parsedKey.type && agentKey.fingerprint === k.fingerprint);
			if (foundIdx >= 0) {
				preferredIdentityKeys.push(fileKeys[foundIdx]);
				fileKeys.splice(foundIdx, 1);
			} else if (!identitiesOnly) {
				agentKeys.push(agentKey);
			}
		}
		preferredIdentityKeys.push(...agentKeys);
		preferredIdentityKeys.push(...fileKeys);

		this.logger.trace(`Identity keys:`, preferredIdentityKeys.length ? preferredIdentityKeys.map(k => `${k.filename} ${k.parsedKey.type} SHA256:${k.fingerprint}`).join('\n') : 'None');

		return preferredIdentityKeys;
	}

	private async getWorkspaceSSHDestination(accessToken: string, { workspaceId, gitpodHost }: SSHConnectionParams): Promise<{ destination: string; password?: string }> {
		const serviceUrl = new URL(gitpodHost);
		const gitpodVersion = await getGitpodVersion(gitpodHost);

		const [workspaceInfo, ownerToken, registeredSSHKeys] = await withServerApi(accessToken, serviceUrl.toString(), service => Promise.all([
			service.server.getWorkspace(workspaceId),
			service.server.getOwnerToken(workspaceId),
			isFeatureSupported(gitpodVersion, 'SSHPublicKeys') ? service.server.getSSHPublicKeys() : undefined
		]), this.logger);

		if (workspaceInfo.latestInstance?.status?.phase !== 'running') {
			throw new NoRunningInstanceError(workspaceId);
		}

		const workspaceUrl = new URL(workspaceInfo.latestInstance.ideUrl);

		const sshHostKeyEndPoint = `https://${workspaceUrl.host}/_ssh/host_keys`;
		const sshHostKeyResponse = await fetch(sshHostKeyEndPoint);
		if (!sshHostKeyResponse.ok) {
			// Gitpod SSH gateway not configured
			throw new NoSSHGatewayError(gitpodHost);
		}

		const sshHostKeys: { type: string; host_key: string }[] = await sshHostKeyResponse.json();

		const sshDestInfo = {
			user: workspaceId,
			// See https://github.com/gitpod-io/gitpod/pull/9786 for reasoning about `.ssh` suffix
			hostName: workspaceUrl.host.replace(workspaceId, `${workspaceId}.ssh`)
		};

		let verifiedHostKey: Buffer | undefined;
		// Test ssh connection first
		await new Promise<void>((resolve, reject) => {
			const conn = new sshClient();
			conn.on('ready', () => {
				conn.end();
				resolve();
			}).on('error', err => {
				reject(new SSHError(err));
			}).connect({
				host: sshDestInfo.hostName,
				username: sshDestInfo.user,
				authHandler(_methodsLeft, _partialSuccess, _callback) {
					return {
						type: 'password',
						username: workspaceId,
						password: ownerToken,
					};
				},
				hostVerifier(hostKey) {
					// We didn't specify `hostHash` so `hashedKey` is a Buffer object
					verifiedHostKey = (hostKey as any as Buffer);
					const encodedKey = verifiedHostKey.toString('base64');
					return sshHostKeys.some(keyData => keyData.host_key === encodedKey);
				}
			});
		});
		this.logger.info(`SSH test connection to '${sshDestInfo.hostName}' host successful`);

		// SSH connection successful, write host to known_hosts
		try {
			const result = sshUtils.parseKey(verifiedHostKey!);
			if (result instanceof Error) {
				throw result;
			}
			const parseKey = Array.isArray(result) ? result[0] : result;
			if (parseKey && await checkNewHostInHostkeys(sshDestInfo.hostName)) {
				await addHostToHostFile(sshDestInfo.hostName, verifiedHostKey!, parseKey.type);
				this.logger.info(`'${sshDestInfo.hostName}' host added to known_hosts file`);
			}
		} catch (e) {
			this.logger.error(`Couldn't write '${sshDestInfo.hostName}' host to known_hosts file:`, e);
		}

		const sshConfiguration = await SSHConfiguration.loadFromFS();
		const hostConfiguration = sshConfiguration.getHostConfiguration(sshDestInfo.hostName);

		let identityKeys = await this.getIdentityKeys(hostConfiguration);

		if (registeredSSHKeys) {
			this.logger.trace(`Registered public keys in Gitpod account:`, registeredSSHKeys.length ? registeredSSHKeys.map(k => `${k.name} SHA256:${k.fingerprint}`).join('\n') : 'None');

			identityKeys = identityKeys.filter(k => !!registeredSSHKeys.find(regKey => regKey.fingerprint === k.fingerprint));
		} else {
			if (identityKeys.length) {
				sshDestInfo.user = `${workspaceId}#${ownerToken}`;
			}
			this.logger.warn(`Registered SSH public keys not supported in ${gitpodHost}, using version ${gitpodVersion.version}`);
		}

		return {
			destination: Buffer.from(JSON.stringify(sshDestInfo), 'utf8').toString('hex'),
			password: identityKeys.length === 0 ? ownerToken : undefined
		};
	}

	private async getWorkspaceLocalAppSSHDestination(params: SSHConnectionParams): Promise<{ localAppSSHDest: string; localAppSSHConfigPath: string }> {
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
					localAppSSHDest: connection.getHost(),
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

	private async ensureRemoteSSHExtInstalled(): Promise<boolean> {
		const msVscodeRemoteExt = vscode.extensions.getExtension('ms-vscode-remote.remote-ssh');
		if (msVscodeRemoteExt) {
			return true;
		}

		const install = 'Install';
		const cancel = 'Cancel';
		const action = await vscode.window.showInformationMessage('Please install "Remote - SSH" extension to connect to a Gitpod workspace.', install, cancel);
		if (action === cancel) {
			return false;
		}

		this.logger.info('Installing "ms-vscode-remote.remote-ssh" extension');

		await vscode.commands.executeCommand('extension.open', 'ms-vscode-remote.remote-ssh');
		await vscode.commands.executeCommand('workbench.extensions.installExtension', 'ms-vscode-remote.remote-ssh');

		return true;
	}

	private async showSSHPasswordModal(password: string, gitpodHost: string) {
		const maskedPassword = '•'.repeat(password.length - 3) + password.substring(password.length - 3);

		const gitpodVersion = await getGitpodVersion(gitpodHost);
		const sshKeysSupported = isFeatureSupported(gitpodVersion, 'SSHPublicKeys');

		const copy: vscode.MessageItem = { title: 'Copy' };
		const configureSSH: vscode.MessageItem = { title: 'Configure SSH' };
		const showLogs: vscode.MessageItem = { title: 'Show logs', isCloseAffordance: true };
		const message = sshKeysSupported
			? `You don't have registered any SSH public key for this machine in your Gitpod account.\nAlternatively, copy and use this temporary password until workspace restart: ${maskedPassword}`
			: `An SSH key is required for passwordless authentication.\nAlternatively, copy and use this password: ${maskedPassword}`;
		const action = await vscode.window.showWarningMessage(message, { modal: true }, copy, configureSSH, showLogs);
		if (action === copy) {
			await vscode.env.clipboard.writeText(password);
			return;
		}
		if (action === configureSSH) {
			const serviceUrl = new URL(gitpodHost).toString().replace(/\/$/, '');
			const externalUrl = sshKeysSupported ? `${serviceUrl}/keys` : 'https://www.gitpod.io/docs/configure/ssh#create-an-ssh-key';
			await vscode.env.openExternal(vscode.Uri.parse(externalUrl));
			throw new Error(`SSH password modal dialog, Configure SSH`);
		}

		this.logger.show();
		throw new Error('SSH password modal dialog, Canceled');
	}

	private async getGitpodSession(gitpodHost: string) {
		const config = vscode.workspace.getConfiguration('gitpod');
		const currentGitpodHost = config.get<string>('host')!;
		if (new URL(gitpodHost).host !== new URL(currentGitpodHost).host) {
			const yes = 'Yes';
			const cancel = 'Cancel';
			const action = await vscode.window.showInformationMessage(`Connecting to a Gitpod workspace in '${gitpodHost}'. Would you like to switch from '${currentGitpodHost}' and continue?`, yes, cancel);
			if (action === cancel) {
				return;
			}

			await config.update('host', gitpodHost, vscode.ConfigurationTarget.Global);
			this.logger.info(`Updated 'gitpod.host' setting to '${gitpodHost}' while trying to connect to a Gitpod workspace`);
		}

		const gitpodVersion = await getGitpodVersion(gitpodHost);
		const sessionScopes = ['function:getWorkspace', 'function:getOwnerToken', 'function:getLoggedInUser', 'resource:default'];
		if (isFeatureSupported(gitpodVersion, 'SSHPublicKeys') /* && isFeatureSupported('', 'sendHeartBeat') */) {
			sessionScopes.push('function:getSSHPublicKeys', 'function:sendHeartBeat');
		} else {
			this.logger.warn(`function:getSSHPublicKeys and function:sendHeartBeat session scopes not supported in ${gitpodHost}, using version ${gitpodVersion.version}`);
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

		const isRemoteSSHExtInstalled = await this.ensureRemoteSSHExtInstalled();
		if (!isRemoteSSHExtInstalled) {
			return;
		}

		const params: SSHConnectionParams = JSON.parse(uri.query);
		const gitpodVersion = await getGitpodVersion(params.gitpodHost);

		const session = await this.getGitpodSession(params.gitpodHost);
		if (!session) {
			return;
		}

		this.logger.info('Opening Gitpod workspace', uri.toString());

		const forceUseLocalApp = vscode.workspace.getConfiguration('gitpod').get<boolean>('remote.useLocalApp')!;
		let sshDestination: string | undefined;
		if (!forceUseLocalApp) {
			try {
				this.telemetry.sendRawTelemetryEvent('vscode_desktop_ssh', { kind: 'gateway', status: 'connecting', ...params, gitpodVersion: gitpodVersion.raw });

				const { destination, password } = await this.getWorkspaceSSHDestination(session.accessToken, params);
				sshDestination = destination;

				if (password) {
					await this.showSSHPasswordModal(password, params.gitpodHost);
				}

				this.telemetry.sendRawTelemetryEvent('vscode_desktop_ssh', { kind: 'gateway', status: 'connected', ...params, gitpodVersion: gitpodVersion.raw });
			} catch (e) {
				this.telemetry.sendRawTelemetryEvent('vscode_desktop_ssh', { kind: 'gateway', status: 'failed', reason: e.toString(), ...params, gitpodVersion: gitpodVersion.raw });
				if (e instanceof NoSSHGatewayError) {
					this.logger.error('No SSH gateway:', e);
					vscode.window.showWarningMessage(`${e.host} does not support [direct SSH access](https://github.com/gitpod-io/gitpod/blob/main/install/installer/docs/workspace-ssh-access.md), connecting via the deprecated SSH tunnel over WebSocket.`);
					// Do nothing and continue execution
				} else if (e instanceof NoRunningInstanceError) {
					this.logger.error('No Running instance:', e);
					vscode.window.showErrorMessage(`Failed to connect to ${e.workspaceId} Gitpod workspace: workspace not running`);
					return;
				} else {
					if (e instanceof SSHError) {
						this.logger.error('SSH test connection error:', e);
					} else {
						this.logger.error(`Failed to connect to ${params.workspaceId} Gitpod workspace:`, e);
					}
					const seeLogs = 'See Logs';
					const showTroubleshooting = 'Show Troubleshooting';
					const action = await vscode.window.showErrorMessage(`Failed to connect to ${params.workspaceId} Gitpod workspace`, seeLogs, showTroubleshooting);
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
		if (!usingSSHGateway) {
			try {
				this.telemetry.sendRawTelemetryEvent('vscode_desktop_ssh', { kind: 'local-app', status: 'connecting', ...params, gitpodVersion: gitpodVersion.raw });

				const localAppDestData = await this.getWorkspaceLocalAppSSHDestination(params);
				sshDestination = localAppDestData.localAppSSHDest;
				localAppSSHConfigPath = localAppDestData.localAppSSHConfigPath;

				this.telemetry.sendRawTelemetryEvent('vscode_desktop_ssh', { kind: 'local-app', status: 'connected', ...params, gitpodVersion: gitpodVersion.raw });
			} catch (e) {
				this.telemetry.sendRawTelemetryEvent('vscode_desktop_ssh', { kind: 'local-app', status: 'failed', reason: e.toString(), ...params, gitpodVersion: gitpodVersion.raw });
				this.logger.error(`Failed to connect ${params.workspaceId} Gitpod workspace:`, e);
				if (e instanceof LocalAppError) {
					const seeLogs = 'See Logs';
					const showTroubleshooting = 'Show Troubleshooting';
					const action = await vscode.window.showErrorMessage(`Failed to connect to ${params.workspaceId} Gitpod workspace`, seeLogs, showTroubleshooting);
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

		await this.context.globalState.update(`${RemoteConnector.SSH_DEST_KEY}${sshDestination!}`, { ...params, isFirstConnection: true });

		const forceNewWindow = this.context.extensionMode === vscode.ExtensionMode.Production;
		vscode.commands.executeCommand(
			'vscode.openFolder',
			vscode.Uri.parse(`vscode-remote://ssh-remote+${sshDestination}${uri.path || '/'}`),
			{ forceNewWindow }
		);
	}

	public async autoTunnelCommand(gitpodHost: string, instanceId: string, enabled: boolean) {
		const forceUseLocalApp = vscode.workspace.getConfiguration('gitpod').get<boolean>('remote.useLocalApp')!;
		if (!forceUseLocalApp) {
			const authority = vscode.Uri.parse(gitpodHost).authority;
			const configKey = `config/${authority}`;
			const localAppconfig = this.context.globalState.get<LocalAppConfig>(configKey);
			if (!localAppconfig || checkRunning(localAppconfig.pid) !== true) {
				// Do nothing if we are using SSH gateway and local app is not running
				return;
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

	private startHeartBeat(accessToken: string, connectionInfo: SSHConnectionParams) {
		if (this.heartbeatManager) {
			return;
		}

		this.heartbeatManager = new HeartbeatManager(connectionInfo.gitpodHost, connectionInfo.workspaceId, connectionInfo.instanceId, accessToken, this.logger, this.telemetry);
	}

	private async onGitpodRemoteConnection() {
		const remoteUri = vscode.workspace.workspaceFile || vscode.workspace.workspaceFolders?.[0].uri;
		if (!remoteUri) {
			return;
		}

		const [, sshDestStr] = remoteUri.authority.split('+');
		const connectionInfo = this.context.globalState.get<SSHConnectionParams & { isFirstConnection: boolean }>(`${RemoteConnector.SSH_DEST_KEY}${sshDestStr}`);
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

		await this.context.globalState.update(`${RemoteConnector.SSH_DEST_KEY}${sshDestStr}`, { ...connectionInfo, isFirstConnection: false });

		const gitpodVersion = await getGitpodVersion(connectionInfo.gitpodHost);
		if (isFeatureSupported(gitpodVersion, 'localHeartbeat')) {
			// gitpod remote extension installation is async so sometimes gitpod-desktop will activate before gitpod-remote
			// let's try a few times for it to finish install
			let retryCount = 15;
			const tryStopRemoteHeartbeat = async () => {
				// Check for gitpod remote extension version to avoid sending heartbeat in both extensions at the same time
				const isGitpodRemoteHeartbeatCancelled = await cancelGitpodRemoteHeartbeat();
				if (isGitpodRemoteHeartbeatCancelled) {
					this.telemetry.sendTelemetryEvent('vscode_desktop_heartbeat_state', { enabled: String(true), gitpodHost: connectionInfo.gitpodHost, workspaceId: connectionInfo.workspaceId, instanceId: connectionInfo.instanceId, gitpodVersion: gitpodVersion.raw });
				} else if (retryCount > 0) {
					retryCount--;
					setTimeout(tryStopRemoteHeartbeat, 3000);
				} else {
					this.telemetry.sendTelemetryEvent('vscode_desktop_heartbeat_state', { enabled: String(false), gitpodHost: connectionInfo.gitpodHost, workspaceId: connectionInfo.workspaceId, instanceId: connectionInfo.instanceId, gitpodVersion: gitpodVersion.raw });
				}
			};

			this.startHeartBeat(session.accessToken, connectionInfo);
			tryStopRemoteHeartbeat();
		} else {
			this.logger.warn(`Local heatbeat not supported in ${connectionInfo.gitpodHost}, using version ${gitpodVersion.version}`);
		}
	}

	public override async dispose(): Promise<void> {
		await this.heartbeatManager?.dispose();
		super.dispose();
	}
}

function isGitpodRemoteWindow(context: vscode.ExtensionContext) {
	const remoteUri = vscode.workspace.workspaceFile || vscode.workspace.workspaceFolders?.[0].uri;
	if (vscode.env.remoteName === 'ssh-remote' && context.extension.extensionKind === vscode.ExtensionKind.UI && remoteUri) {
		const [, sshDestStr] = remoteUri.authority.split('+');
		const connectionInfo = context.globalState.get<SSHConnectionParams & { isFirstConnection: boolean }>(`${RemoteConnector.SSH_DEST_KEY}${sshDestStr}`);

		return !!connectionInfo;
	}

	return false;
}

async function cancelGitpodRemoteHeartbeat() {
	let result = false;
	try {
		// Invoke command from gitpot-remote extension
		result = await vscode.commands.executeCommand('__gitpod.cancelGitpodRemoteHeartbeat');
	} catch {
		// Ignore if not found
	}
	return result;
}
