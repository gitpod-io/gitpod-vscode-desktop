/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as semver from 'semver';
import { retry } from './common/async';

export class GitpodVersion {
    static MAX_VERSION = '9999.99.99';
    static MIN_VERSION = '0.0.0';

    static Max = new GitpodVersion(GitpodVersion.MAX_VERSION);
    static Min = new GitpodVersion(GitpodVersion.MIN_VERSION);

    readonly version: string;
    readonly raw: string;

    constructor(gitpodVersion: string) {
        this.raw = gitpodVersion;
        this.version = GitpodVersion.MIN_VERSION;

        // Check for yyyy.mm.dd format
        const match = /(?:\.|-|^)(\d{4}\.\d{1,2}\.\d{1,2})(?:\.|-|$)/.exec(gitpodVersion);
        if (match) {
            // Remove leading zeros to make it a valid semver
            const [yy, mm, dd] = match[1].split('.');
            gitpodVersion = `${parseInt(yy, 10)}.${parseInt(mm, 10)}.${parseInt(dd, 10)}`;

        }

        if (semver.valid(gitpodVersion)) {
            this.version = gitpodVersion;
        }
    }
}

let cacheGitpodVersion: { host: string; version: GitpodVersion } | undefined;
async function getOrFetchVersionInfo(serviceUrl: string, logger: vscode.LogOutputChannel) {
    if (serviceUrl === 'https://gitpod.io') {
        // SaaS default allow all features, should proper handle SaaS feature support if needed in the future
        return {
            host: serviceUrl,
            version: GitpodVersion.Max,
        };
    }

    if (serviceUrl === cacheGitpodVersion?.host) {
        return cacheGitpodVersion;
    }

    const versionEndPoint = `${serviceUrl}/api/version`;
    let gitpodRawVersion: string | undefined;
    try {
        gitpodRawVersion = await retry(async () => {
            const controller = new AbortController();
            setTimeout(() => controller.abort(), 1500);
            const resp = await fetch(versionEndPoint, { signal: controller.signal });
            if (!resp.ok) {
                throw new Error(`Responded with ${resp.status} ${resp.statusText}`);
            }
            return resp.text();
        }, 1000, 3);
    } catch (e) {
        logger.error(`Error while fetching ${versionEndPoint}`, e);
    }

    if (!gitpodRawVersion) {
        logger.info(`Failed to fetch version from ${versionEndPoint}, some feature will be disabled`);
        return {
            host: serviceUrl,
            version: GitpodVersion.Min,
        };
    }

    logger.info(`Got version from: ${serviceUrl} version: ${gitpodRawVersion}`);

    cacheGitpodVersion = {
        host: serviceUrl,
        version: new GitpodVersion(gitpodRawVersion)
    };
    return cacheGitpodVersion;
}

export async function getGitpodVersion(gitpodHost: string, logger: vscode.LogOutputChannel) {
    const serviceUrl = new URL(gitpodHost).toString().replace(/\/$/, '');
    const versionInfo = await getOrFetchVersionInfo(serviceUrl, logger);
    return versionInfo.version;
}

type Feature = |
    'SSHPublicKeys' |
    'localHeartbeat';

export function isFeatureSupported(gitpodVersion: GitpodVersion, feature: Feature) {
    switch (feature) {
        case 'SSHPublicKeys':
        case 'localHeartbeat':
            return semver.gte(gitpodVersion.version, '2022.7.0'); // Don't use leading zeros
    }
}

export async function isOauthInspectSupported(gitpodHost: string,) {
    const serviceUrl = new URL(gitpodHost).toString().replace(/\/$/, '');
    const endpoint = `${serviceUrl}/api/oauth/inspect?client=${vscode.env.uriScheme}-gitpod`;
    try {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 1500);
        const resp = await fetch(endpoint, { signal: controller.signal });
        if (resp.ok) {
            return true;
        }
    } catch {
    }

    return false;
}

export enum ScopeFeature {
    SSHPublicKeys = 'function:getSSHPublicKeys',
    LocalHeartbeat = 'function:sendHeartBeat'
}
