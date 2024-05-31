/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Workspace, WorkspaceInstanceStatus_Phase } from '@gitpod/public-api/lib/gitpod/experimental/v1/workspaces_pb';
import { UserSSHPublicKeyValue, WorkspaceInfo } from '@gitpod/gitpod-protocol';
import * as crypto from 'crypto';
import { utils as sshUtils } from 'ssh2';
import { ParsedKey } from 'ssh2-streams';
import * as vscode from 'vscode';
import { Disposable } from './common/dispose';
import { withServerApi } from './internalApi';
import { ITelemetryService, UserFlowTelemetryProperties } from './common/telemetry';
import { addHostToHostFile, checkNewHostInHostkeys } from './ssh/hostfile';
import { ScopeFeature } from './featureSupport';
import SSHConfiguration from './ssh/sshConfig';
import { ExperimentalSettings } from './experiments';
import { getOpenSSHVersion, testSSHConnection as testLocalSSHConnection } from './ssh/nativeSSH';
import { INotificationService } from './services/notificationService';
import { SSHKey } from '@gitpod/public-api/lib/gitpod/experimental/v1/user_pb';
import { getAgentSock, SSHError, testSSHConnection as testSSHGatewayConnection } from './sshTestConnection';
import { gatherIdentityFiles } from './ssh/identityFiles';
import SSHDestination from './ssh/sshDestination';
import { NoRunningInstanceError, NoSSHGatewayError, SSHConnectionParams, SSH_DEST_KEY, getLocalSSHDomain } from './remote';
import { ISessionService } from './services/sessionService';
import { ILogService } from './services/logService';
import { IHostService } from './services/hostService';
import { WrapError, getServiceURL } from './common/utils';
import { IRemoteService } from './services/remoteService';

export class RemoteConnector extends Disposable {

	public static AUTH_COMPLETE_PATH = '/auth-complete';

	private usePublicApi: boolean = false;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly sessionService: ISessionService,
		private readonly hostService: IHostService,
		private readonly experiments: ExperimentalSettings,
		private readonly logService: ILogService,
		private readonly telemetryService: ITelemetryService,
		private readonly notificationService: INotificationService,
		private readonly remoteService: IRemoteService,
	) {
		super();
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

		const verifiedHostKey = await testSSHGatewayConnection({
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
			this.logService.warn(`Registered SSH public keys not supported in ${gitpodHost}`);
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
		let hostname = `${workspaceId}.${domain}`;
		let user = workspaceId;
		if (debugWorkspace) {
			hostname = 'debug-' + hostname;
			user = 'debug-' + workspaceId;
		}

		this.logService.info('connecting with local ssh destination', { domain });
		return {
			destination: new SSHDestination(hostname, user),
			password: '',
		};
	}

	private async ensureRemoteSSHExtInstalled(flow: UserFlowTelemetryProperties): Promise<boolean> {
		const isOfficialVscode = vscode.env.uriScheme === 'vscode' || vscode.env.uriScheme === 'vscode-insiders';
		if (!isOfficialVscode) {
			return true;
		}

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

	private async showSSHPasswordModal(password: string, flow: UserFlowTelemetryProperties) {
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
		const sshFlow: UserFlowTelemetryProperties = { ...params, flow: 'ssh' };
		const isRemoteSSHExtInstalled = await this.ensureRemoteSSHExtInstalled(sshFlow);
		if (!isRemoteSSHExtInstalled) {
			return;
		}

		await this.sessionService.signIn(params.gitpodHost);
		if (!this.sessionService.isSignedIn() || new URL(this.hostService.gitpodHost).host !== new URL(params.gitpodHost).host /* remote window case so host didn't update*/) {
			return;
		}
		const useLocalSSH = await this.experiments.getUseLocalSSHProxy();

		sshFlow.userId = this.sessionService.getUserId();
		sshFlow.useLocalSSH = useLocalSSH;

		this.logService.info('Opening Gitpod workspace', uri.toString());

		const sshDestination = await vscode.window.withProgress(
			{
				title: `Connecting to ${params.workspaceId}`,
				location: vscode.ProgressLocation.Notification
			},
			async () => {
				this.usePublicApi = await this.experiments.getUsePublicAPI(params.gitpodHost);
				this.logService.info(`Going to use ${this.usePublicApi ? 'public' : 'server'} API`);

				const openSSHVersion = await getOpenSSHVersion();

				// Always try to run a local ssh connection collect success metrics
				let localSSHDestination: SSHDestination | undefined;
				let localSSHTestSuccess: boolean = false;
				const localSSHFlow: UserFlowTelemetryProperties = { kind: 'local-ssh', openSSHVersion, ...sshFlow };
				try {
					this.telemetryService.sendUserFlowStatus('connecting', localSSHFlow);
					// If needed, revert local-app changes first
					await this.remoteService.updateRemoteSSHConfig();

					this.remoteService.flow = sshFlow;
					await Promise.all([
						this.remoteService.setupSSHProxy(),
						this.remoteService.startLocalSSHServiceServer()
					]);

					({ destination: localSSHDestination } = await this.getLocalSSHWorkspaceSSHDestination(params));
					await testLocalSSHConnection(localSSHDestination.user!, localSSHDestination.hostname);
					localSSHTestSuccess = true;

					this.telemetryService.sendUserFlowStatus('connected', localSSHFlow);
				} catch (e) {
					const reason = e?.code ?? (e?.name && e.name !== 'Error' ? e.name : 'Unknown');
					this.telemetryService.sendTelemetryException(new WrapError('Local SSH: failed to connect to workspace', e), { ...localSSHFlow });
					this.telemetryService.sendUserFlowStatus('failed', { ...localSSHFlow, reason });
					this.logService.error(`Local SSH: failed to connect to ${params.workspaceId} Gitpod workspace:`, e);
				}

				let sshDestination: SSHDestination | undefined;

				if (useLocalSSH && localSSHTestSuccess) {
					this.logService.info('Going to use lssh');
					sshDestination = localSSHDestination;
					params.connType = 'local-ssh';
				}

				if (sshDestination === undefined) {
					const gatewayFlow: UserFlowTelemetryProperties = { kind: 'gateway', openSSHVersion, ...sshFlow };
					try {
						this.telemetryService.sendUserFlowStatus('connecting', gatewayFlow);

						const { destination, password } = await this.getWorkspaceSSHDestination(params);
						params.connType = 'ssh-gateway';

						sshDestination = destination;

						Object.assign(gatewayFlow, { auth: password ? 'password' : 'key' });

						if (password) {
							await this.showSSHPasswordModal(password, gatewayFlow);
						}

						this.telemetryService.sendUserFlowStatus('connected', gatewayFlow);
					} catch (e) {
						const reason = e?.code ? e.code : 'Unknown';
						if (reason === 'Unknown') {
							this.telemetryService.sendTelemetryException(new WrapError('Gateway: failed to connect to workspace', e, 'Unknown'), { ...gatewayFlow });
						}
						this.telemetryService.sendUserFlowStatus('failed', { ...gatewayFlow, reason });
						if (e instanceof NoRunningInstanceError) {
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
										vscode.env.openExternal(vscode.Uri.parse('https://www.gitpod.io/docs/references/ides-and-editors/vscode#troubleshooting'));
									}
								});
							return undefined;
						}
					}
				}

				await this.remoteService.updateRemoteSSHConfig();

				await this.context.globalState.update(`${SSH_DEST_KEY}${sshDestination!.toRemoteSSHString()}`, { ...params } as SSHConnectionParams);

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
}
