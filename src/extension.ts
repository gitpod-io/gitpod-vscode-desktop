/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as vscode from 'vscode';
import Log from './common/logger';
import GitpodAuthenticationProvider from './authentication';
import RemoteConnector from './remoteConnector';
import { SettingsSync } from './settingsSync';
import GitpodServer from './gitpodServer';
import TelemetryReporter from './telemetryReporter';
import { exportLogs } from './exportLogs';
import { ReleaseNotes } from './releaseNotes';
import { ExperimentalSettings } from './experiments';

const FIRST_INSTALL_KEY = 'gitpod-desktop.firstInstall';

let telemetry: TelemetryReporter;
let remoteConnector: RemoteConnector;

export async function activate(context: vscode.ExtensionContext) {
	const extensionId = context.extension.id;
	const packageJSON = context.extension.packageJSON;

	// sync between machines
	context.globalState.setKeysForSync([ReleaseNotes.RELEASE_NOTES_LAST_READ_KEY]);

	const logger = new Log('Gitpod');
	logger.info(`${extensionId}/${packageJSON.version} (${os.release()} ${os.platform()} ${os.arch()}) vscode/${vscode.version} (${vscode.env.appName})`);

	const experiments = new ExperimentalSettings(packageJSON.configcatKey, packageJSON.version, logger);
	context.subscriptions.push(experiments);

	telemetry = new TelemetryReporter(extensionId, packageJSON.version, packageJSON.segmentKey);

	context.subscriptions.push(vscode.commands.registerCommand('gitpod.exportLogs', async () => {
		try {
			await exportLogs(context);
		} catch (e) {
			const outputMessage = `Error exporting logs: ${e}`;
			vscode.window.showErrorMessage(outputMessage);
			logger.error(outputMessage);
		}
	}));

	const settingsSync = new SettingsSync(logger, telemetry);
	context.subscriptions.push(settingsSync);

	const authProvider = new GitpodAuthenticationProvider(context, logger, telemetry);
	remoteConnector = new RemoteConnector(context, settingsSync, experiments, logger, telemetry);
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

	context.subscriptions.push(new ReleaseNotes(context));

	if (!context.globalState.get<boolean>(FIRST_INSTALL_KEY, false)) {
		await context.globalState.update(FIRST_INSTALL_KEY, true);
		telemetry.sendTelemetryEvent('gitpod_desktop_installation', { kind: 'install' });
	}
}

export async function deactivate() {
	await remoteConnector?.dispose();
	await telemetry?.dispose();
}
