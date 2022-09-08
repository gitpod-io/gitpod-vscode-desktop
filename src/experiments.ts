/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as configcat from 'configcat-node';
import * as configcatcommon from 'configcat-common';
import * as semver from 'semver';
import Log from './common/logger';

const EXPERTIMENTAL_SETTINGS = [
    'gitpod.remote.useLocalApp'
];

export class ExperimentalSettings {
    private readonly _configcatClient: configcatcommon.IConfigCatClient;
    private readonly extensionVersion: semver.SemVer;

    constructor(key: string, extensionVersion: string, private readonly logger: Log, private readonly context: vscode.ExtensionContext) {
        this._configcatClient = configcat.createClientWithManualPoll(key, {
            logger: {
                debug(): void { },
                log(): void { },
                info(): void { },
                warn(message: string): void { logger.warn(`ConfigCat: ${message}`); },
                error(message: string): void { logger.error(`ConfigCat: ${message}`); }
            },
            requestTimeoutMs: 1500
        });
        this.extensionVersion = new semver.SemVer(extensionVersion);
        this.refresh();
    }

    /**
     * Returns the client with the latest settins values updated once in a minute.
     */
    private async getClient(): Promise<configcatcommon.IConfigCatClient> {
        await this.refresh();
        return this._configcatClient;
    };

    async refresh(): Promise<Date> {
        const key = 'experiments.refreshedAt';
        const now = new Date();
        const refreshedAt = this.context.globalState.get<number>(key);
        if (typeof refreshedAt === 'number' && (now.getTime() - refreshedAt) < 60 * 1000) {
            return new Date(refreshedAt);
        }
        this.context.globalState.update(key, now.getTime());
        await this._configcatClient.forceRefreshAsync();
        return now;
    }

    async get<T>(key: string, userId?: string, custom?: { [key: string]: string }): Promise<T | undefined> {
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

        const user = userId ? new configcatcommon.User(userId, undefined, undefined, custom) : undefined;
        const configcatKey = key.replace(/\./g, '_'); // '.' are not allowed in configcat
        const client = await this.getClient();
        const experimentValue = (await client.getValueAsync(configcatKey, undefined, user)) as T | undefined;

        return experimentValue ?? values.defaultValue;
    }

    async inspect<T>(key: string, userId?: string, custom?: { [key: string]: string }): Promise<{ key: string; defaultValue?: T; globalValue?: T; experimentValue?: T } | undefined> {
        const config = vscode.workspace.getConfiguration('gitpod');
        const values = config.inspect<T>(key.substring('gitpod.'.length));
        if (!values || !EXPERTIMENTAL_SETTINGS.includes(key)) {
            this.logger.error(`Cannot inspect invalid experimental setting '${key}'`);
            return values;
        }

        const user = userId ? new configcatcommon.User(userId, undefined, undefined, custom) : undefined;
        const configcatKey = key.replace(/\./g, '_'); // '.' are not allowed in configcat
        const client = await this.getClient();
        const experimentValue = (await client.getValueAsync(configcatKey, undefined, user)) as T | undefined;

        return { key, defaultValue: values.defaultValue, globalValue: values.globalValue, experimentValue };
    }

    private isPreRelease() {
        return this.extensionVersion.minor % 2 === 1;
    }

    dispose(): void {
        this._configcatClient.dispose();
    }
}

export function isUserOverrideSetting(key: string): boolean {
    const config = vscode.workspace.getConfiguration('gitpod');
    const values = config.inspect(key.substring('gitpod.'.length));
    return values?.globalValue !== undefined;
}
