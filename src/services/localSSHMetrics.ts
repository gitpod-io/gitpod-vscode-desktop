/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addCounter } from '../common/metrics';
import { ILogService } from './logService';

export class LocalSSHMetricsReporter {

    constructor(
        private readonly logService: ILogService,
    ) { }

    reportConfigStatus(gitpodHost: string, status: 'success' | 'failure', failureCode?: string) {
        if (status === 'success') {
            failureCode = 'None';
        }
        addCounter(gitpodHost, 'vscode_desktop_local_ssh_config_total', { status, failure_code: failureCode ?? 'Unknown' }, 1, this.logService)
            .catch(e => this.logService.error('Error while reporting metrics', e));
    }

    reportPingExtensionStatus(gitpodHost: string, status: 'success' | 'failure') {
        addCounter(gitpodHost, 'vscode_desktop_ping_extension_server_total', { status }, 1, this.logService)
            .catch(e => this.logService.error('Error while reporting metrics', e));
    }

    reportConnectionStatus(gitpodHost: string, phase: 'connected' | 'connecting' | 'failed', failureCode?: string) {
        if (phase === 'connecting' || phase === 'connected') {
            failureCode = 'None';
        }
        addCounter(gitpodHost, 'vscode_desktop_local_ssh_total', { phase, failure_code: failureCode ?? 'Unknown' }, 1, this.logService)
            .catch(e => this.logService.error('Error while reporting metrics', e));
    }
}
