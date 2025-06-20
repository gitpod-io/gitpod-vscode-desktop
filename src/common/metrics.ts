/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../services/logService';
import { unwrapFetchError } from './fetch';
import { isBuiltFromGHA } from './utils';

const metricsHostMap = new Map<string, string>();

export async function addCounter(gitpodHost: string, name: string, labels: Record<string, string>, value: number, logService: ILogService) {
    const data = {
        name,
        labels,
        value,
    };
    if (!isBuiltFromGHA) {
        logService.trace('Local metrics add counter', data);
        return;
    }
    const metricsHost = getMetricsHost(gitpodHost);

    let resp: Response;
    try {
        resp = await fetch(
            `https://${metricsHost}/metrics-api/metrics/counter/add/${name}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Client': 'vscode-desktop-extension'
                },
                body: JSON.stringify(data)
            }
        );
    } catch (e) {
        throw unwrapFetchError(e);
    }

    if (!resp.ok) {
        throw new Error(`Metrics endpoint responded with ${resp.status} ${resp.statusText}`);
    }
}

export async function addHistogram(gitpodHost: string, name: string, labels: Record<string, string>, count: number, sum: number, buckets: number[], logService: ILogService) {
    const data = {
        name,
        labels,
        count,
        sum,
        buckets,
    };
    if (!isBuiltFromGHA) {
        logService.trace('Local metrics add histogram', data);
        return;
    }
    const metricsHost = getMetricsHost(gitpodHost);

    let resp: Response;
    try {
        resp = await fetch(
            `https://${metricsHost}/metrics-api/metrics/histogram/add/${name}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Client': 'vscode-desktop-extension'
                },
                body: JSON.stringify(data)
            }
        );
    } catch (e) {
        throw unwrapFetchError(e);
    }

    if (!resp.ok) {
        throw new Error(`Metrics endpoint responded with ${resp.status} ${resp.statusText}`);
    }
}

function getMetricsHost(gitpodHost: string): string {
    if (metricsHostMap.has(gitpodHost)) {
        return metricsHostMap.get(gitpodHost)!;
    }
    const serviceUrl = new URL(gitpodHost);
    const metricsHost = `ide.${serviceUrl.hostname}`;
    metricsHostMap.set(gitpodHost, metricsHost);
    return metricsHost;
}
