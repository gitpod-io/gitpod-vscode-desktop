/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import SSHConfiguration from './ssh/sshConfig';
import { writeFileSync } from 'fs';

// This script gets executed when the extension is completely uninstalled from VS Code which is when VS Code is restarted (shutdown and start) after the extension is uninstalled.
async function uninstall() {
    await SSHConfiguration.removeGitpodSSHConfig();
}

uninstall().then(() => {
    writeFileSync('/Users/hwen/outputFile2', 'hello world');
    process.exit(0);
}).catch(e => {
    writeFileSync('/Users/hwen/outputFile2-err', e.toString());
    console.error(e);
    process.exit(-1);
});

