/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as semver from 'semver';
import fetch from 'node-fetch';

export class GitpodVersion {
    static DEFAULT_VERSION = '9999.99.99';

    readonly version: string;
    readonly raw: string;

    constructor(gitpodVersion: string = '') {
        this.raw = gitpodVersion;
        this.version = GitpodVersion.DEFAULT_VERSION;

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
async function getOrFetchVersionInfo(serviceUrl: string) {
    if (serviceUrl === 'https://gitpod.io') {
        return undefined;
    }

    if (serviceUrl === cacheGitpodVersion?.host) {
        return cacheGitpodVersion;
    }

    let gitpodRawVersion: string;
    try {
        const versionEndPoint = `${serviceUrl}/api/version`;
        const versionResponse = await fetch(versionEndPoint);
        if (!versionResponse.ok) {
            return undefined;
        }

        gitpodRawVersion = await versionResponse.text();
    } catch (e) {
        return undefined;
    }

    cacheGitpodVersion = {
        host: serviceUrl,
        version: new GitpodVersion(gitpodRawVersion)
    };
    return cacheGitpodVersion;
}

export async function getGitpodVersion(gitpodHost: string) {
    const serviceUrl = new URL(gitpodHost).toString().replace(/\/$/, '');
    const versionInfo = await getOrFetchVersionInfo(serviceUrl);
    return versionInfo?.version || new GitpodVersion();
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
