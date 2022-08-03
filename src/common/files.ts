/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const homeDir = os.homedir();

export async function exists(path: string) {
    try {
        await fs.promises.access(path);
        return true;
    } catch {
        return false;
    }
}

export function untildify(path: string){
	return path.replace(/^~(?=$|\/|\\)/, homeDir);
}

export function resolveHomeDir(filepath: string | undefined) {
    if (!filepath) {
        return filepath;
    }
    const homedir = os.homedir();
    if (filepath === '~') {
        return homedir;
    }
    if (filepath.startsWith('~/')) {
        return path.join(homedir, filepath.slice(2));
    }
    return filepath;
}
