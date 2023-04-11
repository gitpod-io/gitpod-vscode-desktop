/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AppenderData, BaseTelemetryAppender, BaseTelemetryClient, BaseTelemetryReporter, RawTelemetryEventProperties, TelemetryEventProperties } from '../common/telemetry';
import { Analytics } from '@segment/analytics-node';
import * as os from 'os';
import * as vscode from 'vscode';
import { Configuration } from '../configuration';

const analyticsClientFactory = async (key: string, logger: vscode.LogOutputChannel): Promise<BaseTelemetryClient> => {
	let segmentAnalyticsClient = new Analytics({ writeKey: key });

	// Sets the analytics client into a standardized form
	const telemetryClient: BaseTelemetryClient = {
		logEvent: (eventName: string, data?: AppenderData) => {
			try {
				segmentAnalyticsClient.track({
					anonymousId: vscode.env.machineId,
					event: eventName,
					properties: data?.properties
				}, (err: any) => {
					if (err) {
						logger.error('Failed to log event to app analytics:', err);
					}
				});
			} catch (e: any) {
				logger.error('Failed to log event to app analytics:', e);
			}
		},
		logException: (exception: Error, data?: AppenderData) => {
			const gitpodHost = Configuration.getGitpodHost();
			const serviceUrl = new URL(gitpodHost);
			const errorMetricsEndpoint = `https://ide.${serviceUrl.hostname}/metrics-api/reportError`;

			const properties: { [key: string]: any } = Object.assign({}, data?.properties);
			properties['error_name'] = exception.name;
			properties['error_message'] = exception.message;
			properties['debug_workspace'] = String(properties['debug_workspace'] ?? false);

			const workspaceId = properties['workspaceId'] ?? '';
			const instanceId = properties['instanceId'] ?? '';
			const userId = properties['userId'] ?? '';

			delete properties['workspaceId'];
			delete properties['instanceId'];
			delete properties['userId'];

			const jsonData = {
				component: 'vscode-desktop-extension',
				errorStack: exception.stack ?? String(exception),
				version: properties['common.extversion'],
				workspaceId,
				instanceId,
				userId,
				properties,
			};
			const isProduction = properties['common.isproduction'] === true;
			if (!isProduction && serviceUrl.hostname === 'gitpod.io') {
				logger.error('Error reported to metrics endpoint:', jsonData);
				return;
			}
			fetch(errorMetricsEndpoint, {
				method: 'POST',
				body: JSON.stringify(jsonData),
				headers: {
					'Content-Type': 'application/json',
				},
			}).then((resp) => {
				if (!resp.ok) {
					logger.warn(`Metrics endpoint responded with ${resp.status} ${resp.statusText}`);
				}
			}).catch((e) => {
				logger.error('Failed to report error to metrics endpoint!', e);
			});
		},
		flush: async () => {
			try {
				await segmentAnalyticsClient.closeAndFlush({ timeout: 3000 });
			} catch (e: any) {
				logger.error('Failed to flush app analytics!', e);
			}
		}
	};
	return telemetryClient;
};

interface TelemetryOptions {
	gitpodHost?: string;
	gitpodVersion?: string;

	workspaceId?: string;
	instanceId?: string;

	userId?: string;

	[prop: string]: any;
}

export interface UserFlowTelemetry extends TelemetryOptions {
	flow: string;
}

export interface ITelemetryService {
	sendTelemetryEvent(eventName: string, properties?: TelemetryEventProperties): void;
	sendRawTelemetryEvent(eventName: string, properties?: RawTelemetryEventProperties): void;
	sendTelemetryException(error: Error, properties?: TelemetryEventProperties): void;

	sendUserFlowStatus(status: string, flow: UserFlowTelemetry): void;
}

export class TelemetryService extends BaseTelemetryReporter implements ITelemetryService {
	constructor(extensionId: string, extensionVersion: string, key: string, logger: vscode.LogOutputChannel, isProduction: boolean) {
		const appender = new BaseTelemetryAppender(key, (key) => analyticsClientFactory(key, logger));
		super(extensionId, extensionVersion, appender, {
			release: os.release(),
			platform: os.platform(),
			architecture: os.arch(),
		}, isProduction);
	}

	sendUserFlowStatus(status: string, flow: UserFlowTelemetry): void {
		const properties: TelemetryOptions = { ...flow, status };
		delete properties['flow'];
		this.sendRawTelemetryEvent('vscode_desktop_' + flow.flow, properties);
	}
}
