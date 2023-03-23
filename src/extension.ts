/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as vscode from 'vscode';
import fetch, { Headers, Request, Response, AbortError, FetchError } from 'node-fetch-commonjs';
import GitpodAuthenticationProvider from './authentication';
import { UserFlowTelemetry } from './common/telemetry';
import { ExperimentalSettings } from './experiments';
import { exportLogs } from './exportLogs';
import GitpodServer from './gitpodServer';
import { NotificationService } from './notification';
import { ReleaseNotes } from './releaseNotes';
import { RemoteConnector, getGitpodRemoteWindow } from './remoteConnector';
import { SettingsSync } from './settingsSync';
import TelemetryReporter from './telemetryReporter';

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

let telemetry: TelemetryReporter;
let remoteConnector: RemoteConnector;

export async function activate(context: vscode.ExtensionContext) {
	const extensionId = context.extension.id;
	const packageJSON = context.extension.packageJSON;

	// sync between machines
	context.globalState.setKeysForSync([ReleaseNotes.RELEASE_NOTES_LAST_READ_KEY]);

	const logger = vscode.window.createOutputChannel('Gitpod', { log: true });
	context.subscriptions.push(logger);

	const onDidChangeLogLevel = (logLevel: vscode.LogLevel) => {
		logger.appendLine(`Log level: ${vscode.LogLevel[logLevel]}`);
	};
	context.subscriptions.push(logger.onDidChangeLogLevel(onDidChangeLogLevel));
	onDidChangeLogLevel(logger.logLevel);

	logger.info(`${extensionId}/${packageJSON.version} (${os.release()} ${os.platform()} ${os.arch()}) vscode/${vscode.version} (${vscode.env.appName})`);

	const experiments = new ExperimentalSettings('gitpod', packageJSON.version, context, logger);
	context.subscriptions.push(experiments);

	telemetry = new TelemetryReporter(extensionId, packageJSON.version, packageJSON.segmentKey);
	const notifications = new NotificationService(telemetry);

	context.subscriptions.push(vscode.commands.registerCommand('gitpod.exportLogs', async () => {
		const flow: UserFlowTelemetry = { flow: 'export_logs' };
		telemetry.sendUserFlowStatus('exporting', flow);
		try {
			await exportLogs(context);
			telemetry.sendUserFlowStatus('exported', flow);
		} catch (e) {
			const outputMessage = `Error exporting logs: ${e}`;
			notifications.showErrorMessage(outputMessage, { id: 'failed', flow });
			logger.error(outputMessage);
		}
	}));

	const settingsSync = new SettingsSync(logger, telemetry, notifications);
	context.subscriptions.push(settingsSync);

	const authProvider = new GitpodAuthenticationProvider(context, logger, telemetry, notifications);
	remoteConnector = new RemoteConnector(context, settingsSync, experiments, logger, telemetry, notifications);
	context.subscriptions.push(authProvider);
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

	context.subscriptions.push(new ReleaseNotes(context, logger));

	if (!context.globalState.get<boolean>(FIRST_INSTALL_KEY, false)) {
		await context.globalState.update(FIRST_INSTALL_KEY, true);
		telemetry.sendTelemetryEvent('gitpod_desktop_installation', { kind: 'install' });
	}

	const remoteConnectionInfo = getGitpodRemoteWindow(context);
	telemetry.sendTelemetryEvent('vscode_desktop_activate', {
		remoteName: vscode.env.remoteName || '',
		remoteUri: String(!!(vscode.workspace.workspaceFile || vscode.workspace.workspaceFolders?.[0].uri)),
		workspaceId: remoteConnectionInfo?.connectionInfo.workspaceId || '',
		instanceId: remoteConnectionInfo?.connectionInfo.instanceId || '',
		gitpodHost: remoteConnectionInfo?.connectionInfo.gitpodHost || '',
		debugWorkspace: remoteConnectionInfo ? String(!!remoteConnectionInfo.connectionInfo.debugWorkspace) : '',
	});
}

export async function deactivate() {
	await remoteConnector?.dispose();
	await telemetry?.dispose();
}
