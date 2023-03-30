/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { join } from 'path';
import { spawn } from 'child_process';
import { ExitCode } from './local-ssh/common';
import { ILogService } from './services/logService';
import { timeout } from './common/async';

export async function ensureDaemonStarted(logService: ILogService, retry = 10) {
    if (retry < 0) {
        return;
    }
    const localAppProcess = await tryStartDaemon(logService);
    const ok = await new Promise<boolean>(async resolve => {
        localAppProcess.once('exit', async code => {
            switch (code) {
                case ExitCode.OK:
                case ExitCode.ListenPortFailed:
                    logService.error('exit with code: ' + code);
                    resolve(true);
                    return;
            }
            logService.error('unexpectedly exit with code: ' + code + ' attempt retry: ' + retry);
            resolve(false);
            
        });
    })
    if (!ok) {
        await timeout(1000);
        await ensureDaemonStarted(logService, retry - 1);
    }
}

export async function tryStartDaemon(logService: ILogService) {
    logService.info('going to start local-ssh daemon');
    const args: string[] = [join(__dirname, 'local-ssh/daemon.js')]
    // TODO(local-ssh): make key different for insiders and stable to avoid they are synced
    const port: number | undefined = vscode.workspace.getConfiguration('gitpod').get<number>('localSSHServerPort');
    if (port) {
        args.push(port.toString());
    }
    const daemon = spawn(process.execPath, args, {
        detached: true,
        stdio: 'ignore',
        env: process.env
    });
    daemon.unref();
    return daemon;
}