/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function getDaemonVersion() {
    return process.env.DAEMON_VERSION ?? '0.0.1';
}

export function getSegmentKey() {
    return process.env.SEGMENT_KEY ?? '';
}