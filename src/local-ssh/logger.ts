/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WriteStream, createWriteStream } from 'fs';
import { inspect } from 'util';
import { ILogService } from '../services/logService';

export class NopeLogger implements ILogService {
    trace(_message: string, ..._args: any[]): void { }
    debug(_message: string, ..._args: any[]): void { }
    info(_message: string, ..._args: any[]): void { }
    warn(_message: string, ..._args: any[]): void { }
    error(_error: string | Error, ..._args: any[]): void { }
    show(): void { }
}

export class DebugLogger implements ILogService {
    private readonly stream?: WriteStream;

    constructor() {
        try {
            // no need to consider target file for different platform
            // since we use in only for debug local ssh proxy
            this.stream = createWriteStream('/tmp/lssh.log');
        } catch (_e) { }
    }

    private parseArgs(...args: any[]) {
        return args.map(e => inspect(e)).join(' ');
    }

    trace(message: string, ...args: any[]): void {
        this.stream?.write(`${new Date()}TRACE: ${message} ${this.parseArgs(...args)}\n`);
    }

    debug(message: string, ...args: any[]): void {
        this.stream?.write(`${new Date()}DEBUG: ${message} ${this.parseArgs(...args)}\n`);
    }

    info(message: string, ...args: any[]): void {
        this.stream?.write(`${new Date()}INFO: ${message} ${this.parseArgs(...args)}\n`);
    }

    warn(message: string, ...args: any[]): void {
        this.stream?.write(`${new Date()}WARN: ${message} ${this.parseArgs(...args)}\n`);
    }

    error(error: string | Error, ...args: any[]): void {
        if (error instanceof Error) {
            this.stream?.write(`${new Date()}ERROR: ${error.toString()}\n${error.stack}\n${this.parseArgs(...args)}\n`);
        } else {
            this.stream?.write(`${new Date()}ERROR: ${error.toString()} ${this.parseArgs(...args)}\n`);
        }
    }

    show(): void { }
}