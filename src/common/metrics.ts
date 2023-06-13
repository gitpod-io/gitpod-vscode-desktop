/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export async function addCounter(metricsHost: string, name: string, labels: Record<string, string>, value: number) {
    const data = {
        name,
        labels,
        value,
    };

    const resp = await fetch(
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

    if (!resp.ok) {
        throw new Error(`Metrics endpoint responded with ${resp.status} ${resp.statusText}`);
    }
}

export async function addHistogram(metricsHost: string, name: string, labels: Record<string, string>, count: number, sum: number, buckets: number[]) {
    const data = {
        name,
        labels,
        count,
        sum,
        buckets,
    };

    const resp = await fetch(
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

    if (!resp.ok) {
        throw new Error(`Metrics endpoint responded with ${resp.status} ${resp.statusText}`);
    }
}

export function getMetricsHost(gitpodHost: string): string {
    const serviceUrl = new URL(gitpodHost);
    return `ide.${serviceUrl.hostname}`;
}