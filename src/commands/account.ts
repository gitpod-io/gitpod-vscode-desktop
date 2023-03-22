/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Command } from '../commandManager';
import { ISessionService } from '../sessionService';

export class SignInCommand implements Command {
	readonly id = 'gitpod.signIn';

	constructor(private readonly sessionService: ISessionService) { }

	async execute() {
		await this.sessionService.signIn();
	}
}
