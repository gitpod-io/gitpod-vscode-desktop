/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Command } from '../commandManager';
import { IRemoteService } from '../services/remoteService';

export class InstallLocalExtensionsOnRemoteCommand implements Command {
	readonly id = 'gitpod.installLocalExtensions';

	constructor(private readonly remoteService: IRemoteService) { }

	async execute() {
		await this.remoteService.initializeRemoteExtensions();
	}
}
