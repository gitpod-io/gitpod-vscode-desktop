/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EventEmitter, Event, Disposable } from 'vscode';

export function filterEvent<T>(event: Event<T>, filter: (e: T) => boolean): Event<T> {
	return (listener, thisArgs = null, disposables?) => event(e => filter(e) && listener.call(thisArgs, e), null, disposables);
}

/**
 * Given an event, returns another event which only fires once.
 *
 * @param event The event source for the new event.
 */
export function onceEvent<T>(event: Event<T>): Event<T> {
	return (listener, thisArgs = null, disposables?) => {
		// we need this, in case the event fires during the listener call
		let didFire = false;
		let result: Disposable | undefined = undefined;
		result = event(e => {
			if (didFire) {
				return;
			} else if (result) {
				result.dispose();
			} else {
				didFire = true;
			}

			return listener.call(thisArgs, e);
		}, null, disposables);

		if (didFire) {
			result.dispose();
		}

		return result;
	};
}

export interface PromiseAdapter<T, U> {
	(
		value: T,
		resolve:
			(value: U | PromiseLike<U>) => void,
		reject:
			(reason: any) => void
	): any;
}

const passthrough = (value: any, resolve: (value?: any) => void) => resolve(value);

/**
 * Return a promise that resolves with the next emitted event, or with some future
 * event as decided by an adapter.
 *
 * If specified, the adapter is a function that will be called with
 * `(event, resolve, reject)`. It will be called once per event until it resolves or
 * rejects.
 *
 * The default adapter is the passthrough function `(value, resolve) => resolve(value)`.
 *
 * @param event the event
 * @param adapter controls resolution of the returned promise
 * @returns a promise that resolves or rejects as specified by the adapter
 */
export function promiseFromEvent<T, U>(
	event: Event<T>,
	adapter: PromiseAdapter<T, U> = passthrough): { promise: Promise<U>; cancel: EventEmitter<void> } {
	let subscription: Disposable;
	let cancel = new EventEmitter<void>();
	return {
		promise: new Promise<U>((resolve, reject) => {
			cancel.event(_ => reject('Cancelled'));
			subscription = event((value: T) => {
				try {
					Promise.resolve(adapter(value, resolve, reject))
						.catch(reject);
				} catch (error) {
					reject(error);
				}
			});
		}).then(
			(result: U) => {
				subscription.dispose();
				return result;
			},
			error => {
				subscription.dispose();
				throw error;
			}
		),
		cancel
	};
}

export function eventToPromise<T>(event: Event<T>): Promise<T> {
	return new Promise(resolve => onceEvent(event)(resolve));
}

export function arrayEquals<T>(one: ReadonlyArray<T> | undefined, other: ReadonlyArray<T> | undefined, itemEquals: (a: T, b: T) => boolean = (a, b) => a === b): boolean {
	if (one === other) {
		return true;
	}

	if (!one || !other) {
		return false;
	}

	if (one.length !== other.length) {
		return false;
	}

	for (let i = 0, len = one.length; i < len; i++) {
		if (!itemEquals(one[i], other[i])) {
			return false;
		}
	}

	return true;
}

/**
 * Escapes regular expression characters in a given string
 */
export function escapeRegExpCharacters(value: string): string {
	return value.replace(/[\\\{\}\*\+\?\|\^\$\.\[\]\(\)]/g, '\\$&');
}

export function cloneAndChange(obj: any, changer: (orig: any) => any): any {
	return _cloneAndChange(obj, changer, new Set());
}

function _isObject(obj: unknown): obj is Object {
	// The method can't do a type cast since there are type (like strings) which
	// are subclasses of any put not positvely matched by the function. Hence type
	// narrowing results in wrong results.
	return typeof obj === 'object'
		&& obj !== null
		&& !Array.isArray(obj)
		&& !(obj instanceof RegExp)
		&& !(obj instanceof Date);
}

function _cloneAndChange(obj: any, changer: (orig: any) => any, seen: Set<any>): any {
	if (obj === undefined || obj === null) {
		return obj;
	}

	const changed = changer(obj);
	if (typeof changed !== 'undefined') {
		return changed;
	}

	if (Array.isArray(obj)) {
		const r1: any[] = [];
		for (const e of obj) {
			r1.push(_cloneAndChange(e, changer, seen));
		}
		return r1;
	}

	if (_isObject(obj)) {
		if (seen.has(obj)) {
			throw new Error('Cannot clone recursive data-structure');
		}
		seen.add(obj);
		const r2 = {};
		for (const i2 in obj) {
			if (Object.hasOwnProperty.call(obj, i2)) {
				(r2 as any)[i2] = _cloneAndChange(obj[i2], changer, seen);
			}
		}
		seen.delete(obj);
		return r2;
	}

	return obj;
}

/**
 * Copies all properties of source into destination. The optional parameter "overwrite" allows to control
 * if existing properties on the destination should be overwritten or not. Defaults to true (overwrite).
 */
export function mixin(destination: any, source: any, overwrite: boolean = true): any {
	if (!_isObject(destination)) {
		return source;
	}

	if (_isObject(source)) {
		Object.keys(source).forEach(key => {
			if (key in destination) {
				if (overwrite) {
					if (_isObject(destination[key]) && _isObject(source[key])) {
						mixin(destination[key], source[key], overwrite);
					} else {
						destination[key] = source[key];
					}
				}
			} else {
				destination[key] = source[key];
			}
		});
	}
	return destination;
}

export function groupBy<T>(data: ReadonlyArray<T>, compare: (a: T, b: T) => number): T[][] {
	const result: T[][] = [];
	let currentGroup: T[] | undefined = undefined;
	for (const element of data.slice(0).sort(compare)) {
		if (!currentGroup || compare(currentGroup[0], element) !== 0) {
			currentGroup = [element];
			result.push(currentGroup);
		} else {
			currentGroup.push(element);
		}
	}
	return result;
}

export function stringCompare(a: string, b: string): number {
	if (a < b) {
		return -1;
	} else if (a > b) {
		return 1;
	} else {
		return 0;
	}
}

export function getServiceURL(gitpodHost: string): string {
	return new URL(gitpodHost).toString().replace(/\/$/, '');
}

export class WrapError extends Error {
	code: string | undefined;
	constructor(msg: string, err: any, code?: string) {
		super(msg);
		if (err instanceof Error) {
			this.name = err.name;
			this.stack = err.stack;
			this.message = `${msg}: ${err.message}`;
		}
		this.code = code ? code : err.code;
	}
}
