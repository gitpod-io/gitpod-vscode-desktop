/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// This public key is safe to be public since we only use it to verify local-ssh connections.
const HOST_KEY = 'LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0tCk1JR0hBZ0VBTUJNR0J5cUdTTTQ5QWdFR0NDcUdTTTQ5QXdFSEJHMHdhd0lCQVFRZ1QwcXg1eEJUVmc4TUVJbUUKZmN4RXRZN1dmQVVsM0JYQURBK2JYREsyaDZlaFJBTkNBQVJlQXo0RDVVZXpqZ0l1SXVOWXpVL3BCWDdlOXoxeApvZUN6UklqcGdCUHozS0dWRzZLYXV5TU5YUm95a21YSS9BNFpWaW9nd2Vjb0FUUjRUQ2FtWm1ScAotLS0tLUVORCBQUklWQVRFIEtFWS0tLS0tCg==';
const HOST_PUBLIC_FP = 'AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBF4DPgPlR7OOAi4i41jNT+kFft73PXGh4LNEiOmAE/PcoZUbopq7Iw1dGjKSZcj8DhlWKiDB5ygBNHhMJqZmZGk=';
export const HOST_PUBLIC_KEY_TYPE = 'ecdsa-sha2-nistp256';
export function getHostKey(): Buffer {
	return Buffer.from(HOST_KEY, 'base64');
}
export function getHostKeyFingerprint(): Buffer {
	return Buffer.from(HOST_PUBLIC_FP, 'base64');
}

export function getDaemonVersion() {
	return process.env.DAEMON_VERSION ?? '0.0.1';
}
