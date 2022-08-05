/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as semver from 'semver';
import fetch from 'node-fetch';
import Log from './common/logger';

export class GitpodVersion {
    static MAX_VERSION = '9999.99.99';
    static MIN_VERSION = '0.0.0';

    static Max = new GitpodVersion(GitpodVersion.MAX_VERSION);
    static Min = new GitpodVersion(GitpodVersion.MIN_VERSION);

    readonly version: string;
    readonly raw: string;

    constructor(gitpodVersion: string = '') {
        this.raw = gitpodVersion;
        this.version = GitpodVersion.MIN_VERSION;

        if (gitpodVersion.startsWith('release-')) {
            gitpodVersion = gitpodVersion.replace('release-', '');
            gitpodVersion = gitpodVersion.replace(/\.\d+$/, '');

            // Remove leading zeros to make it a valid semver
            const [yy, mm, dd] = gitpodVersion.split('.');
            gitpodVersion = `${parseInt(yy, 10)}.${parseInt(mm, 10)}.${parseInt(dd, 10)}`;

        }

        if (semver.valid(gitpodVersion)) {
            this.version = gitpodVersion;
        }
    }
}

let cacheGitpodVersion: { host: string; version: GitpodVersion } | undefined;
async function getOrFetchVersionInfo(serviceUrl: string, logger: Log) {
    if (serviceUrl === 'https://gitpod.io') {
        logger.info(`Using SaaS, constant Max version ${GitpodVersion.Max.version}`);
        return {
            // SaaS default allow all features, should proper handle SaaS feature support if needed in the future
            version: GitpodVersion.Max,
        };
    }

    if (serviceUrl === cacheGitpodVersion?.host) {
        logger.info(`Using cached version ${cacheGitpodVersion.version} for ${serviceUrl}`);
        return cacheGitpodVersion;
    }

    const fetchVersion = async (times: number = 3): Promise<string | undefined> => {
        try {
            const versionEndPoint = `${serviceUrl}/api/version`;
            const resp = await fetch(versionEndPoint, { timeout: 1500 });
            if (!resp.ok) {
                throw new Error(`Response with ${resp.status} ${resp.statusText}`);
            }
            return await resp.text();
        } catch (e) {
            logger.error(`Failed to fetch version with from: ${serviceUrl} left attempt: ${times - 1}`, e);
            if (times - 1 > 0) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                return fetchVersion(times - 1);
            } else {
                return undefined;
            }
        }
    };

    const gitpodRawVersion = await fetchVersion();
    if (!gitpodRawVersion) {
        logger.info(`Failed to fetch version from: ${serviceUrl} fallback to Min: ${GitpodVersion.Min.version}`);
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

export async function getGitpodVersion(gitpodHost: string, logger: Log) {
    const serviceUrl = new URL(gitpodHost).toString().replace(/\/$/, '');
    const versionInfo = await getOrFetchVersionInfo(serviceUrl, logger);
    return versionInfo.version || new GitpodVersion();
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
