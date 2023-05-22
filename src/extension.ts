/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as vscode from 'vscode';
import fetch, { Headers, Request, Response, AbortError, FetchError } from 'node-fetch-commonjs';
import GitpodAuthenticationProvider from './authentication/authentication';
import { ExperimentalSettings } from './experiments';
import GitpodServer from './authentication/gitpodServer';
import { NotificationService } from './services/notificationService';
import { RemoteConnector } from './remoteConnector';
import { SettingsSync } from './settingsSync';
import { TelemetryService } from './services/telemetryService';
import { RemoteSession } from './remoteSession';
import { SSHConnectionParams, getGitpodRemoteWindowConnectionInfo } from './remote';
import { HostService } from './services/hostService';
import { SessionService } from './services/sessionService';
import { CommandManager } from './commandManager';
import { SignInCommand } from './commands/account';
import { ExportLogsCommand } from './commands/logs';
import { Configuration } from './configuration';
import { LocalSSHService } from './services/localSSHService';
import { WorkspacesView } from './workspacesView';
import { ConnectInCurrentWindowCommand, ConnectInNewWindowCommand, DeleteWorkspaceCommand, OpenInBrowserCommand, StopCurrentWorkspaceCommand, StopWorkspaceCommand } from './commands/workspaces';

// connect-web uses fetch api, so we need to polyfill it
if (!global.fetch) {
	global.fetch = fetch as any;
	global.Headers = Headers as any;
	global.Request = Request as any;
	global.Response = Response as any;
	(global as any).AbortError = AbortError as any;
	(global as any).FetchError = FetchError as any;
}

const FIRST_INSTALL_KEY = 'gitpod-desktop.firstInstall';

let telemetryService: TelemetryService | undefined;
let remoteSession: RemoteSession | undefined;
let logger: vscode.LogOutputChannel | undefined;
let hostService: HostService | undefined;

export async function activate(context: vscode.ExtensionContext) {
	const extensionId = context.extension.id;
	const packageJSON = context.extension.packageJSON;

	let remoteConnectionInfo: { remoteAuthority: string; connectionInfo: SSHConnectionParams } | undefined;
	let success = false;
	try {
		logger = vscode.window.createOutputChannel('Gitpod', { log: true });
		context.subscriptions.push(logger);

		const onDidChangeLogLevel = (logLevel: vscode.LogLevel) => {
			logger!.info(`Log level: ${vscode.LogLevel[logLevel]}`);
		};
		context.subscriptions.push(logger.onDidChangeLogLevel(onDidChangeLogLevel));
		onDidChangeLogLevel(logger.logLevel);

		logger.info(`${extensionId}/${packageJSON.version} (${os.release()} ${os.platform()} ${os.arch()}) vscode/${vscode.version} (${vscode.env.appName})`);

		const piiPaths = [context.extensionPath, context.globalStorageUri.fsPath];
		if (context.storageUri) {
			piiPaths.push(context.storageUri.fsPath);
		}
		telemetryService = new TelemetryService(extensionId, packageJSON.version, packageJSON.segmentKey, piiPaths, logger);

		const notificationService = new NotificationService(telemetryService);

		const commandManager = new CommandManager();
		context.subscriptions.push(commandManager);

		// Create auth provider as soon as possible
		const authProvider = new GitpodAuthenticationProvider(context, logger, telemetryService, notificationService);
		context.subscriptions.push(authProvider);

		hostService = new HostService(context, notificationService, logger);
		context.subscriptions.push(hostService);

		const sessionService = new SessionService(hostService, logger);
		context.subscriptions.push(sessionService);

		const localSSHService = new LocalSSHService(context, hostService, telemetryService, sessionService, logger);
		context.subscriptions.push(localSSHService);

		const experiments = new ExperimentalSettings(packageJSON.configcatKey, packageJSON.version, context, sessionService, hostService, logger);
		context.subscriptions.push(experiments);

		const settingsSync = new SettingsSync(commandManager, logger, telemetryService, notificationService);
		context.subscriptions.push(settingsSync);

		const remoteConnector = new RemoteConnector(context, sessionService, hostService, experiments, logger, telemetryService, notificationService, localSSHService);
		context.subscriptions.push(remoteConnector);

		context.subscriptions.push(vscode.window.registerUriHandler({
			handleUri(uri: vscode.Uri) {
				// logger.trace('Handling Uri...', uri.toString());
				if (uri.path === GitpodServer.AUTH_COMPLETE_PATH) {
					authProvider.handleUri(uri);
				} else {
					remoteConnector.handleUri(uri);
				}
			}
		}));

		const workspacesView = new WorkspacesView(commandManager, sessionService, hostService);
		context.subscriptions.push(vscode.window.createTreeView('gitpod-workspaces', { treeDataProvider: workspacesView }));
		context.subscriptions.push(workspacesView);

		remoteConnectionInfo = getGitpodRemoteWindowConnectionInfo(context);

		// Register global commands
		commandManager.register(new SignInCommand(sessionService));
		commandManager.register(new ExportLogsCommand(context.logUri, notificationService, telemetryService, logger, hostService));
		commandManager.register(new ConnectInNewWindowCommand(context, sessionService, hostService));
		commandManager.register(new ConnectInCurrentWindowCommand(context, sessionService, hostService));
		commandManager.register(new StopWorkspaceCommand(sessionService));
		commandManager.register(new StopCurrentWorkspaceCommand(remoteConnectionInfo?.connectionInfo, sessionService));
		commandManager.register(new OpenInBrowserCommand(sessionService));
		commandManager.register(new DeleteWorkspaceCommand(sessionService));


		if (!context.globalState.get<boolean>(FIRST_INSTALL_KEY, false)) {
			context.globalState.update(FIRST_INSTALL_KEY, true);
			telemetryService.sendTelemetryEvent('gitpod_desktop_installation', { gitpodHost: hostService.gitpodHost, kind: 'install' });
		}

		// Because auth provider implementation is in the same extension, we need to wait for it to activate first
		sessionService.didFirstLoad.then(async () => {
			if (remoteConnectionInfo) {
				commandManager.register({ id: 'gitpod.api.autoTunnel', execute: () => remoteConnector.autoTunnelCommand });

				remoteSession = new RemoteSession(remoteConnectionInfo.remoteAuthority, remoteConnectionInfo.connectionInfo, context, hostService!, sessionService, settingsSync, experiments, logger!, telemetryService!, notificationService);
				await remoteSession.initialize();
			}
		});

		success = true;
	} finally {
		const rawActivateProperties = {
			gitpodHost: remoteConnectionInfo?.connectionInfo.gitpodHost || hostService?.gitpodHost || Configuration.getGitpodHost(),
			isRemoteSSH: String(vscode.env.remoteName === 'remote-ssh'),
			remoteUri: vscode.workspace.workspaceFile?.toString() || vscode.workspace.workspaceFolders?.[0].uri.toString() || '',
			workspaceId: remoteConnectionInfo?.connectionInfo.workspaceId || '',
			instanceId: remoteConnectionInfo?.connectionInfo.instanceId || '',
			debugWorkspace: remoteConnectionInfo ? String(!!remoteConnectionInfo.connectionInfo.debugWorkspace) : '',
			connType: remoteConnectionInfo?.connectionInfo.connType || '',
			success: String(success)
		};
		logger?.info('Activation properties:', JSON.stringify(rawActivateProperties, undefined, 2));
		telemetryService?.sendTelemetryEvent('vscode_desktop_activate', {
			...rawActivateProperties,
			remoteUri: String(!!rawActivateProperties.remoteUri)
		});
	}
}

export async function deactivate() {
	await remoteSession?.dispose();
	await telemetryService?.dispose();
}
