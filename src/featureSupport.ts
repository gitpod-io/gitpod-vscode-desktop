/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as semver from 'semver';
import fetch from 'node-fetch';

type Feature = |
    'SSHPublicKeys' |
    'localHeartbeat';

const DEFAULT_VERSION = '9999.99.99';
let cacheGitpodVersion: { host: string; version: string } | undefined;
export async function getGitpodVersion(gitpodHost: string) {
    const serviceUrl = new URL(gitpodHost).toString().replace(/\/$/, '');
    if (serviceUrl === 'https://gitpod.io') {
        return DEFAULT_VERSION;
    }

    if (serviceUrl === cacheGitpodVersion?.host) {
        return cacheGitpodVersion.version;
    }

    let gitpodVersion: string | null;
    try {
        const versionEndPoint = `${serviceUrl}/api/version`;
        const versionResponse = await fetch(versionEndPoint);
        if (!versionResponse.ok) {
            return DEFAULT_VERSION;
        }

        gitpodVersion = await versionResponse.text();
    } catch (e) {
        return DEFAULT_VERSION;
    }

    gitpodVersion = gitpodVersion.replace('release-', '');
    gitpodVersion = gitpodVersion.replace(/\.\d+$/, '');

    // Remove leading zeros to make it a valid semver
    const [yy, mm, dd] = gitpodVersion.split('.');
    gitpodVersion = `${parseInt(yy, 10)}.${parseInt(mm, 10)}.${parseInt(dd, 10)}`;

    gitpodVersion = semver.valid(gitpodVersion);
    if (!gitpodVersion) {
        return DEFAULT_VERSION;
    }

    cacheGitpodVersion = {
        host: serviceUrl,
        version: gitpodVersion
    };

    return cacheGitpodVersion.version;
}

export function isFeatureSupported(gitpodVersion: string, feature: Feature) {
    switch (feature) {
        case 'SSHPublicKeys':
        case 'localHeartbeat':
            return semver.gte(gitpodVersion, '2022.7.0'); // Don't use leading zeros
    }
}
