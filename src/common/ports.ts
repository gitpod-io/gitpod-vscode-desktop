/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as net from 'net';

export async function isPortUsed(port: number): Promise<boolean> {
    return new Promise<boolean>((resolve, _reject) => {
        const server = net.createServer();
        server.once('error', () => {
            resolve(true);
        });
        server.once('listening', () => {
            server.close();
            resolve(false);
        });
        server.listen(port);
    });
}
