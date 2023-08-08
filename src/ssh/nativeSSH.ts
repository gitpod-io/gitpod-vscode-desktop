/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as vscode from 'vscode';
import * as crypto from 'crypto';

export class NativeSSHError extends Error {
    constructor(code: number, stdout: string, stderr: string) {
        super();
        this.name = 'NativeSSHError';
        this.message = `code: ${code}\n\nstdout: ${stdout}\n\nstderr: ${stderr}`;
    }
}

export class SSHOutputVerificationError extends Error {
    constructor() {
        super();
        this.name = 'SSHOutputVerificationError';
        this.message = `SSH output verification failed`;
    }
}

export class SSHCommandTimeoutError extends Error {
    constructor() {
        super();
        this.name = 'SSHCommandTimeoutError';
        this.message = `SSH command timeout`;
    }
}

function getSSHConfigPath() {
    const sshPath = vscode.workspace.getConfiguration('remote.SSH').get<string>('path');
    return sshPath || 'ssh';
}

function execCommand(command: string, args?: string[], options?: { timeout?: number }) {
    let abortController: AbortController | undefined;
    if (options?.timeout && options.timeout > 0) {
        abortController = new AbortController();
        setTimeout(() => abortController?.abort(), options.timeout);
    }
    const process = cp.spawn(command, args, { ...options, windowsVerbatimArguments: true, signal: abortController?.signal });
    const stdoutDataArr: string[] = [];
    const stderrDataArr: string[] = [];
    process.stdout.on('data', (data) => {
        stdoutDataArr.push(data.toString());
    });
    process.stderr.on('data', (data) => {
        stderrDataArr.push(data.toString());
    });
    const completed = new Promise<{ code: number }>((resolve, reject) => {
        process.on('error', (err) => {
            if (err.name === 'AbortError') {
                err = new SSHCommandTimeoutError();
            }
            reject(err);
        });
        process.on('close', (code) => {
            resolve({ code: code ?? 256 });
        });
    })

    return {
        get stdout() {
            return stdoutDataArr.join();
        },
        get stderr() {
            return stderrDataArr.join();
        },
        completed,
        terminate() { process.kill(); }
    }
}

let version: string | undefined;
export async function getOpenSSHVersion(): Promise<string | undefined> {
    if (version) {
        return version;
    }

    try {
        const sshPath = getSSHConfigPath();
        const resp = execCommand(sshPath, ['-V'], { timeout: 3000 });
        const { code } = await resp.completed;
        if (code === 0) {
            const match = /\bOpenSSH[A-Za-z0-9_\-\.]+\b/.exec(resp.stderr.trim() || resp.stderr.trim());
            if (match) {
                version = match[0];
                return version;
            }
        }
    } catch {
    }
    return undefined;
}

export async function getHostConfig(hostname: string) {
    try {
        const sshPath = getSSHConfigPath();
        const resp = execCommand(sshPath, ['-T', '-G', hostname], { timeout: 3000 });
        const { code } = await resp.completed;
        if (code === 0) {
            return resp.stdout.trim().split(/\r?\n/).map(s => s.trim());
        }
    } catch {
    }
    return undefined;
}

/**
 * Test ssh connection to a remote machine using native ssh client.
 *
 * Caller should handle any exception thrown
 */
export async function testSSHConnection(username: string, hostname: string) {
    const sshPath = getSSHConfigPath();
    const randomId = crypto.randomBytes(12).toString('hex');
    // TODO: support password input so we can replace the ssh2 library
    const resp = execCommand(sshPath, ['-T', '-o', 'ConnectTimeout=8', `${username}@${hostname}`, `echo "${randomId}"`], { timeout: 8500 });
    const { code } = await resp.completed;
    if (code === 0) {
        // When using ssh gateway sometimes the command output is missing, probably some bug on go code?
        // If not then just check for code === 0, works fine with websocket though
        if (resp.stdout.includes(randomId)) {
            return;
        } else {
            throw new SSHOutputVerificationError();
        }
    } else if (code === 256) {
        throw new SSHCommandTimeoutError();
    } else {
        throw new NativeSSHError(code, resp.stdout, resp.stderr);
    }
}
