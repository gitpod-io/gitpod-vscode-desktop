/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ITelemetryService, UserFlowTelemetry } from './telemetryService';

export interface NotificationOption extends vscode.MessageOptions {
    id: string;
    flow: UserFlowTelemetry;
}

export interface INotificationService {
    showInformationMessage<T extends vscode.MessageItem | string>(message: string, option: NotificationOption, ...items: T[]): Promise<T | undefined>;
    showWarningMessage<T extends vscode.MessageItem | string>(message: string, option: NotificationOption, ...items: T[]): Promise<T | undefined>;
    showErrorMessage<T extends vscode.MessageItem | string>(message: string, option: NotificationOption, ...items: T[]): Promise<T | undefined>;
}

export class NotificationService implements INotificationService {

    constructor(private readonly telemetryService: ITelemetryService) { }

    showInformationMessage<T extends vscode.MessageItem | string>(message: string, option: NotificationOption, ...items: T[]): Promise<T | undefined> {
        return this.withTelemetry<T>(option, 'info', () =>
            vscode.window.showInformationMessage(message, option, ...<any[]>items)
        );
    }

    showWarningMessage<T extends vscode.MessageItem | string>(message: string, option: NotificationOption, ...items: T[]): Promise<T | undefined> {
        return this.withTelemetry<T>(option, 'warning', () =>
            vscode.window.showWarningMessage(message, option, ...<any[]>items)
        );
    }

    showErrorMessage<T extends vscode.MessageItem | string>(message: string, option: NotificationOption, ...items: T[]): Promise<T | undefined> {
        return this.withTelemetry<T>(option, 'error', () =>
            vscode.window.showErrorMessage(message, option, ...<any[]>items)
        );
    }

    private async withTelemetry<T extends vscode.MessageItem | string>(option: NotificationOption, severity: 'info' | 'warning' | 'error', cb: () => PromiseLike<T | undefined>): Promise<T | undefined> {
        const startTime = new Date().getTime();
        let element = option.id;
        if (option.modal === true) {
            element += '_modal';
        } else {
            element += '_notification';
        }
        const flowOptions = { ...option.flow, severity };
        this.telemetryService.sendUserFlowStatus('show_' + element, flowOptions);
        let result: T | undefined;
        try {
            result = await cb();
        } finally {
            const duration = new Date().getTime() - startTime;
            const closed = result === undefined || (typeof result === 'object' && result.isCloseAffordance === true);
            const action = typeof result === 'string' ? result : result?.title;
            this.telemetryService.sendUserFlowStatus('hide_' + element, { ...flowOptions, action, duration, closed });
        }
        return result;
    }
}
