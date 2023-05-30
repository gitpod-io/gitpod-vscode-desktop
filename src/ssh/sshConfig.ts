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

const systemSSHConfig = isWindows ? path.resolve(process.env.ALLUSERSPROFILE || 'C:\\ProgramData', 'ssh\\ssh_config') : '/etc/ssh/ssh_config';
const defaultSSHConfigPath = path.resolve(os.homedir(), '.ssh/config');
const gitpodSSHConfigPath = path.resolve(os.homedir(), '.ssh/gitpod/config');

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
            throw new Error(`Gitpod ssh config file ${gitpodSSHConfigPath} does not exist`);
        }

        let content = (await fs.promises.readFile(gitpodSSHConfigPath, 'utf8')).trim();
        const config = SSHConfig.parse(content);
        return new SSHConfiguration(config);
    }

    static async saveGitpodSSHConfig(config: SSHConfiguration): Promise<void> {
        if (!(await isFile(gitpodSSHConfigPath))) {
            throw new Error(`Gitpod ssh config file ${gitpodSSHConfigPath} does not exist`);
        }

        try {
            await fs.promises.writeFile(gitpodSSHConfigPath, config.toString());
        } catch (e) {
            throw new Error(`Could not write gitpod ssh config file ${gitpodSSHConfigPath}: ${e}`);
        }
    }

    static async ensureIncludeGitpodSSHConfig(): Promise<void> {
        const gitpodIncludeSection = `## START GITPOD INTEGRATION
## This section is managed by Gitpod. Any manual changes will be lost.
Include "gitpod/config"
## END GITPOD INTEGRATION`;

        const gitpodHeader = `### This file is managed by Gitpod. Any manual changes will be lost.`;

        const configPath = getSSHConfigPath();
        let content = '';
        if (await exists(configPath)) {
            try {
                content = (await fs.promises.readFile(configPath, 'utf8')).trim();
            } catch (e) {
                throw new Error(`Could not read ssh config file at ${configPath}: ${e}`);
            }
        }

        const scopeRegex = new RegExp(`START GITPOD INTEGRATION.+Include "gitpod/config".+END GITPOD INTEGRATION`, 's');
        if (!scopeRegex.test(content)) {
            content = `${gitpodIncludeSection}\n\n${content}`;

            const configFileDir = path.dirname(configPath);
            // must be dir
            if (!(await exists(configFileDir))) {
                try {
                    await fs.promises.mkdir(configFileDir, { recursive: true });
                } catch (e) {
                    throw new Error(`Could not create ssh config folder ${configFileDir}: ${e}`);
                }
            }
            if (!(await isDir(configFileDir)))  {
                throw new Error(`${configFileDir} is not a directory, cannot write ssh config file`);
            }

            try {
                await fs.promises.writeFile(configPath, content);
            } catch (e) {
                throw new Error(`Could not write ssh config file ${configPath}: ${e}`);
            }
        }

        const gitpodConfigFileDir = path.dirname(gitpodSSHConfigPath);
        // must be dir
        if (!(await exists(gitpodConfigFileDir))) {
            try {
                await fs.promises.mkdir(gitpodConfigFileDir, { recursive: true });
            } catch (e) {
                throw new Error(`Could not create gitpod ssh config folder ${gitpodConfigFileDir}: ${e}`);
            }
        }

        if (!(await isDir(gitpodConfigFileDir)))  {
            throw new Error(`${gitpodConfigFileDir} is not a directory, cannot write ssh config file`);
        }

        // must be file
        if (!(await exists(gitpodSSHConfigPath))) {
            try {
                await fs.promises.writeFile(gitpodSSHConfigPath, gitpodHeader);
            } catch (e) {
                throw new Error(`Could not write gitpod ssh config file ${gitpodSSHConfigPath}: ${e}`);
            }
        }
        if (!(await isFile(gitpodSSHConfigPath)))  {
            throw new Error(`${gitpodSSHConfigPath} is not a file, cannot write ssh config file`);
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
