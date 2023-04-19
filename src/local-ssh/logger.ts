/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import winston from 'winston';
import { ILogService } from '../services/logService';

export enum ExitCode {
    OK = 0,
    ListenPortFailed = 100,
    UnexpectedError = 101,
    InvalidOptions = 102,
}

const DefaultLogFormatter = winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true }), winston.format.simple());
export class Logger implements ILogService {
    private logger: winston.Logger;

    constructor(logLevel: 'debug' | 'info', logFile: string) {
        this.logger = winston.createLogger({
            level: logLevel,
            defaultMeta: { pid: process.pid },
            transports: [
                new winston.transports.File({ format: DefaultLogFormatter, filename: logFile, options: { flags: 'a' }, maxsize: 1024 * 1024 * 10 /* 10M */, maxFiles: 1 }),
            ],
            exitOnError: false,
        });
    }

    trace(message: string, ...args: any[]): void {
        this.logger.debug(message, ...args);
    }
    debug(message: string, ...args: any[]): void {
        this.logger.debug(message, ...args);
    }
    info(message: string, ...args: any[]): void {
        this.logger.info(message, ...args);
    }
    warn(message: string, ...args: any[]): void {
        this.logger.warn(message, ...args);
    }
    error(error: string | Error, ...args: any[]): void {
        this.logger.error(error as any, ...args);
    }

    show(): void {
        // no-op
    }
}