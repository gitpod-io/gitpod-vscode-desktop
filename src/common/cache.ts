/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

const CACHE_KEY = 'gitpod.cache';

interface CacheObject {
	value: any;
	expiration?: number;
}

interface CacheMap { [key: string]: CacheObject }

export class CacheHelper {
	constructor(private readonly context: vscode.ExtensionContext) { }

	set(key: string, value: any, expiration?: number) {
		let obj = this.context.globalState.get<CacheMap>(CACHE_KEY);
		if (!obj) {
			obj = {};
		}
		const exp = expiration ? ((+ new Date()) / 1000 + expiration) : undefined;
		obj[key] = { value, expiration: exp };
		return this.context.globalState.update(CACHE_KEY, obj);
	}

	get(key: string) {
		const value = this.context.globalState.get<CacheMap>(CACHE_KEY);
		if (!value || !value[key]) {
			return undefined;
		}
		const data = value[key];
		if (!data.expiration) {
			return data.value;
		}
		const now = (+ new Date()) / 1000;
		return now > data.expiration ? undefined : data.value;
	}

	async handy<T>(key: string, cb: () => Thenable<{ value: T; ttl?: number }>) {
		let d = this.get(key);
		if (d === undefined) {
			const tmp = await cb();
			await this.set(key, tmp.value, tmp.ttl);
			d = tmp.value;
		}
		return d as T;
	}
}
