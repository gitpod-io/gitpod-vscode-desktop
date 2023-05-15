/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as yazl from 'yazl';
import * as fs from 'fs';
import * as os from 'os';
import * as vscode from 'vscode';
import { Command } from '../commandManager';
import { ILogService } from '../services/logService';
import { INotificationService } from '../services/notificationService';
import { ITelemetryService, UserFlowTelemetry } from '../services/telemetryService';
import { HostService } from '../services/hostService';

interface IFile {
	path: string;
	contents: Buffer | string;
}

export class ExportLogsCommand implements Command {
	readonly id = 'gitpod.exportLogs';

	constructor(
		private readonly extLocalLogsUri: vscode.Uri,
		private readonly notificationService: INotificationService,
		private readonly telemetryService: ITelemetryService,
		private readonly logService: ILogService,
		private readonly hostService: HostService,
	) { }

	async execute() {
		const gitpodHost = this.hostService.gitpodHost;
		const flow: UserFlowTelemetry = { gitpodHost, flow: 'export_logs' };
		this.telemetryService.sendUserFlowStatus('exporting', flow);
		try {
			await this.exportLogs();
			this.telemetryService.sendUserFlowStatus('exported', flow);
		} catch (e) {
			const outputMessage = `Error exporting logs: ${e}`;
			this.notificationService.showErrorMessage(outputMessage, { id: 'failed', flow });
			this.logService.error(outputMessage);
		}
	}

	async exportLogs() {
		const saveUri = await vscode.window.showSaveDialog({
			title: 'Choose save location ...',
			defaultUri: vscode.Uri.file(path.posix.join(os.homedir(), `vscode-desktop-logs-${new Date().toISOString().replace(/-|:|\.\d+Z$/g, '')}.zip`)),
		});
		if (!saveUri) {
			return;
		}

		let extRemoteLogsUri: vscode.Uri | undefined;
		try {
			// Invoke command from gitpot-remote extension
			extRemoteLogsUri = await vscode.commands.executeCommand('__gitpod.getGitpodRemoteLogsUri');
		} catch {
			// Ignore if not found
		}

		const remoteLogsUri = extRemoteLogsUri?.with({ path: path.posix.dirname(path.posix.dirname(extRemoteLogsUri.path)) });
		const localLogsUri = this.extLocalLogsUri.with({ path: path.posix.dirname(path.posix.dirname(this.extLocalLogsUri.path)) });

		return vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: 'Exporting logs to zip file ...',
			cancellable: true
		}, async (_, token) => {
			const remoteLogFiles: IFile[] = [];
			if (remoteLogsUri) {
				await traverseFolder(remoteLogsUri, remoteLogFiles, token);
				remoteLogFiles.forEach(file => file.path = path.posix.join('./remote', path.posix.relative(remoteLogsUri.path, file.path)));
				if (token.isCancellationRequested) {
					return;
				}
			}

			const localLogFiles: IFile[] = [];
			await traverseFolder(localLogsUri, localLogFiles, token);
			localLogFiles.forEach(file => file.path = path.posix.join('./local', path.posix.relative(localLogsUri.path, file.path)));
			if (token.isCancellationRequested) {
				return;
			}

			return zip(saveUri.fsPath, remoteLogFiles.concat(localLogFiles));
		});
	}
}

function zip(zipPath: string, files: IFile[]): Promise<string> {
	return new Promise<string>((c, e) => {
		const zip = new yazl.ZipFile();
		files.forEach(f => {
			if (f.contents) {
				zip.addBuffer(typeof f.contents === 'string' ? Buffer.from(f.contents, 'utf8') : f.contents, f.path);
			}
		});
		zip.end();

		const zipStream = fs.createWriteStream(zipPath);
		zip.outputStream.pipe(zipStream);

		zip.outputStream.once('error', e);
		zipStream.once('error', e);
		zipStream.once('finish', () => c(zipPath));
	});
}

async function traverseFolder(folderUri: vscode.Uri, files: IFile[], token: vscode.CancellationToken) {
	if (token.isCancellationRequested) {
		return;
	}

	const children = await vscode.workspace.fs.readDirectory(folderUri);
	for (const [name, type] of children) {
		if (token.isCancellationRequested) {
			return;
		}

		if (type === vscode.FileType.File) {
			const filePath = path.posix.join(folderUri.path, name);
			const fileContent = await vscode.workspace.fs.readFile(folderUri.with({ path: filePath }));
			if (fileContent.byteLength > 0) {
				files.push({
					path: filePath,
					contents: Buffer.from(fileContent)
				});
			}
		} else if (type === vscode.FileType.Directory) {
			const folderPath = path.posix.join(folderUri.path, name);
			await traverseFolder(folderUri.with({ path: folderPath }), files, token);
		}
	}
}
