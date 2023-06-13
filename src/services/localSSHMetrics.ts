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

    async reportConfigStatus(gitpodHost: string, status: 'success' | 'failure', failureCode?: string): Promise<void> {
        if (status === 'success') {
            failureCode = 'None';
        }
        return addCounter(gitpodHost, 'vscode_desktop_local_ssh_config_total', { status, failure_code: failureCode ?? 'Unknown' }, 1, this.logService);
    }

    async reportPingExtensionStatus(gitpodHost: string, status: 'success' | 'failure'): Promise<void> {
        return addCounter(gitpodHost, 'vscode_desktop_ping_extension_server_total', { status }, 1, this.logService);
    }

    async reportConnectionStatus(gitpodHost: string, phase: 'connected' | 'connecting' | 'failed', failureCode?: string): Promise<void> {
        if (phase === 'connecting' || phase === 'connected') {
            failureCode = 'None';
        }
        return addCounter(gitpodHost, 'vscode_desktop_local_ssh_total', { phase, failure_code: failureCode ?? 'Unknown' }, 1, this.logService);
    }
}
