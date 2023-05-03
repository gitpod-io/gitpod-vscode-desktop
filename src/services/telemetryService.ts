/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AppenderData, BaseTelemetryClient, BaseTelemetryReporter, RawTelemetryEventProperties, TelemetryEventProperties } from '../common/telemetry';
import { Analytics, AnalyticsSettings } from '@segment/analytics-node';
import * as os from 'os';
import * as vscode from 'vscode';

const analyticsClientFactory = async (gitpodHost: string, segmentKey: string, logger: vscode.LogOutputChannel): Promise<BaseTelemetryClient> => {
	const serviceUrl = new URL(gitpodHost);

	const settings: AnalyticsSettings = {
		writeKey: segmentKey,
		// in dev mode we report directly to IDE playground source
		host: 'https://api.segment.io',
		path: '/v1/batch'
	};
	if (segmentKey === 'untrusted-dummy-key') {
		settings.host = gitpodHost;
		settings.path = '/analytics' + settings.path;
	} else {
		if (serviceUrl.host !== 'gitpod.io' && !serviceUrl.host.endsWith('.gitpod-dev.com')) {
			logger.warn(`No telemetry: dedicated installations should send data always to own endpoints, host: ${serviceUrl.host}`);
			return {
				logEvent: () => { },
				logException: () => { },
				flush: () => { },
			};
		}
	}
	logger.debug('analytics: ' + new URL(settings.path!, settings.host).href.replace(/\/$/, '')); // aligned with how segment does it internally

	const errorMetricsEndpoint = `https://ide.${serviceUrl.hostname}/metrics-api/reportError`;

	const segmentAnalyticsClient = new Analytics(settings);
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
				errorStack: exception.stack || String(exception),
				version: properties['common.extversion'],
				workspaceId,
				instanceId,
				userId,
				properties,
			};
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
	gitpodHost: string;
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
	sendTelemetryEvent(gitpodHost: string, eventName: string, properties?: TelemetryEventProperties): void;
	sendRawTelemetryEvent(gitpodHost: string, eventName: string, properties?: RawTelemetryEventProperties): void;
	sendTelemetryException(gitpodHost: string, error: Error, properties?: TelemetryEventProperties): void;

	sendUserFlowStatus(status: string, flow: UserFlowTelemetry): void;
}

export class TelemetryService extends BaseTelemetryReporter implements ITelemetryService {
	constructor(extensionId: string, extensionVersion: string, segmentKey: string, logger: vscode.LogOutputChannel) {
		super(extensionId, extensionVersion, {
			release: os.release(),
			platform: os.platform(),
			architecture: os.arch(),
		}, gitpodHost => analyticsClientFactory(gitpodHost, segmentKey, logger));
	}

	sendUserFlowStatus(status: string, flow: UserFlowTelemetry): void {
		const properties: Partial<TelemetryOptions> = { ...flow, status };
		delete properties['flow'];
		delete properties['gitpodHost'];
		this.sendRawTelemetryEvent(flow.gitpodHost, 'vscode_desktop_' + flow.flow, properties);
	}
}
