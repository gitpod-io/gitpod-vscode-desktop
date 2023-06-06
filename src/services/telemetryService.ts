/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as vscode from 'vscode';
import { Analytics } from '@segment/analytics-node';
import { Disposable } from '../common/dispose';
import { Configuration } from '../configuration';
import { ILogService } from './logService';
import { ITelemetryService, TelemetryEventProperties, UserFlowTelemetryProperties, createSegmentAnalyticsClient, getBaseProperties, commonSendErrorData, commonSendEventData, getCleanupPatterns, TRUSTED_VALUES } from '../common/telemetry';

export class TelemetryService extends Disposable implements ITelemetryService {
	private analitycsClients: Map<string, Analytics> = new Map();
	private telemetryLogger: vscode.TelemetryLogger;

	constructor(extensionId: string, extensionVersion: string, segmentKey: string, piiPaths: string[], private readonly logService: ILogService) {
		super();

		piiPaths.push(vscode.env.appRoot);
		const cleanupPatterns = getCleanupPatterns(piiPaths);
		const commonProperties = getCommonProperties(extensionId, extensionVersion);

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

					commonSendEventData(logService, segmentKey, this.getSegmentAnalyticsClient(gitpodHost, segmentKey), vscode.env.machineId, eventName, data);
				},
				sendErrorData: (error, data) => {
					commonSendErrorData(logService, segmentKey, Configuration.getGitpodHost(), error, data, {
						cleanupPatterns,
						commonProperties,
						isTrustedValue: isVSCodeTrustedValue,
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
		const client = createSegmentAnalyticsClient({ writeKey: segmentKey }, gitpodHost, this.logService);
		if (!client) {
			return undefined;
		}
		this.analitycsClients.set(serviceUrl.host, client);
		return client;
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


function getCommonProperties(extensionId: string, extensionVersion: string) {
	const properties = getBaseProperties();
	properties['common.extname'] = extensionId;
	properties['common.extversion'] = extensionVersion;
	if (vscode && vscode.env) {
		properties['common.vscodemachineid'] = vscode.env.machineId;
		properties['common.vscodesessionid'] = vscode.env.sessionId;
		properties['common.vscodeversion'] = vscode.version;
		properties['common.product'] = vscode.env.appHost;
		properties['common.uikind'] = vscode.env.uiKind;
		switch (vscode.env.uiKind) {
			case vscode.UIKind.Web:
				properties['common.uikind'] = 'web';
				break;
			case vscode.UIKind.Desktop:
				properties['common.uikind'] = 'desktop';
				break;
			default:
				properties['common.uikind'] = 'unknown';
		}
	}
	return properties;
}

function isVSCodeTrustedValue(value: any): boolean {
	// If it's a trusted value it means it's okay to skip cleaning so we don't clean it
	return value instanceof vscode.TelemetryTrustedValue || Object.hasOwnProperty.call(value, 'isTrustedTelemetryValue');
}
