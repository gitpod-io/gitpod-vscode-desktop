/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AuthHandlerResult, ClientChannel, ConnectConfig, OpenSSHAgent, utils } from 'ssh2';
import { ParsedKey } from 'ssh2-streams';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { untildify, exists as fileExists } from './common/files';
import { isWindows } from './common/platform';
import { gatherIdentityFiles, SSHKey } from './ssh/identityFiles';
import SSHConfiguration from './ssh/sshConfig';
import SSHConnection from './ssh/sshConnection';
import SSHDestination from './ssh/sshDestination';
import { ILogService } from './services/logService';

export class SSHError extends Error {
    constructor(cause: Error) {
        super();
        this.name = cause.name;
        this.message = cause.message;
        this.stack = cause.stack;
    }
}

export function getAgentSock(sshHostConfig: Record<string, string>) {
    let sshAgentSock = isWindows ? '\\\\.\\pipe\\openssh-ssh-agent' : (sshHostConfig['IdentityAgent'] || process.env['SSH_AUTH_SOCK']);
    return sshAgentSock ? untildify(sshAgentSock) : undefined;
}

export async function testSSHConnection(config: ConnectConfig, sshHostKeys: { type: string; host_key: string }[], sshconfig: SSHConfiguration, logger: ILogService) {
    const sshHostConfig = sshconfig.getHostConfiguration(config.host!);

    const sshAgentSock = getAgentSock(sshHostConfig);

    const proxyConnections: SSHConnection[] = [];
    let proxyStream: ClientChannel | undefined;
    if (sshHostConfig['ProxyJump']) {
        const proxyJumps = sshHostConfig['ProxyJump'].split(',').filter(i => !!i.trim())
            .map(i => {
                const proxy = SSHDestination.parse(i);
                const proxyHostConfig = sshconfig.getHostConfiguration(proxy.hostname);
                return [proxy, proxyHostConfig] as [SSHDestination, Record<string, string>];
            });
        for (let i = 0; i < proxyJumps.length; i++) {
            const [proxy, proxyHostConfig] = proxyJumps[i];
            const proxyhHostName = proxyHostConfig['HostName'] || proxy.hostname;
            const proxyUser = proxyHostConfig['User'];
            const proxyPort = proxyHostConfig['Port'] ? parseInt(proxyHostConfig['Port'], 10) : 22;

            const proxyAgentForward = (proxyHostConfig['ForwardAgent'] || 'no').toLowerCase() === 'yes';
            const proxyAgent = proxyAgentForward && sshAgentSock ? new OpenSSHAgent(sshAgentSock) : undefined;

            const proxyIdentityFiles: string[] = (proxyHostConfig['IdentityFile'] as unknown as string[]) || [];
            const proxyIdentitiesOnly = (proxyHostConfig['IdentitiesOnly'] || 'no').toLowerCase() === 'yes';
            const proxyIdentityKeys = await gatherIdentityFiles(proxyIdentityFiles, sshAgentSock, proxyIdentitiesOnly, logger);

            const proxyAuthHandler = getSSHAuthHandler(proxyUser, proxyhHostName, proxyIdentityKeys, sshAgentSock, logger);
            const proxyConnection = new SSHConnection({
                host: !proxyStream ? proxyhHostName : undefined,
                port: !proxyStream ? proxyPort : undefined,
                sock: proxyStream,
                username: proxyUser,
                readyTimeout: 90000,
                strictVendor: false,
                agentForward: proxyAgentForward,
                agent: proxyAgent,
                authHandler: (arg0, arg1, arg2) => (proxyAuthHandler(arg0, arg1, arg2), undefined)
            });
            proxyConnections.push(proxyConnection);

            const nextProxyJump = i < proxyJumps.length - 1 ? proxyJumps[i + 1] : undefined;
            const destIP = nextProxyJump ? (nextProxyJump[1]['HostName'] || nextProxyJump[0].hostname) : config.host!;
            const destPort = nextProxyJump ? ((nextProxyJump[1]['Port'] && parseInt(proxyHostConfig['Port'], 10)) || nextProxyJump[0].port || 22) : 22;
            proxyStream = await proxyConnection.forwardOut('127.0.0.1', 0, destIP, destPort);
        }
    }


    let verifiedHostKey: Buffer | undefined;
    const sshConnection = new SSHConnection({
        host: !proxyStream ? config.host : undefined,
        sock: proxyStream,
        username: config.username,
        readyTimeout: config.readyTimeout,
        strictVendor: false,
        authHandler() {
            return {
                type: 'password',
                username: config.username!,
                password: config.password!,
            };
        },
        hostVerifier(hostKey) {
            // We didn't specify `hostHash` so `hashedKey` is a Buffer object
            verifiedHostKey = (hostKey as any as Buffer);
            const encodedKey = verifiedHostKey.toString('base64');
            return sshHostKeys.some(keyData => keyData.host_key === encodedKey);
        }
    });
    await sshConnection.connect().catch((e: Error | null) => { throw new SSHError(e ?? new Error('Unknown')) });

    if (proxyConnections.length) {
        proxyConnections[0].close();
    } else {
        sshConnection?.close();
    }

    logger.info(`SSH test connection to '${config.host}' host successful`);

    return verifiedHostKey;
}

const PASSWORD_RETRY_COUNT = 3;
const PASSPHRASE_RETRY_COUNT = 3;

function getSSHAuthHandler(sshUser: string, sshHostName: string, identityKeys: SSHKey[], sshAgentSock: string | undefined, logger: ILogService) {
    let passwordRetryCount = PASSWORD_RETRY_COUNT;
    let keyboardRetryCount = PASSWORD_RETRY_COUNT;
    identityKeys = identityKeys.slice();
    return async (methodsLeft: string[] | null, _partialSuccess: boolean | null, callback: (nextAuth: AuthHandlerResult) => void) => {
        if (methodsLeft === null) {
            logger.info(`Trying no-auth authentication`);

            return callback({
                type: 'none',
                username: sshUser,
            });
        }
        if (methodsLeft.includes('publickey') && identityKeys.length) {
            const identityKey = identityKeys.shift()!;

            logger.info(`Trying publickey authentication: ${identityKey.filename} ${identityKey.parsedKey.type} SHA256:${identityKey.fingerprint}`);

            if (identityKey.agentSupport) {
                return callback({
                    type: 'agent',
                    username: sshUser,
                    agent: new class extends OpenSSHAgent {
                        // Only return the current key
                        override getIdentities(callback: (err: Error | undefined, publicKeys?: ParsedKey[]) => void): void {
                            callback(undefined, [identityKey.parsedKey]);
                        }
                    }(sshAgentSock!)
                });
            }
            if (identityKey.isPrivate) {
                return callback({
                    type: 'publickey',
                    username: sshUser,
                    key: identityKey.parsedKey
                });
            }
            if (!await fileExists(identityKey.filename)) {
                // Try next identity file
                return callback(null as any);
            }

            const keyBuffer = await fs.promises.readFile(identityKey.filename);
            let result = utils.parseKey(keyBuffer); // First try without passphrase
            if (result instanceof Error && result.message === 'Encrypted private OpenSSH key detected, but no passphrase given') {
                let passphraseRetryCount = PASSPHRASE_RETRY_COUNT;
                while (result instanceof Error && passphraseRetryCount > 0) {
                    const passphrase = await vscode.window.showInputBox({
                        title: `Enter passphrase for ${identityKey}`,
                        password: true,
                        ignoreFocusOut: true
                    });
                    if (!passphrase) {
                        break;
                    }
                    result = utils.parseKey(keyBuffer, passphrase);
                    passphraseRetryCount--;
                }
            }
            if (!result || result instanceof Error) {
                // Try next identity file
                return callback(null as any);
            }

            const key = Array.isArray(result) ? result[0] : result;
            return callback({
                type: 'publickey',
                username: sshUser,
                key
            });
        }
        if (methodsLeft.includes('password') && passwordRetryCount > 0) {
            if (passwordRetryCount === PASSWORD_RETRY_COUNT) {
                logger.info(`Trying password authentication`);
            }

            const password = await vscode.window.showInputBox({
                title: `Enter password for ${sshUser}@${sshHostName}`,
                password: true,
                ignoreFocusOut: true
            });
            passwordRetryCount--;

            return callback(password
                ? {
                    type: 'password',
                    username: sshUser,
                    password
                }
                : false);
        }
        if (methodsLeft.includes('keyboard-interactive') && keyboardRetryCount > 0) {
            if (keyboardRetryCount === PASSWORD_RETRY_COUNT) {
                logger.info(`Trying keyboard-interactive authentication`);
            }

            return callback({
                type: 'keyboard-interactive',
                username: sshUser,
                prompt: async (_name, _instructions, _instructionsLang, prompts, finish) => {
                    const responses: string[] = [];
                    for (const prompt of prompts) {
                        const response = await vscode.window.showInputBox({
                            title: `(${sshUser}@${sshHostName}) ${prompt.prompt}`,
                            password: !prompt.echo,
                            ignoreFocusOut: true
                        });
                        if (response === undefined) {
                            keyboardRetryCount = 0;
                            break;
                        }
                        responses.push(response);
                    }
                    keyboardRetryCount--;
                    finish(responses);
                }
            });
        }

        callback(false);
    };
}
