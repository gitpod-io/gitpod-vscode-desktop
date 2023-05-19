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
import { RemoteService } from './services/remoteService';
import { WorkspacesExplorerView } from './workspacesExplorerView';
import { ConnectInCurrentWindowCommand, ConnectInNewWindowCommand, DeleteWorkspaceCommand, OpenInBrowserCommand, StopCurrentWorkspaceCommand, StopWorkspaceCommand } from './commands/workspaces';
import { WorkspaceView } from './workspaceView';

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

export async function activate(context: vscode.ExtensionContext) {
	const extensionId = context.extension.id;
	const packageJSON = context.extension.packageJSON;

	let remoteConnectionInfo: { connectionInfo: SSHConnectionParams; remoteUri: vscode.Uri; sshDestStr: string } | undefined;
	let success = false;
	try {
		logger = vscode.window.createOutputChannel('Gitpod', { log: true });
		context.subscriptions.push(logger);

		// always try to create extension globalStorage folder
		await createExtensionGlobalStorage(logger, context);

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

		const hostService = new HostService(context, notificationService, logger);
		context.subscriptions.push(hostService);

		const sessionService = new SessionService(hostService, logger);
		context.subscriptions.push(sessionService);

		const remoteService = new RemoteService(context, hostService, telemetryService, sessionService, logger);
		context.subscriptions.push(remoteService);

		const experiments = new ExperimentalSettings(packageJSON.configcatKey, packageJSON.version, context, sessionService, hostService, logger);
		context.subscriptions.push(experiments);

		const settingsSync = new SettingsSync(commandManager, logger, telemetryService, notificationService);
		context.subscriptions.push(settingsSync);

		const remoteConnector = new RemoteConnector(context, sessionService, hostService, experiments, logger, telemetryService, notificationService, remoteService);
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

		remoteConnectionInfo = getGitpodRemoteWindowConnectionInfo(context);
		vscode.commands.executeCommand('setContext', 'gitpod.remoteConnection', !!remoteConnectionInfo);

		const workspacesExplorerView = new WorkspacesExplorerView(commandManager, sessionService, hostService);
		context.subscriptions.push(vscode.window.createTreeView('gitpod-workspaces', { treeDataProvider: workspacesExplorerView }));
		context.subscriptions.push(workspacesExplorerView);

		if (remoteConnectionInfo) {
			const workspaceView = new WorkspaceView(remoteConnectionInfo.connectionInfo.workspaceId, sessionService);
			context.subscriptions.push(vscode.window.createTreeView('gitpod-workspace', { treeDataProvider: workspaceView }));
			context.subscriptions.push(workspaceView);
		}

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

				remoteSession = new RemoteSession(remoteConnectionInfo.connectionInfo, context, hostService, sessionService, settingsSync, experiments, logger!, telemetryService!, notificationService);
				await remoteSession.initialize();
			}
		});

		success = true;
	} finally {
		const rawActivateProperties = {
			gitpodHost: remoteConnectionInfo?.connectionInfo.gitpodHost || Configuration.getGitpodHost(),
			isRemoteSSH: String(vscode.env.remoteName === 'ssh-remote'),
			remoteUri: remoteConnectionInfo?.remoteUri?.toString(),
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

async function createExtensionGlobalStorage(logger: vscode.LogOutputChannel, context: vscode.ExtensionContext) {
	try {
		// it will not throw error if folder already exists
		await vscode.workspace.fs.createDirectory(context.globalStorageUri);
	} catch (e) {
		logger.error('Failed to create global storage', e);
	}
}

export async function deactivate() {
	await remoteSession?.dispose();
	await telemetryService?.dispose();
}
