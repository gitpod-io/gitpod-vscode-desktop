/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Collect error messages from nested errors as seen with Node's `fetch`.
function collectFetchErrorMessages(e: any): string {
    const seen = new Set<any>();
    function collect(e: any, indent: string): string {
        if (!e || typeof e !== 'object' || seen.has(e)) {
            return '';
        }
        seen.add(e);
        const message = e.stack || e.message || e.code || e.toString?.() || '';
        const messageStr = message.toString?.() as (string | undefined) || '';
        return [
            messageStr ? `${messageStr.split('\n').map(line => `${indent}${line}`).join('\n')}\n` : '',
            collect(e.cause, indent + '  '),
            ...(Array.isArray(e.errors) ? e.errors.map((e: any) => collect(e, indent + '  ')) : []),
        ].join('');
    }
    return collect(e, '').trim();
}

export function unwrapFetchError(e: any) {
    const err = new Error();
    // Put collected messaged in the stack so vscode logger prints it
    err.stack = collectFetchErrorMessages(e);
    err.cause = undefined;
    err.message = 'fetch error';
    return err;
}
