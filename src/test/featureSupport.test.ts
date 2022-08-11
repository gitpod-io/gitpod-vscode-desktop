/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { equal } from 'assert';
import Log from '../common/logger';
import { getGitpodVersion, GitpodVersion, isFeatureSupported } from '../featureSupport';

suite('feature support', () => {
    test('isFeatureSupported with versions', () => {
        const cases: Array<{ str?: string; version: GitpodVersion; supported: boolean }> = [
            { version: new GitpodVersion('release-0.0.0.0'), str: '0.0.0', supported: false },
            { version: new GitpodVersion('release-2022.06.1.7'), str: '2022.6.1', supported: false },
            { version: new GitpodVersion('release-2022.06.1.0'), str: '2022.6.1', supported: false },
            { version: new GitpodVersion('sje-hotfix-multiple-registrie-2022.06.1.0'), str: '2022.6.1', supported: false },
            { version: new GitpodVersion('release-2022.06.1.0-sje-hotfix-multiple-registrie'), str: '2022.6.1', supported: false },
            { version: new GitpodVersion('release-2022.06.1.sje-hotfix-multiple-registrie'), str: '2022.6.1', supported: false },
            { version: new GitpodVersion('release-2022.77.1.0'), str: '2022.77.1', supported: true },
            { version: new GitpodVersion('sje-hotfix-multiple-registrie-2022.77.1.0'), str: '2022.77.1', supported: true },
            { version: new GitpodVersion('release-2022.77.1.0-sje-hotfix-multiple-registrie'), str: '2022.77.1', supported: true },
            { version: new GitpodVersion('release-2022.77.1.sje-hotfix-multiple-registrie'), str: '2022.77.1', supported: true },
            { version: new GitpodVersion('abcd.0123.0.0.0'), str: '123.0.0', supported: false },
            { version: new GitpodVersion('abcd.123.0.0'), str: GitpodVersion.MIN_VERSION, supported: false },
            { version: new GitpodVersion('sje-hotfix-multiple-registries.2'), str: GitpodVersion.MIN_VERSION, supported: false },
            { version: new GitpodVersion('123'), str: GitpodVersion.MIN_VERSION, supported: false },
            { version: new GitpodVersion('123..'), str: GitpodVersion.MIN_VERSION, supported: false },
            { version: new GitpodVersion('123.0'), str: GitpodVersion.MIN_VERSION, supported: false },
            { version: new GitpodVersion('123.0.1'), str: '123.0.1', supported: false },
            { version: new GitpodVersion('9123.0.1'), str: '9123.0.1', supported: true },
            { version: GitpodVersion.Max, str: GitpodVersion.MAX_VERSION, supported: true },
            { version: GitpodVersion.Min, str: GitpodVersion.MIN_VERSION, supported: false },

            // SaaS is processed in `getOrFetchVersionInfo` function
            { version: new GitpodVersion('main.123'), supported: false },
            { version: new GitpodVersion('main.9999'), supported: false },
        ];
        for (let i = 0; i < cases.length; i++) {
            const { version, str, supported } = cases[i];
            equal(isFeatureSupported(version, 'localHeartbeat'), supported, `isFeatureSupported index: ${i}`);
            if (str) {
                equal(version.version, str, `version check index: ${i}`);
            }
        }
    });
});

suite('fetch version info', function () {
    this.timeout(10000);

    const logger = { info: (..._args: any) => { }, error: (..._args: any) => { } } as Log;

    test('unknown host retry and fallback to min', async () => {
        const version = await getGitpodVersion('https://unknown.gitpod.io', logger);
        equal(version.version, GitpodVersion.Min.version);
    });

    test('SaaS Gitpod return max', async () => {
        const version = await getGitpodVersion('https://gitpod.io', logger);
        equal(version.version, GitpodVersion.Max.version);
    });
});
