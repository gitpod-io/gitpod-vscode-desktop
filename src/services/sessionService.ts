/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Disposable } from '../common/dispose';
import { isFeatureSupported, isOauthInspectSupported } from '../featureSupport';
import { IHostService } from './hostService';
import { GitpodPublicApi, IGitpodAPI } from '../publicApi';
import { eventToPromise } from '../common/vscodeEvent';
import { ILogService } from './logService';

export class NoSignedInError extends Error {
    constructor() {
        super(`You are not signed in with your Gitpod account`);
    }
}

export interface ISessionService {
    onDidChangeSession: vscode.Event<void>;

    isSignedIn(): boolean;
    signIn(gitpodHost?: string): Promise<void>;
    getUserId(): string;
    safeGetUserId(): string | undefined;
    getGitpodToken(): string;
    getScopes(): readonly string[];
    getAPI(): IGitpodAPI;

    didFirstLoad: Promise<void>;
}

export class SessionService extends Disposable implements ISessionService {

    private readonly _onDidChangeSession = this._register(new vscode.EventEmitter<void>());
    public readonly onDidChangeSession = this._onDidChangeSession.event;

    private session: vscode.AuthenticationSession | undefined;
    private loginPromise: Promise<void> | undefined;
    private firstLoadPromise: Promise<void>;

    private _publicApi: GitpodPublicApi | undefined;

    get didFirstLoad() {
        return this.firstLoadPromise;
    }

    constructor(
        private readonly hostService: IHostService,
        private readonly logger: ILogService
    ) {
        super();

        this._register(vscode.authentication.onDidChangeSessions(e => this.handleOnDidChangeSessions(e)));
        this.firstLoadPromise = this.tryLoadSession(false);
    }

    private async handleOnDidChangeSessions(e: vscode.AuthenticationSessionsChangeEvent) {
        if (e.provider.id !== 'gitpod') {
            return;
        }
        const oldSession = this.session;
        this.session = undefined as vscode.AuthenticationSession | undefined;
        await this.tryLoadSession(false);
        // host changed, sign out, sign in
        const didChange = oldSession?.id !== this.session?.id;
        if (didChange) {
            this._publicApi?.dispose();
            this._publicApi = undefined;
            this._onDidChangeSession.fire();
        }
    }

    isSignedIn() {
        return !!this.session;
    }

    async signIn(gitpodHost?: string) {
        if (this.loginPromise) {
            this.logger.info(`Existing login in progress. Waiting for completion...`);
            return this.loginPromise;
        }

        this.loginPromise = this.doSignIn(gitpodHost);
        this.loginPromise.finally(() => this.loginPromise = undefined);
        return this.loginPromise;
    }

    private async doSignIn(gitpodHost?: string) {
        if (gitpodHost && new URL(this.hostService.gitpodHost).host !== new URL(gitpodHost).host) {
            const changedSessionPromise = eventToPromise(this.onDidChangeSession);
            const updated = await this.hostService.changeHost(gitpodHost);
            if (!updated) {
                return;
            }
            // wait until session get updated after host config changed
            await changedSessionPromise;
        }

        if (this.isSignedIn()) {
            return;
        }

        await this.tryLoadSession(true);

        if (this.isSignedIn()) {
            this.logger.info(`Successfully signed in`);
        } else {
            this.logger.error(`Failed to sign in`);
        }
    }

    private async tryLoadSession(force: boolean) {
        try {
            if (this.session && !force) {
                return;
            }

            const gitpodVersion = await this.hostService.getVersion();
            const sessionScopes = ['function:getWorkspace', 'function:getOwnerToken', 'function:getLoggedInUser', 'resource:default'];
            if (await isOauthInspectSupported(this.hostService.gitpodHost) || isFeatureSupported(gitpodVersion, 'SSHPublicKeys') /* && isFeatureSupported('', 'sendHeartBeat') */) {
                sessionScopes.push('function:getSSHPublicKeys', 'function:sendHeartBeat');
            } else {
                this.logger.warn(`function:getSSHPublicKeys and function:sendHeartBeat session scopes not supported in ${this.hostService.gitpodHost}, using version ${gitpodVersion.raw}`);
            }

            this.session = await vscode.authentication.getSession(
                'gitpod',
                sessionScopes,
                {
                    createIfNone: force,
                    silent: !force,
                }
            );
        } catch (e) {
            this.logger.error(`Failed to load session:`, e);
        }
    }

    getUserId() {
        if (!this.isSignedIn()) {
            throw new NoSignedInError();
        }
        return this.session!.account.id;
    }

    safeGetUserId() {
        return this.session?.account.id;
    }

    getGitpodToken() {
        if (!this.isSignedIn()) {
            throw new NoSignedInError();
        }
        return this.session!.accessToken;
    }

    getScopes() {
        if (!this.isSignedIn()) {
            throw new NoSignedInError();
        }
        return this.session!.scopes;
    }

    getAPI(): IGitpodAPI {
        if (!this.isSignedIn()) {
            throw new NoSignedInError();
        }
        if (!this._publicApi) {
            this._publicApi = new GitpodPublicApi(this.getGitpodToken(), this.hostService.gitpodHost, this.logger);
        }
        return this._publicApi;
    }

    override dispose() {
        super.dispose();
        this._publicApi?.dispose();
    }
}
