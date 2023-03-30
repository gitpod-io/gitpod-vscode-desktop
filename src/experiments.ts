/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as configcat from 'configcat-node';
import * as configcatcommon from 'configcat-common';
import * as semver from 'semver';
import { ISessionService } from './services/sessionService';
import { ILogService } from './services/logService';

const EXPERTIMENTAL_SETTINGS = [
    'gitpod.remote.useLocalApp',
    'gitpod.remote.useLocalSSHServer',
];

export class ExperimentalSettings {
    private configcatClient: configcatcommon.IConfigCatClient;
    private extensionVersion: semver.SemVer;

    constructor(
        key: string,
        extensionVersion: string,
        private readonly sessionService: ISessionService,
        private readonly context: vscode.ExtensionContext,
        private readonly logger: ILogService
    ) {
        this.configcatClient = configcat.createClientWithLazyLoad(key, {
            baseUrl: new URL('/configcat', this.context.extensionMode === vscode.ExtensionMode.Production ? 'https://gitpod.io' : 'https://gitpod-staging.com').href,
            logger: {
                debug(): void { },
                log(): void { },
                info(): void { },
                warn(message: string): void { logger.warn(`ConfigCat: ${message}`); },
                error(message: string): void { logger.error(`ConfigCat: ${message}`); }
            },
            requestTimeoutMs: 1500,
            cacheTimeToLiveSeconds: 60
        });
        this.extensionVersion = new semver.SemVer(extensionVersion);
    }

    async getRaw<T>(
        configcatKey: string,
        custom: {
            gitpodHost: string;
            [key: string]: string;
        }
    ) {
        const user = this.sessionService.isSignedIn() ? new configcatcommon.User(this.sessionService.getUserId(), undefined, undefined, custom) : undefined;
        return (await this.configcatClient.getValueAsync(configcatKey, undefined, user)) as T | undefined;
    }

    async get<T>(
        key: string,
        custom: {
            gitpodHost: string;
            [key: string]: string;
        },
        configcatKey?: string
    ): Promise<T | undefined> {
        const config = vscode.workspace.getConfiguration('gitpod');
        const values = config.inspect<T>(key.substring('gitpod.'.length));
        if (!values || !EXPERTIMENTAL_SETTINGS.includes(key)) {
            this.logger.error(`Cannot get invalid experimental setting '${key}'`);
            return values?.globalValue ?? values?.defaultValue;
        }
        if (this.isPreRelease()) {
            // PreRelease versions always have experiments enabled by default
            return values.globalValue ?? values.defaultValue;
        }
        if (values.globalValue !== undefined) {
            // User setting have priority over configcat so return early
            return values.globalValue;
        }

        const user = this.sessionService.isSignedIn() ? new configcatcommon.User(this.sessionService.getUserId(), undefined, undefined, custom) : undefined;
        configcatKey = configcatKey ?? key.replace(/\./g, '_'); // '.' are not allowed in configcat
        const experimentValue = (await this.configcatClient.getValueAsync(configcatKey, undefined, user)) as T | undefined;

        return experimentValue ?? values.defaultValue;
    }

    async inspect<T>(
        key: string,
        custom: {
            gitpodHost: string;
            [key: string]: string;
        },
        configcatKey?: string
    ): Promise<{ key: string; defaultValue?: T; globalValue?: T; experimentValue?: T } | undefined> {
        const config = vscode.workspace.getConfiguration('gitpod');
        const values = config.inspect<T>(key.substring('gitpod.'.length));
        if (!values || !EXPERTIMENTAL_SETTINGS.includes(key)) {
            this.logger.error(`Cannot inspect invalid experimental setting '${key}'`);
            return values;
        }

        const user = this.sessionService.isSignedIn() ? new configcatcommon.User(this.sessionService.getUserId(), undefined, undefined, custom) : undefined;
        configcatKey = configcatKey ?? key.replace(/\./g, '_'); // '.' are not allowed in configcat
        const experimentValue = (await this.configcatClient.getValueAsync(configcatKey, undefined, user)) as T | undefined;

        return { key, defaultValue: values.defaultValue, globalValue: values.globalValue, experimentValue };
    }

    forceRefreshAsync(): Promise<void> {
        return this.configcatClient.forceRefreshAsync();
    }

    private isPreRelease() {
        return this.extensionVersion.minor % 2 === 1;
    }

    dispose(): void {
        this.configcatClient.dispose();
    }

    /**
     * @see https://app.configcat.com/08da1258-64fb-4a8e-8a1e-51de773884f6/08da1258-6541-4fc7-8b61-c8b47f82f3a0/08da1258-6512-4ec0-80a3-3f6aa301f853?settingId=75503
     */
    async getUseLocalSSHServer(gitpodHost: string): Promise<boolean> {
        return (await this.get<boolean>('gitpod.remote.useLocalSSHServer', { gitpodHost }, 'gitpod_desktop_use_local_ssh_server')) ?? false;
    }

    async getUsePublicAPI(gitpodHost: string): Promise<boolean> {
        return (await this.getRaw<boolean>('gitpod_experimental_publicApi', { gitpodHost })) ?? false;
    }
}

export function isUserOverrideSetting(key: string): boolean {
    const config = vscode.workspace.getConfiguration('gitpod');
    const values = config.inspect(key.substring('gitpod.'.length));
    return values?.globalValue !== undefined;
}
