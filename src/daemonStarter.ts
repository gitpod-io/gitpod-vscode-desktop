/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { spawn, exec } from 'child_process';
import { DaemonOptions, ExitCode } from './local-ssh/common';
import { ILogService } from './services/logService';
import { timeout } from './common/async';
import { Configuration } from './configuration';
import { ITelemetryService } from './services/telemetryService';

export async function ensureDaemonStarted(logService: ILogService, telemetryService: ITelemetryService, retry = 10) {
    if (retry < 0) {
        return;
    }
    const process = await tryStartDaemon(logService);
    const ok = await new Promise<boolean>(resolve => {
        process.once('exit', async code => {
            const humanReadableCode = code !== null ? ExitCode[code] : 'UNSPECIFIED';
            logService.error(`lssh exit with code ${humanReadableCode} ${code}`);
            switch (code) {
                case ExitCode.OK:
                case ExitCode.ListenPortFailed:
                    resolve(true);
                    return;
            }
            logService.error('lssh unexpectedly exit with code: ' + code + ' attempt retry: ' + retry);
            resolve(false);
            telemetryService.sendTelemetryException(
                Configuration.getGitpodHost(),
                new Error(`unexpectedly exit with code ${humanReadableCode} ${code} attempt retry: ${retry}`),
                { humanReadableCode, code: code?.toString() ?? 'null' }
            );
        });
    });
    if (!ok) {
        await timeout(1000);
        await ensureDaemonStarted(logService, telemetryService, retry - 1);
    }
}

const DefaultDaemonOptions: DaemonOptions = {
    logLevel: 'info',
    // use `sudo lsof -i:<port>` to check if the port is already in use
    ipcPort: Configuration.getLocalSshIpcPort(),
    serverPort: Configuration.getLocalSSHServerPort(),

    logFilePath: Configuration.getDaemonLogPath(),
};

export function parseArgv(options: DaemonOptions): string[] {
    return [options.logFilePath, options.logLevel, options.serverPort.toString(), options.ipcPort.toString()];
}

export async function tryStartDaemon(logService: ILogService, options?: Partial<DaemonOptions>) {
    const opts: DaemonOptions = { ...DefaultDaemonOptions, ...options };
    const args: string[] = [join(__dirname, 'local-ssh/daemon.js'), ...parseArgv(opts)];
    logService.debug('going to start local-ssh daemon', opts, args);
    const daemon = spawn(process.execPath, args, {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    daemon.unref();
    return daemon;
}

function killProcess(regex: string) {
    let cmd;
    switch (process.platform) {
        case 'win32':
            cmd = `taskkill /F /FI "IMAGENAME eq ${regex}"`;
            break;
        case 'darwin':
        case 'linux':
            cmd = `pkill -f ${regex}`;
            break;
        default:
            throw new Error(`Unsupported platform: ${process.platform}`);
    }
    exec(cmd);
}

export async function killDaemon() {
    const logName = Configuration.getDaemonLogFileName();
    return killProcess(`node.*?local-ssh.*?daemon.js.*?${logName}`);
}
