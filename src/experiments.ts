/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as configcat from 'configcat-node';
import * as configcatcommon from 'configcat-common';
import Log from './common/logger';

const EXPERTIMENTAL_SETTINGS = [
    'gitpod.remote.useLocalApp'
];

export class ExperimentalSettings {
    private configcatClient: configcatcommon.IConfigCatClient;

    constructor(key: string, private logger: Log) {
        this.configcatClient = configcat.createClientWithLazyLoad(key, {
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
    }

    async get<T>(key: string, userId?: string): Promise<T | undefined> {
        if (!EXPERTIMENTAL_SETTINGS.includes(key)) {
            this.logger.error(`Cannot get invalid experimental setting '${key}'`);
            return undefined;
        }

        const config = vscode.workspace.getConfiguration('gitpod');
        const values = config.inspect<T>(key.substring('gitpod.'.length));
        if (values?.globalValue !== undefined) {
            return values?.globalValue;
        }

        const user = userId ? new configcatcommon.User(userId) : undefined;
        const experimentValue = (await this.configcatClient.getValueAsync(key, undefined, user)) as T | undefined;

        return experimentValue ?? values?.defaultValue;
    }

    async inspect<T>(key: string, userId?: string): Promise<{ key: string; defaultValue?: T; globalValue?: T; experimentValue?: T }> {
        if (!EXPERTIMENTAL_SETTINGS.includes(key)) {
            this.logger.error(`Cannot inspect invalid experimental setting '${key}'`);
            return { key };
        }

        const config = vscode.workspace.getConfiguration('gitpod');
        const values = config.inspect<T>(key.substring('gitpod.'.length));

        const user = userId ? new configcatcommon.User(userId) : undefined;
        const experimentValue = (await this.configcatClient.getValueAsync(key, undefined, user)) as T | undefined;

        return { key, defaultValue: values?.defaultValue, globalValue: values?.globalValue, experimentValue };
    }

    isUserOverride(key: string): boolean {
        const config = vscode.workspace.getConfiguration('gitpod');
        const values = config.inspect(key.substring('gitpod.'.length));
        return values?.globalValue !== undefined;
    }

    forceRefreshAsync(): Promise<void> {
        return this.configcatClient.forceRefreshAsync();
    }

    dispose(): void {
        this.configcatClient.dispose();
    }
}
