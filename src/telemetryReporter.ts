/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AppenderData, BaseTelemetryAppender, BaseTelemetryClient, BaseTelemetryReporter } from './common/telemetry';
import SegmentAnalytics from 'analytics-node';
import * as os from 'os';
import * as vscode from 'vscode';

const analyticsClientFactory = async (key: string): Promise<BaseTelemetryClient> => {
	let segmentAnalyticsClient = new SegmentAnalytics(key);

	const gitpodHost = vscode.workspace.getConfiguration('gitpod').get<string>('host')!;
	const serviceUrl = new URL(gitpodHost);
	const errorMetricsEndpoint = `https://ide.${serviceUrl.hostname}/metrics-api/reportError`;

	// Sets the analytics client into a standardized form
	const telemetryClient: BaseTelemetryClient = {
		logEvent: (eventName: string, data?: AppenderData) => {
			try {
				segmentAnalyticsClient.track({
					anonymousId: vscode.env.machineId,
					event: eventName,
					properties: data?.properties
				});
			} catch (e: any) {
				console.error('Failed to log event to app analytics!', e);
			}
		},
		logException: async (exception: Error, data?: AppenderData) => {
			const properties: { [key: string]: any } = Object.assign({}, data?.properties);
			properties['error_name'] = exception.name;
			properties['error_message'] = exception.message;
			properties['debug_workspace'] = String(false);

			const workspaceId  = properties['workspaceId'] || '';
			delete properties['workspaceId'];
			const instanceId  = properties['instanceId'] || '';
			delete properties['instanceId'];
			const userId = properties['userId'] || '';
			delete properties['userId'];

			const jsonData = {
				component: 'vscode-desktop-extension',
				errorStack: exception.stack ?? String(exception),
				workspaceId,
				instanceId,
				userId,
				properties,
			};
			try {
				const resp = await fetch(errorMetricsEndpoint, {
					method: 'POST',
					body: JSON.stringify(jsonData),
					headers: {
						'Content-Type': 'application/json',
					},
				});
				if (!resp.ok) {
					throw new Error(`Metrics endpoint responded with ${resp.status} ${resp.statusText}`);
				}
			} catch (e: any) {
				console.error('Failed to report error to metrics endpoint!', e);
			}
		},
		flush: async () => {
			try {
				await segmentAnalyticsClient.flush();
			} catch (e: any) {
				console.error('Failed to flush app analytics!', e);
			}
		}
	};
	return telemetryClient;
};

export default class TelemetryReporter extends BaseTelemetryReporter {
	constructor(extensionId: string, extensionVersion: string, key: string) {
		const appender = new BaseTelemetryAppender(key, (key) => analyticsClientFactory(key));
		super(extensionId, extensionVersion, appender, {
			release: os.release(),
			platform: os.platform(),
			architecture: os.arch(),
		});
	}
}
