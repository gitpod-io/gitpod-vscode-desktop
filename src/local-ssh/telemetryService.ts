/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Analytics } from '@segment/analytics-node';
import { ILogService } from '../services/logService';
import { ITelemetryService, TelemetryEventProperties, UserFlowTelemetryProperties, createSegmentAnalyticsClient, getBaseProperties, commonSendErrorData, commonSendEventData, getCleanupPatterns, TRUSTED_VALUES } from '../common/telemetry';

export class TelemetryService implements ITelemetryService {
	private segmentClient: Analytics | undefined;
	private cleanupPatterns: RegExp[] = [];
	private commonProperties: any;

	constructor(
		private readonly segmentKey: string,
		readonly machineId: string,
		readonly extensionId: string,
		readonly extensionVersion: string,
		private readonly gitpodHost: string,
		private readonly logService: ILogService,
	) {
		this.segmentClient = createSegmentAnalyticsClient({ writeKey: this.segmentKey, maxEventsInBatch: 1 }, gitpodHost, this.logService);
		this.cleanupPatterns = getCleanupPatterns([]);
		const commonProperties = getCommonProperties(machineId, extensionId, extensionVersion);
		this.commonProperties = commonProperties;
	}

	sendEventData(eventName: string, data?: Record<string, any>) {
		commonSendEventData(this.logService, this.segmentKey, this.segmentClient, this.machineId, eventName, data);
	}

	sendErrorData(error: Error, data?: Record<string, any>) {
		commonSendErrorData(this.logService, this.segmentKey, this.gitpodHost, error, data, {
			cleanupPatterns: this.cleanupPatterns,
			commonProperties: this.commonProperties,
			isTrustedValue: (value) => {
				return value instanceof TelemetryTrustedValue || Object.hasOwnProperty.call(value, 'isTrustedTelemetryValue');
			}
		});
	}

	async flush() {
		try {
			await this.segmentClient?.closeAndFlush({ timeout: 3000 });
		} catch (e: any) {
			this.logService.error('Failed to flush app analytics!', e);
		}
	}

	sendTelemetryEvent(eventName: string, properties?: TelemetryEventProperties): void {
		const props = properties ? Object.fromEntries(Object.entries(properties).map(([k, v]) => [k, TRUSTED_VALUES.has(k) ? new TelemetryTrustedValue(v) : v])) : undefined;
		this.sendEventData(eventName, props);
	}

	sendTelemetryException(error: Error, properties?: TelemetryEventProperties): void {
		const props = properties ? Object.fromEntries(Object.entries(properties).map(([k, v]) => [k, TRUSTED_VALUES.has(k) ? new TelemetryTrustedValue(v) : v])) : undefined;
		this.sendErrorData(error, props);
	}

	sendUserFlowStatus(status: string, flowProperties: UserFlowTelemetryProperties): void {
		const properties: TelemetryEventProperties = { ...flowProperties, status };
		delete properties['flow'];
		this.sendTelemetryEvent('vscode_desktop_' + flowProperties.flow, properties);
	}
}

function getCommonProperties(machineId: string, extensionId: string, extensionVersion: string) {
	const properties = getBaseProperties();
	properties['common.vscodemachineid'] = machineId;
	properties['common.extname'] = extensionId;
	properties['common.extversion'] = extensionVersion;
	return properties;
}

class TelemetryTrustedValue {
	constructor(public value: any, public isTrustedTelemetryValue: boolean = true) { }
}
