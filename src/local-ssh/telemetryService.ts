/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import { Analytics, AnalyticsSettings } from '@segment/analytics-node';
import { cloneAndChange, escapeRegExpCharacters, mixin } from '../common/utils';
import { ILogService } from '../services/logService';
import { getDaemonVersion, getSegmentKey } from './utils';

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

export class TelemetryService implements ITelemetryService {
	private segmentClient: Analytics | undefined;
	private cleanupPatterns: RegExp[] = [];
	private commonProperties: any;
	private readonly segmentKey: string;

	constructor(
		private readonly machineId: string,
		private readonly gitpodHost: string,
		private readonly logService: ILogService,
	) {
		this.segmentKey = getSegmentKey();
		const piiPaths: string[] = [];
		this.segmentClient = this.getSegmentAnalyticsClient(gitpodHost, this.segmentKey);

		// static cleanup pattern for: `vscode-file:///DANGEROUS/PATH/resources/app/Useful/Information`
		const cleanupPatterns = [/(vscode-)?file:\/\/\/.*?\/resources\/app\//gi];

		piiPaths.push(os.tmpdir());
		piiPaths.push(os.homedir());
		for (const piiPath of piiPaths) {
			cleanupPatterns.push(new RegExp(escapeRegExpCharacters(piiPath), 'gi'));

			if (piiPath.indexOf('\\') >= 0) {
				cleanupPatterns.push(new RegExp(escapeRegExpCharacters(piiPath.replace(/\\/g, '/')), 'gi'));
			}
		}

		const commonProperties = getCommonProperties(machineId);

		this.cleanupPatterns = cleanupPatterns;
		this.commonProperties = commonProperties;
	}

	sendEventData(eventName: string, data?: Record<string, any>) {

		const idx = eventName.indexOf('/');
		eventName = eventName.substring(idx + 1);

		const properties = mixin(cleanData(data ?? {}, this.cleanupPatterns), this.commonProperties);

		const gitpodHost: string | undefined = properties['gitpodHost'];
		if (!gitpodHost) {
			this.logService.error(`Missing 'gitpodHost' property in event ${eventName}`);
			return;
		}

		if (this.segmentKey !== ProductionUntrustedSegmentKey) {
			this.logService.debug('Local event report', eventName, properties);
			return;
		}
		delete properties['gitpodHost'];
		this.segmentClient?.track({
			anonymousId: this.machineId,
			event: eventName,
			properties
		}, (err) => {
			if (err) {
				this.logService.error('Failed to log event to app analytics:', err);
			}
		});
	}

	sendErrorData(error: Error, data?: Record<string, any>) {
		const properties = mixin(cleanData(data ?? {}, this.cleanupPatterns), this.commonProperties);
		const errorProps = cleanData({ message: error.message, stack: error.stack }, this.cleanupPatterns);

		// Unhandled errors have no data so use host from config
		const gitpodHost = properties['gitpodHost'] ?? this.gitpodHost;
		const errorMetricsEndpoint = this.getErrorMetricsEndpoint(gitpodHost);

		properties['error_name'] = error.name;
		properties['error_message'] = errorProps.message;
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
			errorStack: errorProps.stack || '',
			version: properties['common.extversion'],
			workspaceId,
			instanceId,
			userId,
			properties,
		};

		if (this.segmentKey !== ProductionUntrustedSegmentKey) {
			this.logService.debug('Local error report', jsonData);
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
				this.logService.error(`Metrics endpoint responded with ${resp.status} ${resp.statusText}`);
			}
		}).catch((e) => {
			this.logService.error('Failed to report error to metrics endpoint!', e);
		});
	}

	async flush() {
		try {
			await this.segmentClient?.closeAndFlush({ timeout: 3000 });
		} catch (e: any) {
			this.logService.error('Failed to flush app analytics!', e);
		}
	}

	private getSegmentAnalyticsClient(gitpodHost: string, segmentKey: string): Analytics | undefined {
		const serviceUrl = new URL(gitpodHost);

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
		return client;
	}

	private getErrorMetricsEndpoint(gitpodHost: string): string {
		const serviceUrl = new URL(gitpodHost);
		return `https://ide.${serviceUrl.hostname}/metrics-api/reportError`;
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

//#region Telemetry Cleaning

// Remove when upstream TODO is addressed
// https://github.com/microsoft/vscode/blob/44ef5cc53127cbaa11dee1728bdf8c24522f8fa0/src/vs/workbench/api/common/extHostTelemetry.ts#L278-L279

function getCommonProperties(machineId: string) {
	const commonProperties = Object.create(null);
	commonProperties['common.os'] = os.platform();
	commonProperties['common.nodeArch'] = os.arch();
	commonProperties['common.platformversion'] = os.release().replace(/^(\d+)(\.\d+)?(\.\d+)?(.*)/, '$1$2$3');
	commonProperties['common.vscodemachineid'] = machineId;
	commonProperties['common.proxyversion'] = getDaemonVersion();
	return commonProperties;
}

function anonymizeFilePaths(stack: string, cleanupPatterns: RegExp[]): string {

	// Fast check to see if it is a file path to avoid doing unnecessary heavy regex work
	if (!stack || (!stack.includes('/') && !stack.includes('\\'))) {
		return stack;
	}

	let updatedStack = stack;

	const cleanUpIndexes: [number, number][] = [];
	for (const regexp of cleanupPatterns) {
		while (true) {
			const result = regexp.exec(stack);
			if (!result) {
				break;
			}
			cleanUpIndexes.push([result.index, regexp.lastIndex]);
		}
	}

	const nodeModulesRegex = /^[\\\/]?(node_modules|node_modules\.asar)[\\\/]/;
	const fileRegex = /(file:\/\/)?([a-zA-Z]:(\\\\|\\|\/)|(\\\\|\\|\/))?([\w-\._]+(\\\\|\\|\/))+[\w-\._]*/g;
	let lastIndex = 0;
	updatedStack = '';

	while (true) {
		const result = fileRegex.exec(stack);
		if (!result) {
			break;
		}

		// Check to see if the any cleanupIndexes partially overlap with this match
		const overlappingRange = cleanUpIndexes.some(([start, end]) => result.index < end && start < fileRegex.lastIndex);

		// anoynimize user file paths that do not need to be retained or cleaned up.
		if (!nodeModulesRegex.test(result[0]) && !overlappingRange) {
			updatedStack += stack.substring(lastIndex, result.index) + '<REDACTED: user-file-path>';
			lastIndex = fileRegex.lastIndex;
		}
	}
	if (lastIndex < stack.length) {
		updatedStack += stack.substr(lastIndex);
	}

	return updatedStack;
}

function removePropertiesWithPossibleUserInfo(property: string): string {
	// If for some reason it is undefined we skip it (this shouldn't be possible);
	if (!property) {
		return property;
	}

	const userDataRegexes = [
		{ label: 'Google API Key', regex: /AIza[A-Za-z0-9_\\\-]{35}/ },
		{ label: 'Slack Token', regex: /xox[pbar]\-[A-Za-z0-9]/ },
		{ label: 'Generic Secret', regex: /(key|token|sig|secret|signature|password|passwd|pwd|android:value)[^a-zA-Z0-9]/i },
		{ label: 'Email', regex: /@[a-zA-Z0-9-]+\.[a-zA-Z0-9-]+/ } // Regex which matches @*.site
	];

	// Check for common user data in the telemetry events
	for (const secretRegex of userDataRegexes) {
		if (secretRegex.regex.test(property)) {
			return `<REDACTED: ${secretRegex.label}>`;
		}
	}

	return property;
}

class TelemetryTrustedValue {
	constructor(public value: any, public isTrustedTelemetryValue: boolean = true) {}
}


function cleanData(data: Record<string, any>, cleanUpPatterns: RegExp[]): Record<string, any> {
	return cloneAndChange(data, value => {

		// If it's a trusted value it means it's okay to skip cleaning so we don't clean it
		if (value instanceof TelemetryTrustedValue || Object.hasOwnProperty.call(value, 'isTrustedTelemetryValue')) {
			return value.value;
		}

		// We only know how to clean strings
		if (typeof value === 'string') {
			let updatedProperty = value.replaceAll('%20', ' ');

			// First we anonymize any possible file paths
			updatedProperty = anonymizeFilePaths(updatedProperty, cleanUpPatterns);

			// Then we do a simple regex replace with the defined patterns
			for (const regexp of cleanUpPatterns) {
				updatedProperty = updatedProperty.replace(regexp, '');
			}

			// Lastly, remove commonly leaked PII
			updatedProperty = removePropertiesWithPossibleUserInfo(updatedProperty);

			return updatedProperty;
		}
		return undefined;
	});
}

//#endregion
