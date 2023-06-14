/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import SSHConfig, { Line, Section, Directive } from 'ssh-config';
import * as vscode from 'vscode';
import { exists, isDir, isFile, untildify } from '../common/files';
import { isWindows } from '../common/platform';
import { WrapError } from '../common/utils';

const systemSSHConfig = isWindows ? path.resolve(process.env.ALLUSERSPROFILE || 'C:\\ProgramData', 'ssh\\ssh_config') : '/etc/ssh/ssh_config';
const defaultSSHConfigPath = path.resolve(os.homedir(), '.ssh/config');
const gitpodSSHConfigPath = path.resolve(os.homedir(), '.ssh/code_gitpod.d/config');

export function getSSHConfigPath() {
    const sshConfigPath = vscode.workspace.getConfiguration('remote.SSH').get<string>('configFile');
    return sshConfigPath ? untildify(sshConfigPath) : defaultSSHConfigPath;
}

function isDirective(line: Line): line is Directive {
    return line.type === SSHConfig.DIRECTIVE;
}

function isHostSection(line: Line): line is Section {
    return line.type === SSHConfig.DIRECTIVE && line.param === 'Host' && !!line.value && !!(line as Section).config;
}

const SSH_CONFIG_PROPERTIES: { [key: string]: string } = {
    'host': 'Host',
    'hostname': 'HostName',
    'user': 'User',
    'port': 'Port',
    'identityagent': 'IdentityAgent',
    'identitiesonly': 'IdentitiesOnly',
    'identityfile': 'IdentityFile',
    'forwardagent': 'ForwardAgent',
    'proxyjump': 'ProxyJump',
    'proxycommand': 'ProxyCommand',
};

function normalizeProp(prop: Directive) {
    prop.param = SSH_CONFIG_PROPERTIES[prop.param.toLowerCase()] || prop.param;
}

function normalizeSSHConfig(config: SSHConfig) {
    for (const line of config) {
        if (isDirective(line)) {
            normalizeProp(line);
        }
        if (isHostSection(line)) {
            normalizeSSHConfig(line.config);
        }
    }
}

// TODO: Delete me
async function tryDeleteOldMatch(matchContent: string, gitpodHeader: string) {
    try {
        const match = matchContent.match(/Include "(?<oldTarget>.*?)"/);
        if (!match) {
            return;
        }
        const location = path.resolve(os.homedir(), '.ssh/' + match.groups!.oldTarget);
        const content = (await fs.promises.readFile(location, 'utf8')).trim();
        if (content.includes(gitpodHeader)) {
            await fs.promises.unlink(location);
            // check if folder is empty if so delete it
            const folder = path.dirname(location);
            const files = await fs.promises.readdir(folder);
            if (files.length === 0) {
                await fs.promises.rmdir(folder);
            }
        }
    } catch (e) {
        // ignore
    }
}

export default class SSHConfiguration {

    static async loadFromFS(): Promise<SSHConfiguration> {
        const sshConfigPath = getSSHConfigPath();
        let content = '';
        if (await isFile(sshConfigPath)) {
            content = (await fs.promises.readFile(sshConfigPath, 'utf8')).trim();
        }
        const config = SSHConfig.parse(content);

        if (await isFile(systemSSHConfig)) {
            content = (await fs.promises.readFile(systemSSHConfig, 'utf8')).trim();
            config.push(...SSHConfig.parse(content));
        }

        return new SSHConfiguration(config);
    }

    static async loadGitpodSSHConfig(): Promise<SSHConfiguration> {
        if (!(await isFile(gitpodSSHConfigPath))) {
            throw new WrapError(`Gitpod ssh config file ${gitpodSSHConfigPath} does not exist`, null, 'NotFile');
        }

        let content = (await fs.promises.readFile(gitpodSSHConfigPath, 'utf8')).trim();
        const config = SSHConfig.parse(content);
        return new SSHConfiguration(config);
    }

    static async saveGitpodSSHConfig(config: SSHConfiguration): Promise<void> {
        if (!(await isFile(gitpodSSHConfigPath))) {
            throw new WrapError(`Gitpod ssh config file ${gitpodSSHConfigPath} does not exist`, null, 'NotFile');
        }

        try {
            await fs.promises.writeFile(gitpodSSHConfigPath, config.toString());
        } catch (e) {
            throw new WrapError(`Could not write gitpod ssh config file ${gitpodSSHConfigPath}`, e);
        }
    }

    private static async addIncludeToUserSSHConfig(gitpodHeader: string): Promise<void> {
        const gitpodIncludeSection = `## START GITPOD INTEGRATION
## This section is managed by Gitpod. Any manual changes will be lost.
Include "code_gitpod.d/config"
## END GITPOD INTEGRATION`;
        const configPath = getSSHConfigPath();
        let content = '';
        if (await exists(configPath)) {
            try {
                content = (await fs.promises.readFile(configPath, 'utf8')).trim();
            } catch (e) {
                throw new WrapError(`Could not read ssh config file at ${configPath}`, e);
            }
        }
        let hasIncludeTarget = false;
        const oldContent = content;
        const scopeRegex = new RegExp(`## START GITPOD INTEGRATION.+END GITPOD INTEGRATION`, 'sg');
        const matchResult = content.match(scopeRegex);
        if (matchResult) {
            for (const matchContent of matchResult) {
                if (matchContent !== gitpodIncludeSection) {
                    content = content.replace(matchContent, '');
                    // try to check and delete old file
                    tryDeleteOldMatch(matchContent, gitpodHeader);
                } else {
                    hasIncludeTarget = true;
                }
            }
        }
        if (!hasIncludeTarget) {
            content = `${gitpodIncludeSection}\n\n${content}`;
        }
        if (content !== oldContent) {
            const configFileDir = path.dirname(configPath);
            // must be dir
            if (!(await exists(configFileDir))) {
                try {
                    await fs.promises.mkdir(configFileDir, { recursive: true });
                } catch (e) {
                    throw new WrapError(`Could not create ssh config folder ${configFileDir}`, e);
                }
            }
            if (!(await isDir(configFileDir)))  {
                throw new WrapError(`${configFileDir} is not a directory, cannot write ssh config file`, null, 'NotDirectory');
            }

            try {
                await fs.promises.writeFile(configPath, content);
            } catch (e) {
                throw new WrapError(`Could not write ssh config file ${configPath}`, e);
            }
        }
    }

    private static async createGitpodSSHConfig(gitpodHeader: string): Promise<void> {
        const gitpodConfigFileDir = path.dirname(gitpodSSHConfigPath);
        // must be dir
        if (!(await exists(gitpodConfigFileDir))) {
            try {
                await fs.promises.mkdir(gitpodConfigFileDir, { recursive: true });
            } catch (e) {
                throw new WrapError(`Could not create gitpod ssh config folder ${gitpodConfigFileDir}`, e);
            }
        }

        if (!(await isDir(gitpodConfigFileDir)))  {
            throw new WrapError(`${gitpodConfigFileDir} is not a directory, cannot write ssh config file`, null, 'NotDirectory');
        }

        // must be file
        if (!(await exists(gitpodSSHConfigPath))) {
            try {
                await fs.promises.writeFile(gitpodSSHConfigPath, gitpodHeader);
            } catch (e) {
                throw new WrapError(`Could not write gitpod ssh config file ${gitpodSSHConfigPath}`, e);
            }
        }
        if (!(await isFile(gitpodSSHConfigPath)))  {
            throw new WrapError(`${gitpodSSHConfigPath} is not a file, cannot write ssh config file`, null, 'NotFile');
        }
    }

    static async ensureIncludeGitpodSSHConfig(): Promise<void> {
        const gitpodHeader = `### This file is managed by Gitpod. Any manual changes will be lost.`;
        try {
            await this.createGitpodSSHConfig(gitpodHeader);
        } catch (e) {
            const code = e?.code ?? 'Unknown';
            throw new WrapError('Failed to create gitpod ssh config', e, 'GitpodSSHConfig:' + code);
        }
        try {
            await this.addIncludeToUserSSHConfig(gitpodHeader);
        } catch (e) {
            const code = e?.code ?? 'Unknown';
            throw new WrapError('Failed to add include to user ssh config', e, 'UserSSHConfig:' + code);
        }
    }

    constructor(private sshConfig: SSHConfig) {
        // Normalize config property names
        normalizeSSHConfig(sshConfig);
    }

    getAllConfiguredHosts(): string[] {
        const hosts = new Set<string>();
        for (const line of this.sshConfig) {
            if (isHostSection(line)) {
                const value = Array.isArray(line.value as string[] | string) ? line.value[0] : line.value;
                const isPattern = /^!/.test(value) || /[?*]/.test(value);
                if (!isPattern) {
                    hosts.add(value);
                }
            }
        }

        return [...hosts.keys()];
    }

    getHostConfiguration(host: string): Record<string, string> {
        return this.sshConfig.compute(host);
    }

    addHostConfiguration(hostConfig: { Host: string;[k: string]: string }) {
        this.sshConfig.remove(hostConfig);
        this.sshConfig.append(hostConfig);
    }

    toString() {
        return this.sshConfig.toString();
    }
}
