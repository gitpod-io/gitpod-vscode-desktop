/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Disposable } from '../common/dispose';
import { IHostService } from './hostService';
import { GitpodPublicApi, IGitpodAPI } from '../publicApi';
import { eventToPromise } from '../common/event';
import { ILogService } from './logService';
import { arrayEquals } from '../common/utils';

export class NoSignedInError extends Error {
    constructor() {
        super(`You are not signed in with your Gitpod Classic account`);
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

const defaultSessionScopes = [
    'function:getWorkspace',
    'function:getOwnerToken',
    'function:getLoggedInUser',
    'function:getSSHPublicKeys',
    'function:sendHeartBeat',
    'resource:default'
];

const managementSessionScopes = [
    'function:getWorkspaces',
    'function:getWorkspace',
    'function:startWorkspace',
    'function:stopWorkspace',
    'function:deleteWorkspace',
    'function:getSSHPublicKeys',
    'function:sendHeartBeat',
    'function:getOwnerToken',
    'function:getLoggedInUser',
    'resource:default'
];

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
        private readonly logger: ILogService,
    ) {
        super();

        this._register(vscode.authentication.onDidChangeSessions(e => this.handleOnDidChangeSessions(e)));
        this.firstLoadPromise = this.tryLoadSession(false, managementSessionScopes).then(() => this.tryLoadSession(false, defaultSessionScopes) /* delete this after some time when users have a session with managementSessionScopes */);
        this.firstLoadPromise.then(() => vscode.commands.executeCommand('setContext', 'gitpod.authenticated', this.session && arrayEquals(this.session.scopes.slice(0).sort(), managementSessionScopes.slice().sort())));
    }

    private async handleOnDidChangeSessions(e: vscode.AuthenticationSessionsChangeEvent) {
        if (e.provider.id !== 'gitpod') {
            return;
        }
        const oldSession = this.session;
        this.session = undefined as vscode.AuthenticationSession | undefined;
        await this.tryLoadSession(false, managementSessionScopes);
        await this.tryLoadSession(false, defaultSessionScopes); // delete this after some time when users have a session with managementSessionScopes
        vscode.commands.executeCommand('setContext', 'gitpod.authenticated', this.session && arrayEquals(this.session.scopes.slice(0).sort(), managementSessionScopes.slice().sort()));
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

    async signIn(gitpodHost?: string, scopes: string[] = managementSessionScopes) {
        if (this.loginPromise) {
            this.logger.info(`Existing login in progress. Waiting for completion...`);
            return this.loginPromise;
        }

        this.loginPromise = this.doSignIn(gitpodHost || this.hostService.gitpodHost, scopes);
        this.loginPromise.finally(() => this.loginPromise = undefined);
        return this.loginPromise;
    }

    private async doSignIn(gitpodHost: string, scopes: string[]) {
        if (new URL(this.hostService.gitpodHost).host !== new URL(gitpodHost).host) {
            const changedSessionPromise = eventToPromise(this.onDidChangeSession);
            const updated = await this.hostService.changeHost(gitpodHost);
            if (!updated) {
                return;
            }
            // wait until session get updated after host config changed
            await changedSessionPromise;
        }

        if (this.session && arrayEquals(this.session.scopes.slice(0).sort(), scopes.slice().sort())) {
            return;
        }

        await this.tryLoadSession(true, scopes);

        if (this.isSignedIn()) {
            this.logger.info(`Successfully signed in`);
        } else {
            this.logger.error(`Failed to sign in`);
        }
    }

    private async tryLoadSession(force: boolean, scopes: string[]) {
        try {
            if (this.session && !force) {
                return;
            }

            this.session = await vscode.authentication.getSession(
                'gitpod',
                scopes,
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
