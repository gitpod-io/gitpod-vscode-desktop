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
		context.subscriptions.push(logger!.onDidChangeLogLevel(onDidChangeLogLevel));
		onDidChangeLogLevel(logger!.logLevel);

		logger.info(`${extensionId}/${packageJSON.version} (${os.release()} ${os.platform()} ${os.arch()}) vscode/${vscode.version} (${vscode.env.appName})`);

		telemetryService = new TelemetryService(extensionId, packageJSON.version, packageJSON.segmentKey, logger!);

		const notificationService = new NotificationService(telemetryService);

		const commandManager = new CommandManager();
		context.subscriptions.push(commandManager);

		// Create auth provider as soon as possible
		const authProvider = new GitpodAuthenticationProvider(context, logger, telemetryService, notificationService);
		context.subscriptions.push(authProvider);

		hostService = new HostService(context, notificationService, logger);
		context.subscriptions.push(hostService);

		const localSSHService = new LocalSSHService(context, hostService, telemetryService, logger);
		context.subscriptions.push(localSSHService);

		const sessionService = new SessionService(hostService, logger);
		context.subscriptions.push(sessionService);

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

		// Register global commands
		commandManager.register(new SignInCommand(sessionService));
		commandManager.register(new ExportLogsCommand(context.logUri, notificationService, telemetryService, logger, hostService));

		if (!context.globalState.get<boolean>(FIRST_INSTALL_KEY, false)) {
			context.globalState.update(FIRST_INSTALL_KEY, true);
			telemetryService.sendTelemetryEvent(hostService.gitpodHost, 'gitpod_desktop_installation', { kind: 'install' });
		}

		remoteConnectionInfo = getGitpodRemoteWindowConnectionInfo(context);
		// Because auth provider implementation is in the same extension, we need to wait for it to activate first
		sessionService.didFirstLoad.then(async () => {
			if (remoteConnectionInfo) {
				commandManager.register({ id: 'gitpod.api.autoTunnel', execute: () => remoteConnector.autoTunnelCommand });

				remoteSession = new RemoteSession(remoteConnectionInfo.remoteAuthority, remoteConnectionInfo.connectionInfo, context, hostService!, sessionService, settingsSync, experiments, logger!, telemetryService!, notificationService);
				await remoteSession.initialize();
			}
		});

		success = true;
	} catch (e) {
		telemetryService?.sendTelemetryException(hostService?.gitpodHost || Configuration.getGitpodHost(), e);
		throw e;
	} finally {
		const rawActivateProperties = {
			remoteName: vscode.env.remoteName || '',
			remoteUri: vscode.workspace.workspaceFile || vscode.workspace.workspaceFolders?.[0].uri,
			workspaceId: remoteConnectionInfo?.connectionInfo.workspaceId || '',
			instanceId: remoteConnectionInfo?.connectionInfo.instanceId || '',
			gitpodHost: remoteConnectionInfo?.connectionInfo.gitpodHost || '',
			debugWorkspace: remoteConnectionInfo ? String(!!remoteConnectionInfo.connectionInfo.debugWorkspace) : '',
			success: String(success)
		};
		const gitpodHost = rawActivateProperties.gitpodHost || hostService?.gitpodHost || Configuration.getGitpodHost();
		logger?.info('Activation properties:', JSON.stringify(rawActivateProperties, undefined, 2));
		telemetryService?.sendTelemetryEvent(gitpodHost, 'vscode_desktop_activate', {
			...rawActivateProperties,
			// TODO String(remoteName === "remote-ssh") and we should drop remoteName or make it boolean
			remoteUri: String(!!rawActivateProperties.remoteUri)
			// TODO whether it is local ssh? parse remote uri
		});
	}
}

export async function deactivate() {
	await remoteSession?.dispose();
	await telemetryService?.dispose();
}
