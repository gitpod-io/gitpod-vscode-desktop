/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import { Analytics, AnalyticsSettings } from '@segment/analytics-node';
import { ILogService } from '../services/logService';
import { cloneAndChange, escapeRegExpCharacters, isBuiltFromGHA, mixin } from '../common/utils';
import fetch from 'node-fetch-commonjs';

export const TRUSTED_VALUES = new Set([
	'gitpodHost',
	'sessionScopes'
]);

export interface TelemetryEventProperties {
	gitpodHost: string;

	[key: string]: any;
}

export interface UserFlowTelemetryProperties {
	flow: string;

	gitpodHost: string;

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

export function createSegmentAnalyticsClient(settings: AnalyticsSettings, gitpodHost: string, logService: ILogService): Analytics | undefined {
	const serviceUrl = new URL(gitpodHost);

	const updatedSettings: AnalyticsSettings = {
		...settings,
		// in dev mode we report directly to IDE playground source
		host: 'https://api.segment.io',
		path: '/v1/batch'
	};
	if (isBuiltFromGHA) {
		updatedSettings.host = gitpodHost;
		updatedSettings.path = '/analytics/v1/batch';
	} else {
		if (serviceUrl.host !== 'gitpod.io' && !serviceUrl.host.endsWith('.gitpod-dev.com')) {
			logService.error(`No telemetry: dedicated installations should send data always to own endpoints, host: ${serviceUrl.host}`);
			return undefined;
		}
	}

	const client = new Analytics(updatedSettings);
	return client;
}


function getErrorMetricsEndpoint(gitpodHost: string): string {
	try {
		const serviceUrl = new URL(gitpodHost);
		return `https://ide.${serviceUrl.hostname}/metrics-api/reportError`;
	} catch {
		throw new Error(`Invalid URL: ${gitpodHost}`);
	}
}

export async function commonSendEventData(logService: ILogService, segmentClient: Analytics | undefined, machineId: string, eventName: string, data?: any): Promise<void> {
	const properties = data ?? {};

	delete properties['gitpodHost'];

	logService.trace('[TELEMETRY]', eventName, properties);

	if (!segmentClient) {
		return;
	}
	return new Promise((resolve) =>
		segmentClient.track({
			anonymousId: machineId,
			event: eventName,
			properties
		}, (err) => {
			if (err) {
				logService.error('Failed to log event to app analytics:', err);
			}
			resolve();
		}));
}

interface SendErrorDataOptions {
	cleanupPatterns: RegExp[];
	commonProperties: Record<string, any>;
	isTrustedValue: isTrustedValueFunc;
}

export function getCleanupPatterns(piiPaths: string[]) {
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
	return cleanupPatterns;
}

export function commonSendErrorData(logService: ILogService, defaultGitpodHost: string, error: Error, data: any | undefined, options: SendErrorDataOptions) {
	const { cleanupPatterns, commonProperties, isTrustedValue } = options;
	let properties = cleanData(data ?? {}, cleanupPatterns, isTrustedValue);
	properties = mixin(properties, commonProperties);
	const errorProps = cleanData({ message: error.message, stack: error.stack }, cleanupPatterns, isTrustedValue);

	// Unhandled errors have no data so use host from config
	const gitpodHost = properties['gitpodHost'] ?? defaultGitpodHost;
	const errorMetricsEndpoint = getErrorMetricsEndpoint(gitpodHost);

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

	// make sure all properties are strings
	for (const key in properties) {
		if (typeof properties[key] !== 'string') {
			properties[key] = JSON.stringify(properties[key]);
		}
	}

	const jsonData = {
		component: 'vscode-desktop-extension',
		errorStack: errorProps.stack || '',
		version: properties['common.extversion'],
		workspaceId,
		instanceId,
		userId,
		properties,
	};

	if (!isBuiltFromGHA) {
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
}


//#region Telemetry Cleaning

// Remove when upstream TODO is addressed
// https://github.com/microsoft/vscode/blob/44ef5cc53127cbaa11dee1728bdf8c24522f8fa0/src/vs/workbench/api/common/extHostTelemetry.ts#L278-L279

export function getBaseProperties() {
	const commonProperties = Object.create(null);
	commonProperties['common.os'] = os.platform();
	commonProperties['common.nodeArch'] = os.arch();
	commonProperties['common.platformversion'] = os.release().replace(/^(\d+)(\.\d+)?(\.\d+)?(.*)/, '$1$2$3');
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

type isTrustedValueFunc = (value: any) => boolean;

export function cleanData(data: Record<string, any>, cleanUpPatterns: RegExp[], isTrustedValue: isTrustedValueFunc): Record<string, any> {
	return cloneAndChange(data, value => {

		// If it's a trusted value it means it's okay to skip cleaning so we don't clean it
		if (isTrustedValue(value)) {
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
