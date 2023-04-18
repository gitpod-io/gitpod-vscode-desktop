/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function timeout(millis: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, millis));
}

export interface ITask<T> {
	(): T;
}

export async function retry<T>(task: ITask<Promise<T>>, delay: number, retries: number): Promise<T> {
	let lastError: Error | undefined;

	for (let i = 0; i < retries; i++) {
		try {
			return await task();
		} catch (error) {
			lastError = error;

			await timeout(delay);
		}
	}

	throw lastError;
}

export async function retryWithStop<T>(task: (stop: () => void) => Promise<T>, delay: number, retries: number): Promise<T> {
	let lastError: Error | undefined;
	let stopped = false;
	const stop = () => {
		stopped = true;
	};
	for (let i = 0; i < retries; i++) {
		try {
			return await task(stop);
		} catch (error) {
			lastError = error;
			if (stopped) {
				break;
			}
			await timeout(delay);
		}
	}
	throw lastError;
}
