/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// From https://github.com/microsoft/vscode/blob/5413247e57fb7e3d29cd36f08266005fe72bbde4/src/vs/platform/extensionManagement/common/extensionsProfileScannerService.ts#L24-L30

export interface IStoredProfileExtension {
	identifier: IExtensionIdentifier;
	location: UriComponents | string;
	relativeLocation: string | undefined;
	version: string;
	metadata?: Metadata;
}

interface IExtensionIdentifier {
	id: string;
	uuid?: string;
}

interface UriComponents {
	scheme: string;
	authority?: string;
	path?: string;
	query?: string;
	fragment?: string;
}

interface IGalleryMetadata {
	id: string;
	publisherId: string;
	publisherDisplayName: string;
	isPreReleaseVersion: boolean;
	targetPlatform?: string;
}

type Metadata = Partial<IGalleryMetadata & {
	isApplicationScoped: boolean;
	isMachineScoped: boolean;
	isBuiltin: boolean;
	isSystem: boolean;
	updated: boolean;
	preRelease: boolean;
	installedTimestamp: number;
	pinned: boolean;
}>;
