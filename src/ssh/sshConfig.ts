/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import Handlebars from 'handlebars';
import SSHConfig, { Line, Section, Directive } from 'ssh-config';
import * as vscode from 'vscode';
import { exists, isFile, untildify } from '../common/files';
import { isWindows } from '../common/platform';

const systemSSHConfig = isWindows ? path.resolve(process.env.ALLUSERSPROFILE || 'C:\\ProgramData', 'ssh\\ssh_config') : '/etc/ssh/ssh_config';
const defaultSSHConfigPath = path.resolve(os.homedir(), '.ssh/config');

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

    static async includeLocalSSHConfig(scopeName: string, configContent: string): Promise<boolean> {
        const render = Handlebars.compile(`## START GITPOD {{scopeName}}
### This section is managed by Gitpod. Any manual changes will be lost.

{{{configContent}}}

## END GITPOD {{scopeName}}`);
        const newContent = render({ scopeName, configContent });

        const findAndReplaceScope = async (configPath: string) => {
            try {
                let content = '';
                if (await exists(configPath)) {
                    if (!(await isFile(configPath))) {
                        return false;
                    }
                    content = (await fs.promises.readFile(configPath, 'utf8')).trim();
                } else {
                    await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
                }
                const scopeRegex = new RegExp(`## START GITPOD ${scopeName}.*## END GITPOD ${scopeName}`, 's');
                if (scopeRegex.test(content)) {
                    content = content.replace(scopeRegex, newContent);
                } else {
                    content = `${content}\n\n${newContent}\n\n`;
                }
                await fs.promises.writeFile(configPath, content);
                return true;
            } catch (err) {
                // ignore
                return false;
            }
        };
        const ok = await findAndReplaceScope(getSSHConfigPath());
        if (ok) {
            return true;
        }
        return await findAndReplaceScope(systemSSHConfig);
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
}
