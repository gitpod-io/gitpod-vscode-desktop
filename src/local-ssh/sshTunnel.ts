/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChannelOpenMessage, SshClientCredentials, SshClientSession, SshDataWriter, SshSessionConfiguration, SshStream, Stream, WebSocketStream } from '@microsoft/dev-tunnels-ssh';
import { TunnelPortRequest } from '@gitpod/supervisor-api-grpc/lib/port_pb';
import { WebSocket } from 'ws';
import { ControlService } from '@gitpod/supervisor-api-grpcweb/lib/control_pb_service';
import { CreateSSHKeyPairRequest, CreateSSHKeyPairResponse } from '@gitpod/supervisor-api-grpcweb/lib/control_pb';
import { NodeHttpTransport } from '@improbable-eng/grpc-web-node-http-transport';
import { grpc } from '@improbable-eng/grpc-web';
import { BrowserHeaders } from 'browser-headers';
import { ILogService } from '../services/logService';
import { ExtensionServiceDefinition, GetWorkspaceAuthInfoResponse, SendLocalSSHUserFlowStatusRequest_Code, SendLocalSSHUserFlowStatusRequest_ConnType, SendLocalSSHUserFlowStatusRequest_Status } from '../proto/typescript/ipc/v1/ipc';
import { Client } from 'nice-grpc';
import { getDaemonVersion } from './common';

grpc.setDefaultTransport(NodeHttpTransport());

class SupervisorPortTunnelMessage extends ChannelOpenMessage {
	constructor(private clientId: string, private remotePort: number, channelType: string) {
		super();
		this.channelType = channelType;
	}

	override onWrite(writer: SshDataWriter): void {
		super.onWrite(writer);
		const req = new TunnelPortRequest();
		req.setClientId(this.clientId);
		req.setTargetPort(this.remotePort);
		req.setPort(this.remotePort);

		let bytes = req.serializeBinary();
		writer.write(Buffer.from(bytes));
	}

	override toString() {
		return `${super.toString()}`;
	}
}

export class SupervisorSSHTunnel {

	constructor(
		private readonly logger: ILogService,
		readonly workspaceInfo: GetWorkspaceAuthInfoResponse,
		private extensionIpc: Client<ExtensionServiceDefinition>,
	) { }

	private createPrivateKey(): Promise<string> {
		const metadata = new BrowserHeaders();
		metadata.append('x-gitpod-owner-token', this.workspaceInfo.ownerToken);
		return new Promise((resolve, reject) => {
			grpc.unary(ControlService.CreateSSHKeyPair, {
				request: new CreateSSHKeyPairRequest(),
				host: `${this.workspaceUrl}/_supervisor/v1`,
				metadata,
				onEnd: res => {
					const { status, statusMessage, message } = res;
					if (status === grpc.Code.OK && message instanceof CreateSSHKeyPairResponse) {
						resolve(message.toObject().privateKey);
					} else {
						reject(statusMessage);
					}
				}
			});
		});
	}

	private get workspaceUrl() {
		return `https://${this.workspaceInfo.workspaceId}.${this.workspaceInfo.workspaceHost}`;
	}

	private get workspaceWSUrl() {
		return `wss://${this.workspaceInfo.workspaceId}.${this.workspaceInfo.workspaceHost}`;
	}

	public async establishTunnel() {
		const privateKey = await this.createPrivateKey().catch(e => {
			this.extensionIpc.sendLocalSSHUserFlowStatus({
				gitpodHost: this.workspaceInfo.gitpodHost,
				userId: this.workspaceInfo.userId,
				status: SendLocalSSHUserFlowStatusRequest_Status.STATUS_FAILURE,
				workspaceId: this.workspaceInfo.workspaceId,
				instanceId: this.workspaceInfo.instanceId,
				failureCode: SendLocalSSHUserFlowStatusRequest_Code.CODE_TUNNEL_NO_PRIVATEKEY,
				connType: SendLocalSSHUserFlowStatusRequest_ConnType.CONN_TYPE_TUNNEL,
			});
			throw e;
		});

		const socket = new WebSocket(this.workspaceWSUrl + '/_supervisor/tunnel', undefined, {
			headers: {
				'x-gitpod-owner-token': this.workspaceInfo.ownerToken
			}
		});

		socket.binaryType = 'arraybuffer';
		const stream = await new Promise<Stream>((resolve, reject) => {
			socket.onopen = () => {
				resolve(new WebSocketStream(socket as any));
			};
			socket.onerror = (e) => {
				this.logger.error(e as any, 'failed to connect to server');
				this.extensionIpc.sendLocalSSHUserFlowStatus({
					gitpodHost: this.workspaceInfo.gitpodHost,
					userId: this.workspaceInfo.userId,
					status: SendLocalSSHUserFlowStatusRequest_Status.STATUS_FAILURE,
					workspaceId: this.workspaceInfo.workspaceId,
					instanceId: this.workspaceInfo.instanceId,
					failureCode: SendLocalSSHUserFlowStatusRequest_Code.CODE_TUNNEL_CANNOT_CREATE_WEBSOCKET,
					daemonVersion: getDaemonVersion(),
					connType: SendLocalSSHUserFlowStatusRequest_ConnType.CONN_TYPE_TUNNEL,
				});
				reject(e);
			};
		});

		const config = new SshSessionConfiguration();
		const session = new SshClientSession(config);
		session.onAuthenticating((e) => e.authenticationPromise = Promise.resolve({}));
		await session.connect(stream);

		const credentials: SshClientCredentials = { username: 'gitpodlocal' };
		const authenticated = await session.authenticate(credentials);
		if (!authenticated) {
			throw new Error('Authentication failed');
		}
		const clientID = 'tunnel_' + Math.random().toString(36).slice(2);
		const msg = new SupervisorPortTunnelMessage(clientID, 23001, 'tunnel');
		const channel = await session.openChannel(msg).catch(e => {
			this.extensionIpc.sendLocalSSHUserFlowStatus({
				gitpodHost: this.workspaceInfo.gitpodHost,
				userId: this.workspaceInfo.userId,
				status: SendLocalSSHUserFlowStatusRequest_Status.STATUS_FAILURE,
				workspaceId: this.workspaceInfo.workspaceId,
				instanceId: this.workspaceInfo.instanceId,
				failureCode: SendLocalSSHUserFlowStatusRequest_Code.CODE_TUNNEL_FAILED_FORWARD_SSH_PORT,
				daemonVersion: getDaemonVersion(),
				connType: SendLocalSSHUserFlowStatusRequest_ConnType.CONN_TYPE_TUNNEL,
			});
			throw e;
		});
		return { sock: new SshStream(channel), privateKey: Buffer.from(privateKey), username: 'gitpod' };
	}
}
