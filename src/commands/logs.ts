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
import { ITelemetryService, UserFlowTelemetryProperties } from '../common/telemetry';
import { IHostService } from '../services/hostService';
import { getGitpodRemoteWindowConnectionInfo } from '../remote';
import SSHDestination from '../ssh/sshDestination';

interface IFile {
	path: string;
	contents: Buffer | string;
}

export class ExportLogsCommand implements Command {
	readonly id = 'gitpod.exportLogs';
	static latestLSSHHost: string | undefined;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly extLocalLogsUri: vscode.Uri,
		private readonly notificationService: INotificationService,
		private readonly telemetryService: ITelemetryService,
		private readonly logService: ILogService,
		private readonly hostService: IHostService,
	) {
		const lsshLog = this.getLSSHLog();
		if (lsshLog) {
			this.logService.info('LSSH Log:', lsshLog);
		}
	}

	async execute() {
		const gitpodHost = this.hostService.gitpodHost;
		const flow: UserFlowTelemetryProperties = { gitpodHost, flow: 'export_logs' };
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

	private getAdditionalRemoteLogs() {
		return [
			'/tmp/gitpod-git-credential-helper.log',
			'/var/log/gitpod/supervisor.log',
			'/workspace/.gitpod/logs/docker-up.log'
		];
	}

	private getAdditionalLocalLogs() {
		const additionalLocalLogs = [];
		const lsshLog = this.getLSSHLog();
		if (lsshLog) {
			additionalLocalLogs.push(lsshLog);
		}
		return additionalLocalLogs;
	}

	private getLSSHLog(): string | undefined {
		let lsshHostname: string | undefined;
		const sshDestStr = getGitpodRemoteWindowConnectionInfo(this.context)?.sshDestStr;
		if (sshDestStr) {
			lsshHostname = SSHDestination.fromRemoteSSHString(sshDestStr).hostname;
		} else if (ExportLogsCommand.latestLSSHHost) {
			lsshHostname = ExportLogsCommand.latestLSSHHost;
		}
		return lsshHostname ? path.join(os.tmpdir(), `lssh-${lsshHostname}.log`) : undefined;
	}

	async exportLogs() {
		const saveUri = await vscode.window.showSaveDialog({
			title: 'Choose save location ...',
			defaultUri: vscode.Uri.file(path.join(os.homedir(), `vscode-desktop-logs-${new Date().toISOString().replace(/-|:|\.\d+Z$/g, '')}.zip`)),
		});
		if (!saveUri) {
			return;
		}

		let extRemoteLogsUri: vscode.Uri | undefined;
		try {
			// Invoke command from gitpod-remote extension
			extRemoteLogsUri = await vscode.commands.executeCommand('__gitpod.getGitpodRemoteLogsUri');
		} catch {
			// Ignore if not found
		}

		const remoteLogsUri = extRemoteLogsUri?.with({ path: path.dirname(path.dirname(extRemoteLogsUri.path)) });
		const localLogsUri = this.extLocalLogsUri.with({ path: path.dirname(path.dirname(this.extLocalLogsUri.path)) });

		return vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: 'Exporting logs to zip file ...',
			cancellable: true
		}, async (_, token) => {
			const remoteLogFiles: IFile[] = [];
			if (remoteLogsUri) {
				await traverseFolder(remoteLogsUri, remoteLogFiles, token);
				remoteLogFiles.forEach(file => file.path = path.join('./remote', path.relative(remoteLogsUri.path, file.path)));
				if (token.isCancellationRequested) {
					return;
				}

				for (const logFilePath of this.getAdditionalRemoteLogs()) {
					try {
						const logFileUri = vscode.Uri.file(logFilePath).with({ scheme: 'vscode-remote' });
						const fileContent = await vscode.workspace.fs.readFile(logFileUri);
						if (fileContent.byteLength > 0) {
							remoteLogFiles.push({
								path: path.join('./remote', path.basename(logFileUri.path)),
								contents: Buffer.from(fileContent)
							});
						}
					} catch {
						// no-op
					}
				}
			}

			const localLogFiles: IFile[] = [];
			await traverseFolder(localLogsUri, localLogFiles, token);
			localLogFiles.forEach(file => file.path = path.join('./local', path.relative(localLogsUri.path, file.path)));
			if (token.isCancellationRequested) {
				return;
			}

			for (const logFilePath of this.getAdditionalLocalLogs()) {
				try {
					const logFileUri = vscode.Uri.file(logFilePath);
					const fileContent = await vscode.workspace.fs.readFile(logFileUri);
					if (fileContent.byteLength > 0) {
						remoteLogFiles.push({
							path: path.join('./local', path.basename(logFileUri.path)),
							contents: Buffer.from(fileContent)
						});
					}
				} catch {
					// no-op
				}
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
