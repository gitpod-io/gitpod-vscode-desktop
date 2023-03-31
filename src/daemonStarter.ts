/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { spawn } from 'child_process';
import { ExitCode } from './local-ssh/common';
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
            telemetryService.sendTelemetryException(new Error(`unexpectedly exit with code ${humanReadableCode} ${code} attempt retry: ${retry}`), { humanReadableCode, code: code?.toString() ?? 'null' });
        });
    });
    if (!ok) {
        await timeout(1000);
        await ensureDaemonStarted(logService, telemetryService, retry - 1);
    }
}

export interface DaemonOptions {
    logLevel: 'debug' | 'info';
    serverPort: number;

    // TODO(local-ssh): Log file path use `globalStorageUri`? https://code.visualstudio.com/api/extension-capabilities/common-capabilities#:~:text=ExtensionContext.globalStorageUri%3A%20A%20global%20storage%20URI%20pointing%20to%20a%20local%20directory%20where%20your%20extension%20has%20read/write%20access.%20This%20is%20a%20good%20option%20if%20you%20need%20to%20store%20large%20files%20that%20are%20accessible%20from%20all%20workspaces
    logFilePath: string;
}

const DefaultDaemonOptions: DaemonOptions = {
    logLevel: 'info',
    // use `sudo lsof -i:<port>` to check if the port is already in use
    serverPort: Configuration.getLocalSSHServerPort(),
    logFilePath: Configuration.getDaemonLogPath(),
};

export function parseArgv(options: DaemonOptions): string[] {
    return [options.logLevel, options.serverPort.toString(), options.logFilePath];
}

export async function tryStartDaemon(logService: ILogService, options?: DaemonOptions) {
    const opts: DaemonOptions = { ...DefaultDaemonOptions, ...options };
    const args: string[] = [join(__dirname, 'local-ssh/daemon.js'), ...parseArgv(opts)];
    logService.debug('going to start local-ssh daemon', opts, args);
    const daemon = spawn(process.execPath, args, {
        detached: true,
        stdio: 'ignore',
        env: process.env
    });
    daemon.unref();
    return daemon;
}