/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as vscode from 'vscode';
import { Analytics, AnalyticsSettings } from '@segment/analytics-node';
import { Disposable } from '../common/dispose';
import { Configuration } from '../configuration';
import { ILogService } from './logService';

const ProductionUntrustedSegmentKey = 'untrusted-dummy-key';

export interface TelemetryEventProperties {
	gitpodHost: string;

	[key: string]: any;
}

export interface UserFlowTelemetryProperties {
	flow: string;

	gitpodHost: string;
	gitpodVersion?: string;

	workspaceId?: string;
	instanceId?: string;

	userId?: string;

	[key: string]: any;
}

export interface ITelemetryService {
	sendTelemetryEvent(eventName: string, properties?: TelemetryEventProperties): void;
	sendTelemetryException(error: Error, properties?: TelemetryEventProperties): void;

	sendUserFlowStatus(status: string, flow: UserFlowTelemetryProperties): void;
}

const TRUSTED_VALUES = new Set([
	'gitpodHost'
]);

export class TelemetryService extends Disposable implements ITelemetryService {
	private analitycsClients: Map<string, Analytics> = new Map();
	private telemetryLogger: vscode.TelemetryLogger;

	constructor(segmentKey: string, private readonly logService: ILogService) {
		super();

		this.telemetryLogger = this._register(vscode.env.createTelemetryLogger(
			{
				sendEventData: (eventName, data) => {
					const idx = eventName.indexOf('/');
					eventName = eventName.substring(idx + 1);

					const properties = data ?? {};

					const gitpodHost: string | undefined = properties['gitpodHost'];
					if (!gitpodHost) {
						logService.error(`Missing 'gitpodHost' property in event ${eventName}`);
						return;
					}

					delete properties['gitpodHost'];

					this.getSegmentAnalyticsClient(gitpodHost, segmentKey)?.track({
						anonymousId: vscode.env.machineId,
						event: eventName,
						properties
					}, (err) => {
						if (err) {
							logService.error('Failed to log event to app analytics:', err);
						}
					});
				},
				sendErrorData: (error, data) => {
					const properties = data ?? {};

					// Unhandled errors have no data so use host from config
					const gitpodHost = properties['gitpodHost'] ?? Configuration.getGitpodHost();
					const errorMetricsEndpoint = this.getErrorMetricsEndpoint(gitpodHost);

					properties['error_name'] = error.name;
					properties['error_message'] = error.message;
					properties['debug_workspace'] = String(properties['debug_workspace'] ?? false);

					const workspaceId = properties['workspaceId'] ?? '';
					const instanceId = properties['instanceId'] ?? '';
					const userId = properties['userId'] ?? '';

					delete properties['gitpodHost'];
					delete properties['workspaceId'];
					delete properties['instanceId'];
					delete properties['userId'];

					const jsonData = {
						component: 'vscode-desktop-extension',
						errorStack: error.stack || String(error),
						version: properties['common.extversion'],
						workspaceId,
						instanceId,
						userId,
						properties,
					};

					if (segmentKey !== ProductionUntrustedSegmentKey) {
						logService.trace('Local error report', jsonData);
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
							logService.error(`Metrics endpoint responded with ${resp.status} ${resp.statusText}`);
						}
					}).catch((e) => {
						logService.error('Failed to report error to metrics endpoint!', e);
					});
				},
				flush: async () => {
					try {
						const promises: Promise<void>[] = [];
						this.analitycsClients.forEach((c) => promises.push(c.closeAndFlush({ timeout: 3000 })));
						await Promise.allSettled(promises);
					} catch (e: any) {
						logService.error('Failed to flush app analytics!', e);
					}
				}
			},
			{
				additionalCommonProperties: {
					'common.os': os.platform(),
					'common.nodeArch': os.arch(),
					'common.platformversion': os.release().replace(/^(\d+)(\.\d+)?(\.\d+)?(.*)/, '$1$2$3'),
				}
			}
		));
	}

	private getSegmentAnalyticsClient(gitpodHost: string, segmentKey: string): Analytics | undefined {
		const serviceUrl = new URL(gitpodHost);
		if (this.analitycsClients.has(serviceUrl.host)) {
			return this.analitycsClients.get(serviceUrl.host)!;
		}

		const settings: AnalyticsSettings = {
			writeKey: segmentKey,
			// in dev mode we report directly to IDE playground source
			host: 'https://api.segment.io',
			path: '/v1/batch'
		};
		if (segmentKey === ProductionUntrustedSegmentKey) {
			settings.host = gitpodHost;
			settings.path = '/analytics' + settings.path;
		} else {
			if (serviceUrl.host !== 'gitpod.io' && !serviceUrl.host.endsWith('.gitpod-dev.com')) {
				this.logService.error(`No telemetry: dedicated installations should send data always to own endpoints, host: ${serviceUrl.host}`);
				return undefined;
			}
		}

		const client = new Analytics(settings);
		this.analitycsClients.set(serviceUrl.host, client);
		return client;
	}

	private getErrorMetricsEndpoint(gitpodHost: string): string {
		const serviceUrl = new URL(gitpodHost);
		return `https://ide.${serviceUrl.hostname}/metrics-api/reportError`;
	}

	sendTelemetryEvent(eventName: string, properties?: TelemetryEventProperties): void {
		const props = properties ? Object.fromEntries(Object.entries(properties).map(([k, v]) => [k, TRUSTED_VALUES.has(k) ? new vscode.TelemetryTrustedValue(v) : v])) : undefined;
		this.telemetryLogger.logUsage(eventName, props);
	}

	sendTelemetryException(error: Error, properties?: TelemetryEventProperties): void {
		const props = properties ? Object.fromEntries(Object.entries(properties).map(([k, v]) => [k, TRUSTED_VALUES.has(k) ? new vscode.TelemetryTrustedValue(v) : v])) : undefined;
		this.telemetryLogger.logError(error, props);
	}

	sendUserFlowStatus(status: string, flowProperties: UserFlowTelemetryProperties): void {
		const properties: TelemetryEventProperties = { ...flowProperties, status };
		delete properties['flow'];
		this.sendTelemetryEvent('vscode_desktop_' + flowProperties.flow, properties);
	}
}
