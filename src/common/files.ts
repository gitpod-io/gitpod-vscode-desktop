/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';

const homeDir = os.homedir();

export async function exists(path: string) {
    try {
        await fs.promises.access(path);
        return true;
    } catch {
        return false;
    }
}

export async function isFile(path: string) {
    try {
        const s = await fs.promises.stat(path);
        return s.isFile();
    } catch {
        return false;
    }
}

export function untildify(path: string){
	return path.replace(/^~(?=$|\/|\\)/, homeDir);
}
