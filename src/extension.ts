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
import { NotificationService } from './notificationService';
import { ReleaseNotes } from './releaseNotes';
import { RemoteConnector } from './remoteConnector';
import { SettingsSync } from './settingsSync';
import { TelemetryService } from './telemetryService';
import { RemoteSession } from './remoteSession';
import { checkForStoppedWorkspaces, getGitpodRemoteWindowConnectionInfo } from './remote';
import { HostService } from './hostService';
import { SessionService } from './sessionService';
import { CommandManager } from './commandManager';
import { SignInCommand } from './commands/account';
import { ExportLogsCommand } from './commands/logs';

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

let telemetryService: TelemetryService;
let remoteSession: RemoteSession;

export async function activate(context: vscode.ExtensionContext) {
	const extensionId = context.extension.id;
	const packageJSON = context.extension.packageJSON;

	// sync between machines
	context.globalState.setKeysForSync([ReleaseNotes.RELEASE_NOTES_LAST_READ_KEY]);

	const logger = vscode.window.createOutputChannel('Gitpod', { log: true });
	context.subscriptions.push(logger);

	const onDidChangeLogLevel = (logLevel: vscode.LogLevel) => {
		logger.info(`Log level: ${vscode.LogLevel[logLevel]}`);
	};
	context.subscriptions.push(logger.onDidChangeLogLevel(onDidChangeLogLevel));
	onDidChangeLogLevel(logger.logLevel);

	logger.info(`${extensionId}/${packageJSON.version} (${os.release()} ${os.platform()} ${os.arch()}) vscode/${vscode.version} (${vscode.env.appName})`);

	telemetryService = new TelemetryService(extensionId, packageJSON.version, packageJSON.segmentKey);

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

	const experiments = new ExperimentalSettings('gitpod', packageJSON.version, sessionService, context, logger);
	context.subscriptions.push(experiments);

	const settingsSync = new SettingsSync(commandManager, logger, telemetryService, notificationService);
	context.subscriptions.push(settingsSync);

	const remoteConnector = new RemoteConnector(context, sessionService, hostService, experiments, logger, telemetryService, notificationService);
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

	const remoteConnectionInfo = getGitpodRemoteWindowConnectionInfo(context);
	if (remoteConnectionInfo) {
		commandManager.register({ id: 'gitpod.api.autoTunnel', execute: () => remoteConnector.autoTunnelCommand });

		remoteSession = new RemoteSession(remoteConnectionInfo.remoteAuthority, remoteConnectionInfo.connectionInfo, context, hostService, sessionService, settingsSync, experiments, logger, telemetryService, notificationService);
		// Don't await this on purpose so it doesn't block extension activation.
		// Internally requesting a Gitpod Session requires the extension to be already activated.
		remoteSession.initialize();
	} else if (sessionService.isSignedIn()) {
		const restartFlow = { flow: 'restart_workspace', userId: sessionService.getUserId() };
		checkForStoppedWorkspaces(context, hostService.gitpodHost, restartFlow, notificationService, logger);
	}

	context.subscriptions.push(new ReleaseNotes(context, commandManager, logger));

	if (!context.globalState.get<boolean>(FIRST_INSTALL_KEY, false)) {
		await context.globalState.update(FIRST_INSTALL_KEY, true);
		telemetryService.sendTelemetryEvent('gitpod_desktop_installation', { kind: 'install' });
	}

	// Register global commands
	commandManager.register(new SignInCommand(sessionService));
	commandManager.register(new ExportLogsCommand(context.logUri, notificationService, telemetryService, logger));

	telemetryService.sendTelemetryEvent('vscode_desktop_activate', {
		remoteName: vscode.env.remoteName || '',
		remoteUri: String(!!(vscode.workspace.workspaceFile || vscode.workspace.workspaceFolders?.[0].uri)),
		workspaceId: remoteConnectionInfo?.connectionInfo.workspaceId || '',
		instanceId: remoteConnectionInfo?.connectionInfo.instanceId || '',
		gitpodHost: remoteConnectionInfo?.connectionInfo.gitpodHost || '',
		debugWorkspace: remoteConnectionInfo ? String(!!remoteConnectionInfo.connectionInfo.debugWorkspace) : '',
	});
}

export async function deactivate() {
	await remoteSession?.dispose();
	await telemetryService?.dispose();
}
