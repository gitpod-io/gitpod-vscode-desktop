/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addCounter } from '../common/metrics';
import { ILogService } from './logService';

export class LocalSSHMetricsReporter {
    private metricsHost: string;

    constructor(
        gitpodHost: string,
        private readonly logService: ILogService,
    ) {
        const serviceUrl = new URL(gitpodHost);
        this.metricsHost = `ide.${serviceUrl.hostname}`;
    }

    reportConfigStatus(status: 'success' | 'failure', failureCode?: string) {
        if (status === 'success') {
            failureCode = 'None';
        }
        return addCounter(this.metricsHost, 'vscode_desktop_local_ssh_config_total', { status, failure_code: failureCode ?? 'Unknown' }, 1, this.logService);
    }

    reportPingExtensionStatus(status: 'success' | 'failure') {
        return addCounter(this.metricsHost, 'vscode_desktop_ping_extension_server_total', { status }, 1, this.logService);
    }

    reportConnectionStatus(phase: 'connected' | 'connecting' | 'failed', failureCode?: string) {
        if (phase === 'connecting' || phase === 'connected') {
            failureCode = 'None';
        }
        return addCounter(this.metricsHost, 'vscode_desktop_local_ssh_total', { phase, failure_code: failureCode ?? 'Unknown' }, 1, this.logService);
    }
}
