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
import { cloneAndChange, escapeRegExpCharacters } from '../common/utils';

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

	constructor(segmentKey: string, piiPaths: string[], private readonly logService: ILogService) {
		super();

		// static cleanup pattern for: `vscode-file:///DANGEROUS/PATH/resources/app/Useful/Information`
		const cleanupPatterns = [/(vscode-)?file:\/\/\/.*?\/resources\/app\//gi];

		piiPaths.push(vscode.env.appRoot);
		piiPaths.push(os.tmpdir());
		piiPaths.push(os.homedir());
		for (const piiPath of piiPaths) {
			cleanupPatterns.push(new RegExp(escapeRegExpCharacters(piiPath), 'gi'));

			if (piiPath.indexOf('\\') >= 0) {
				cleanupPatterns.push(new RegExp(escapeRegExpCharacters(piiPath.replace(/\\/g, '/')), 'gi'));
			}
		}

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
					const properties = cleanData(data ?? {}, cleanupPatterns);
					const errorProps = cleanData({ stack: error.stack }, cleanupPatterns);

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
						errorStack: errorProps.stack || String(error),
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

//#region Telemetry Cleaning

// Remove when upstream TODO is addressed
// https://github.com/microsoft/vscode/blob/44ef5cc53127cbaa11dee1728bdf8c24522f8fa0/src/vs/workbench/api/common/extHostTelemetry.ts#L278-L279

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


function cleanData(data: Record<string, any>, cleanUpPatterns: RegExp[]): Record<string, any> {
	return cloneAndChange(data, value => {

		// If it's a trusted value it means it's okay to skip cleaning so we don't clean it
		if (value instanceof vscode.TelemetryTrustedValue || Object.hasOwnProperty.call(value, 'isTrustedTelemetryValue')) {
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
