/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { spawn } from 'child_process';
import { ExitCode } from './local-ssh/common';
import { ILogService } from './services/logService';

const sleep = (sec: number) => new Promise(resolve => setTimeout(resolve, sec * 1000));

export async function ensureDaemonStarted(logService: ILogService, retry = 10) {
    if (retry < 0) {
        return;
    }
    const localAppProcess = await tryStartDaemon(logService);
    localAppProcess.once('exit', code => {
        switch (code) {
            case ExitCode.OK:
            case ExitCode.ListenPortFailed:
                logService.error('exit with code: ' + code);
                return;
        }
        logService.error('unexpectedly exit with code: ' + code + ' attempt retry: ' + retry);
        ensureDaemonStarted(logService, retry - 1);
    });
    await sleep(1);
}

export async function tryStartDaemon(logService: ILogService) {
    logService.info('going to start local-ssh daemon');
    const daemon = spawn(process.execPath, [join(__dirname, 'local-ssh/daemon.js')], {
        detached: true,
        stdio: 'ignore',
        env: process.env
    });
    daemon.unref();
    return daemon;
}