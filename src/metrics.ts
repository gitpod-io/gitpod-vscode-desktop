/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as grpc from '@grpc/grpc-js';
import { Registry, Counter, Histogram, metric } from 'prom-client';
import { Code, connectErrorFromReason, Interceptor, StreamRequest, UnaryRequest } from '@bufbuild/connect-node';
import { MethodKind } from '@bufbuild/protobuf';
import { codeToString, StreamResponse, UnaryResponse } from '@bufbuild/connect-core';

export type GrpcMethodType = 'unary' | 'client_stream' | 'server_stream' | 'bidi_stream';

export interface IGrpcCallMetricsLabels {
    service: string;
    method: string;
    type: GrpcMethodType;
}

export interface IGrpcCallMetricsLabelsWithCode extends IGrpcCallMetricsLabels {
    code: string;
}

const register = new Registry();

class PrometheusClientCallMetrics {
    readonly startedCounter: Counter<string>;
    readonly sentCounter: Counter<string>;
    readonly receivedCounter: Counter<string>;
    readonly handledCounter: Counter<string>;
    readonly handledSecondsHistogram: Histogram<string>;

    constructor() {
        this.startedCounter = new Counter({
            name: 'grpc_client_started_total',
            help: 'Total number of RPCs started on the client.',
            labelNames: ['grpc_service', 'grpc_method', 'grpc_type'],
            registers: [register],
        });
        this.sentCounter = new Counter({
            name: 'grpc_client_msg_sent_total',
            help: ' Total number of gRPC stream messages sent by the client.',
            labelNames: ['grpc_service', 'grpc_method', 'grpc_type'],
            registers: [register],
        });
        this.receivedCounter = new Counter({
            name: 'grpc_client_msg_received_total',
            help: 'Total number of RPC stream messages received by the client.',
            labelNames: ['grpc_service', 'grpc_method', 'grpc_type'],
            registers: [register],
        });
        this.handledCounter = new Counter({
            name: 'grpc_client_handled_total',
            help: 'Total number of RPCs completed by the client, regardless of success or failure.',
            labelNames: ['grpc_service', 'grpc_method', 'grpc_type', 'grpc_code'],
            registers: [register],
        });
        this.handledSecondsHistogram = new Histogram({
            name: 'grpc_client_handling_seconds',
            help: 'Histogram of response latency (seconds) of the gRPC until it is finished by the application.',
            labelNames: ['grpc_service', 'grpc_method', 'grpc_type', 'grpc_code'],
            buckets: [0.1, 0.2, 0.5, 1, 2, 5, 10], // it should be aligned with https://github.com/gitpod-io/gitpod/blob/84ed1a0672d91446ba33cb7b504cfada769271a8/install/installer/pkg/components/ide-metrics/configmap.go#L315
            registers: [register],
        });
    }

    started(labels: IGrpcCallMetricsLabels): void {
        this.startedCounter.inc({
            grpc_service: labels.service,
            grpc_method: labels.method,
            grpc_type: labels.type,
        });
    }

    sent(labels: IGrpcCallMetricsLabels): void {
        this.sentCounter.inc({
            grpc_service: labels.service,
            grpc_method: labels.method,
            grpc_type: labels.type,
        });
    }

    received(labels: IGrpcCallMetricsLabels): void {
        this.receivedCounter.inc({
            grpc_service: labels.service,
            grpc_method: labels.method,
            grpc_type: labels.type,
        });
    }

    handled(labels: IGrpcCallMetricsLabelsWithCode): void {
        this.handledCounter.inc({
            grpc_service: labels.service,
            grpc_method: labels.method,
            grpc_type: labels.type,
            grpc_code: labels.code,
        });
    }

    startHandleTimer(
        labels: IGrpcCallMetricsLabels,
    ): (labels?: Partial<Record<string, string | number>> | undefined) => number {
        return this.handledSecondsHistogram.startTimer({
            grpc_service: labels.service,
            grpc_method: labels.method,
            grpc_type: labels.type,
        });
    }
}

const GRPCMetrics = new PrometheusClientCallMetrics();

export function getConnectMetricsInterceptor(): Interceptor {
    const getLabels = (req: UnaryRequest | StreamRequest): IGrpcCallMetricsLabels => {
        let type: GrpcMethodType;
        switch (req.method.kind) {
            case MethodKind.Unary: type = 'unary'; break;
            case MethodKind.ServerStreaming: type = 'server_stream'; break;
            case MethodKind.ClientStreaming: type = 'client_stream'; break;
            case MethodKind.BiDiStreaming: type = 'bidi_stream'; break;
        }
        return {
            type,
            service: req.service.typeName,
            method: req.method.name,
        };
    };

    return (next) => async (req) => {
        async function* incrementStreamMessagesCounter<T>(iterable: AsyncIterable<T>, callback: () => void, handleMetrics: boolean): AsyncIterable<T> {
            let status: Code | undefined;
            try {
                for await (const item of iterable) {
                    callback();
                    yield item;
                }
            } catch (e) {
                const err = connectErrorFromReason(e, Code.Internal);
                status = err.code;
                throw e;
            } finally {
                if (handleMetrics && !settled) {
                    stopTimer({ grpc_code: status ? codeToString(status).toUpperCase() : 'OK' });
                    GRPCMetrics.handled({ ...labels, code: status ? codeToString(status).toUpperCase() : 'OK' });
                }
            }
        }

        const labels = getLabels(req);
        const stopTimer = GRPCMetrics.startHandleTimer(labels);

        let settled = false;
        let status: Code | undefined;
        try {
            let request: UnaryRequest | StreamRequest;
            if (!req.stream) {
                request = req;
            } else {
                request = {
                    ...req,
                    message: incrementStreamMessagesCounter(req.message, GRPCMetrics.sent.bind(GRPCMetrics, labels), false)
                };
            }

            const res = await next(request);

            let response: UnaryResponse | StreamResponse;
            if (!res.stream) {
                response = res;
                settled = true;
            } else {
                response = {
                    ...res,
                    message: incrementStreamMessagesCounter(res.message, GRPCMetrics.received.bind(GRPCMetrics, labels), true)
                };
            }

            return response;
        } catch (e) {
            settled = true;
            const err = connectErrorFromReason(e, Code.Internal);
            status = err.code;
            throw err;
        } finally {
            if (settled) {
                stopTimer({ grpc_code: status ? codeToString(status).toUpperCase() : 'OK' });
                GRPCMetrics.handled({ ...labels, code: status ? codeToString(status).toUpperCase() : 'OK' });
            }
        }
    };
}

export function getGrpcMetricsInterceptor(): grpc.Interceptor {
    const getLabels = (path:string, requestStream:boolean, responseStream:boolean): IGrpcCallMetricsLabels => {
        const method = path.substring(path.lastIndexOf('/') + 1);
        const service = path.substring(1, path.length - method.length - 1);
        let type: GrpcMethodType;
        if (requestStream) {
            if (responseStream) {
                type = 'bidi_stream';
            } else {
                type = 'client_stream';
            }
        } else {
            if (responseStream) {
                type = 'server_stream';
            } else {
                type = 'unary';
            }
        }
        return {
            type,
            service,
            method,
        };
    };

    return (options, nextCall): grpc.InterceptingCall => {
        const methodDef = options.method_definition;
        const labels = getLabels(methodDef.path, methodDef.requestStream, methodDef.responseStream);
        const requester = new grpc.RequesterBuilder()
            .withStart((metadata, _listener, next) => {
                const newListener = new grpc.ListenerBuilder()
                    .withOnReceiveStatus((status, next) => {
                        try {
                            GRPCMetrics.handled({
                                ...labels,
                                code: grpc.status[status.code],
                            });
                        } finally {
                            next(status);
                        }
                    })
                    .withOnReceiveMessage((message, next) => {
                        try {
                            GRPCMetrics.received(labels);
                        } finally {
                            next(message);
                        }
                    })
                    .build();
                try {
                    GRPCMetrics.started(labels);
                } finally {
                    next(metadata, newListener);
                }
            })
            .withSendMessage((message, next) => {
                try {
                    GRPCMetrics.sent(labels);
                } finally {
                    next(message);
                }
            })
            .build();
        return new grpc.InterceptingCall(nextCall(options), requester);
    };
}

export class MetricsReporter {
    private static readonly REPORT_INTERVAL = 60000;

    private metricsHost: string;
    private intervalHandler: NodeJS.Timer | undefined;

    constructor(gitpodHost: string, private logger: vscode.LogOutputChannel) {
        const serviceUrl = new URL(gitpodHost);
        this.metricsHost = `ide.${serviceUrl.hostname}`;
    }

    startReporting() {
        if (this.intervalHandler) {
            return;
        }
        this.intervalHandler = setInterval(() => this.report().catch(e => this.logger.error('Error while reporting metrics', e)), MetricsReporter.REPORT_INTERVAL);
    }

    private async report() {
        const metrics = await register.getMetricsAsJSON();
        register.resetMetrics();
        for (const m of metrics) {
            const type = m.type as unknown as string;
            if (type === 'counter') {
                await this.reportCounter(m);
            } else if (type === 'histogram') {
                await this.reportHistogram(m);
            }
        }
    }

    private async reportCounter(metric: metric) {
        const counterMetric = metric as metric & { values: [{ value: number; labels: Record<string, string> }] };
        for (const { value, labels } of counterMetric.values) {
            if (value > 0) {
                await this.doAddCounter(counterMetric.name, labels, value);
            }
        }
    }

    private async reportHistogram(metric: metric) {
        const histogramMetric = metric as metric & { values: [{ value: number; labels: Record<string, string>; metricName: string }] };
        let sum = 0;
        let buckets: number[] = [];
        for (const { value, labels, metricName } of histogramMetric.values) {
            // metricName are in the following order _bucket, _sum, _count
            // We report on _count as it's the last
            // https://github.com/siimon/prom-client/blob/eee34858d2ef4198ff94f56a278d7b81f65e9c63/lib/histogram.js#L222-L235
            if (metricName.endsWith('_bucket')) {
                if (labels['le'] !== '+Inf') {
                    buckets.push(value);
                }
            } else if (metricName.endsWith('_sum')) {
                sum = value;
            } else if (metricName.endsWith('_count')) {
                if (value > 0) {
                    await this.doAddHistogram(histogramMetric.name, labels, value, sum, buckets);
                }
                sum = 0;
                buckets = [];
            }
        }
    }

    private async doAddCounter(name: string, labels: Record<string, string>, value: number) {
        const data = {
            name,
            labels,
            value,
        };

        const resp = await fetch(
            `https://${this.metricsHost}/metrics-api/metrics/counter/add/${name}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data)
            }
        );

        if (!resp.ok) {
            throw new Error(`Metrics endpoint responded with ${resp.status} ${resp.statusText}`);
        }
    }

    private async doAddHistogram(name: string, labels: Record<string, string>, count: number, sum: number, buckets: number[]) {
        const data = {
            name,
            labels,
            count,
            sum,
            buckets,
        };

        const resp = await fetch(
            `https://${this.metricsHost}/metrics-api/metrics/histogram/add/${name}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data)
            }
        );

        if (!resp.ok) {
            throw new Error(`Metrics endpoint responded with ${resp.status} ${resp.statusText}`);
        }
    }

    stopReporting() {
        if (this.intervalHandler) {
            clearInterval(this.intervalHandler);
        }
    }
}
