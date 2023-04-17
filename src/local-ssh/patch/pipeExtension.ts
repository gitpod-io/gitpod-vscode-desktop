/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, ChannelMessage, ChannelOpenConfirmationMessage, ChannelOpenFailureMessage, ChannelRequestMessage, PromiseCompletionSource, SshChannel, SshChannelClosedEventArgs, SshChannelError, SshChannelOpenFailureReason, SshChannelOpeningEventArgs, SshMessage, SshRequestEventArgs, SshSession, SshSessionClosedEventArgs, SshStream } from '@microsoft/dev-tunnels-ssh';
import { ChannelFailureMessage, ChannelSuccessMessage } from '@microsoft/dev-tunnels-ssh/messages/connectionMessages';

// Patch of https://github.com/microsoft/dev-tunnels-ssh/blob/main/src/ts/ssh/pipeExtensions.ts

export class PipeExtensions {
    public static async pipeSession(session: SshSession, toSession: SshSession): Promise<void> {
        if (!session) { throw new TypeError('Session is required.'); }
        if (!toSession) { throw new TypeError('Target session is required'); }

        const endCompletion = new PromiseCompletionSource<Promise<void>>();

        // session.onRequest((e) => {
        //     e.responsePromise = PipeExtensions.forwardSessionRequest(e, toSession, e.cancellation);
        // });
        // toSession.onRequest((e) => {
        //     e.responsePromise = PipeExtensions.forwardSessionRequest(e, session, e.cancellation);
        // });

        session.onChannelOpening((e) => {
            if (e.isRemoteRequest) {
                e.openingPromise = PipeExtensions.forwardChannel(e, toSession, e.cancellation);
            }
        });
        toSession.onChannelOpening((e) => {
            if (e.isRemoteRequest) {
                e.openingPromise = PipeExtensions.forwardChannel(e, session, e.cancellation);
            }
        });

        session.onClosed((e) => {
            endCompletion.resolve(PipeExtensions.forwardSessionClose(toSession, e));
        });
        toSession.onClosed((e) => {
            endCompletion.resolve(PipeExtensions.forwardSessionClose(session, e));
        });

        const endPromise = await endCompletion.promise;
        await endPromise;
    }

    public static async pipeChannel(channel: SshChannel, toChannel: SshChannel): Promise<void> {
        if (!channel) { throw new TypeError('Channel is required.'); }
        if (!toChannel) { throw new TypeError('Target channel is required'); }

        const endCompletion = new PromiseCompletionSource<Promise<void>>();
        let closed = false;

        channel.onRequest((e) => {
            e.responsePromise = PipeExtensions.forwardChannelRequest(e, toChannel, e.cancellation);
        });
        toChannel.onRequest((e) => {
            e.responsePromise = PipeExtensions.forwardChannelRequest(e, channel, e.cancellation);
        });

        const stream1 = new SshStream(channel);
        const stream2 = new SshStream(toChannel);
        stream1.pipe(stream2);
        stream2.pipe(stream1);

        // channel.onDataReceived((data) => {
        //     void PipeExtensions.forwardData(channel, toChannel, data).catch(console.error);
        // });
        // toChannel.onDataReceived((data) => {
        //     void PipeExtensions.forwardData(toChannel, channel, data).catch(console.error);
        // });

        channel.onClosed((e) => {
            if (!closed) {
                closed = true;
                endCompletion.resolve(PipeExtensions.forwardChannelClose(toChannel, e));
            }
        });
        toChannel.onClosed((e) => {
            if (!closed) {
                closed = true;
                endCompletion.resolve(PipeExtensions.forwardChannelClose(channel, e));
            }
        });

        const endTask = await endCompletion.promise;
        await endTask;
    }

    // private static async forwardSessionRequest(
    //     e: SshRequestEventArgs<SessionRequestMessage>,
    //     toSession: SshSession,
    //     cancellation?: CancellationToken,
    // ): Promise<SshMessage> {
    //     return await toSession.requestResponse(
    //         e.request,
    //         SessionRequestSuccessMessage,
    //         SessionRequestFailureMessage,
    //         cancellation,
    //     );
    // }

    private static async forwardChannel(
        e: SshChannelOpeningEventArgs,
        toSession: SshSession,
        cancellation?: CancellationToken,
    ): Promise<ChannelMessage> {
        try {
            const toChannel = await toSession.openChannel(e.request, null, cancellation);
            void PipeExtensions.pipeChannel(e.channel, toChannel).catch();
            return new ChannelOpenConfirmationMessage();
        } catch (err) {
            if (!(err instanceof Error)) { throw err; }

            const failureMessage = new ChannelOpenFailureMessage();
            if (err instanceof SshChannelError) {
                failureMessage.reasonCode = err.reason ?? SshChannelOpenFailureReason.connectFailed;
            } else {
                failureMessage.reasonCode = SshChannelOpenFailureReason.connectFailed;
            }

            failureMessage.description = err?.toString();
            // failureMessage.description = err.message;
            return failureMessage;
        }
    }

    private static async forwardChannelRequest(
        e: SshRequestEventArgs<ChannelRequestMessage>,
        toChannel: SshChannel,
        cancellation?: CancellationToken,
    ): Promise<SshMessage> {
        e.request.recipientChannel = toChannel.remoteChannelId;
        const result = await toChannel.request(e.request, cancellation);
        return result ? new ChannelSuccessMessage() : new ChannelFailureMessage();
    }

    private static async forwardSessionClose(
        session: SshSession,
        e: SshSessionClosedEventArgs,
    ): Promise<void> {
        return session.close(e.reason, e?.toString(), e?.error ?? undefined);
    }

    // private static async forwardData(
    //     channel: SshChannel,
    //     toChannel: SshChannel,
    //     data: Buffer,
    // ): Promise<void> {
    //     await toChannel.send(data, CancellationToken.None);
    //     channel.adjustWindow(data.length);
    // }

    private static async forwardChannelClose(
        channel: SshChannel,
        e: SshChannelClosedEventArgs,
    ): Promise<void> {
        if (e.error) {
            // @ts-ignore
            channel.close(e.error);
            return Promise.resolve();
        } else if (e.exitSignal) {
            return channel.close(e.exitSignal, e.errorMessage);
        } else if (typeof e.exitStatus === 'number') {
            return channel.close(e.exitStatus);
        } else {
            return channel.close();
        }
    }
}
