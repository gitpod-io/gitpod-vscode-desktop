/* eslint-disable */
import type { CallContext, CallOptions } from "nice-grpc-common";
import * as _m0 from "protobufjs/minimal";

export const protobufPackage = "ipc.v1";

export interface ActiveRequest {
  /** id is the extenson id */
  id: string;
}

export interface ActiveResponse {
}

export interface InactiveRequest {
  id: string;
}

export interface InactiveResponse {
}

export interface PingRequest {
}

export interface PingResponse {
}

export interface GetWorkspaceAuthInfoRequest {
  workspaceId: string;
}

export interface GetWorkspaceAuthInfoResponse {
  workspaceId: string;
  workspaceHost: string;
  ownerToken: string;
}

function createBaseActiveRequest(): ActiveRequest {
  return { id: "" };
}

export const ActiveRequest = {
  encode(message: ActiveRequest, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.id !== "") {
      writer.uint32(10).string(message.id);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): ActiveRequest {
    const reader = input instanceof _m0.Reader ? input : new _m0.Reader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseActiveRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.id = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },

  fromJSON(object: any): ActiveRequest {
    return { id: isSet(object.id) ? String(object.id) : "" };
  },

  toJSON(message: ActiveRequest): unknown {
    const obj: any = {};
    message.id !== undefined && (obj.id = message.id);
    return obj;
  },

  create(base?: DeepPartial<ActiveRequest>): ActiveRequest {
    return ActiveRequest.fromPartial(base ?? {});
  },

  fromPartial(object: DeepPartial<ActiveRequest>): ActiveRequest {
    const message = createBaseActiveRequest();
    message.id = object.id ?? "";
    return message;
  },
};

function createBaseActiveResponse(): ActiveResponse {
  return {};
}

export const ActiveResponse = {
  encode(_: ActiveResponse, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): ActiveResponse {
    const reader = input instanceof _m0.Reader ? input : new _m0.Reader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseActiveResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },

  fromJSON(_: any): ActiveResponse {
    return {};
  },

  toJSON(_: ActiveResponse): unknown {
    const obj: any = {};
    return obj;
  },

  create(base?: DeepPartial<ActiveResponse>): ActiveResponse {
    return ActiveResponse.fromPartial(base ?? {});
  },

  fromPartial(_: DeepPartial<ActiveResponse>): ActiveResponse {
    const message = createBaseActiveResponse();
    return message;
  },
};

function createBaseInactiveRequest(): InactiveRequest {
  return { id: "" };
}

export const InactiveRequest = {
  encode(message: InactiveRequest, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.id !== "") {
      writer.uint32(10).string(message.id);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): InactiveRequest {
    const reader = input instanceof _m0.Reader ? input : new _m0.Reader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseInactiveRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.id = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },

  fromJSON(object: any): InactiveRequest {
    return { id: isSet(object.id) ? String(object.id) : "" };
  },

  toJSON(message: InactiveRequest): unknown {
    const obj: any = {};
    message.id !== undefined && (obj.id = message.id);
    return obj;
  },

  create(base?: DeepPartial<InactiveRequest>): InactiveRequest {
    return InactiveRequest.fromPartial(base ?? {});
  },

  fromPartial(object: DeepPartial<InactiveRequest>): InactiveRequest {
    const message = createBaseInactiveRequest();
    message.id = object.id ?? "";
    return message;
  },
};

function createBaseInactiveResponse(): InactiveResponse {
  return {};
}

export const InactiveResponse = {
  encode(_: InactiveResponse, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): InactiveResponse {
    const reader = input instanceof _m0.Reader ? input : new _m0.Reader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseInactiveResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },

  fromJSON(_: any): InactiveResponse {
    return {};
  },

  toJSON(_: InactiveResponse): unknown {
    const obj: any = {};
    return obj;
  },

  create(base?: DeepPartial<InactiveResponse>): InactiveResponse {
    return InactiveResponse.fromPartial(base ?? {});
  },

  fromPartial(_: DeepPartial<InactiveResponse>): InactiveResponse {
    const message = createBaseInactiveResponse();
    return message;
  },
};

function createBasePingRequest(): PingRequest {
  return {};
}

export const PingRequest = {
  encode(_: PingRequest, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): PingRequest {
    const reader = input instanceof _m0.Reader ? input : new _m0.Reader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBasePingRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },

  fromJSON(_: any): PingRequest {
    return {};
  },

  toJSON(_: PingRequest): unknown {
    const obj: any = {};
    return obj;
  },

  create(base?: DeepPartial<PingRequest>): PingRequest {
    return PingRequest.fromPartial(base ?? {});
  },

  fromPartial(_: DeepPartial<PingRequest>): PingRequest {
    const message = createBasePingRequest();
    return message;
  },
};

function createBasePingResponse(): PingResponse {
  return {};
}

export const PingResponse = {
  encode(_: PingResponse, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): PingResponse {
    const reader = input instanceof _m0.Reader ? input : new _m0.Reader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBasePingResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },

  fromJSON(_: any): PingResponse {
    return {};
  },

  toJSON(_: PingResponse): unknown {
    const obj: any = {};
    return obj;
  },

  create(base?: DeepPartial<PingResponse>): PingResponse {
    return PingResponse.fromPartial(base ?? {});
  },

  fromPartial(_: DeepPartial<PingResponse>): PingResponse {
    const message = createBasePingResponse();
    return message;
  },
};

function createBaseGetWorkspaceAuthInfoRequest(): GetWorkspaceAuthInfoRequest {
  return { workspaceId: "" };
}

export const GetWorkspaceAuthInfoRequest = {
  encode(message: GetWorkspaceAuthInfoRequest, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.workspaceId !== "") {
      writer.uint32(10).string(message.workspaceId);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): GetWorkspaceAuthInfoRequest {
    const reader = input instanceof _m0.Reader ? input : new _m0.Reader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseGetWorkspaceAuthInfoRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.workspaceId = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },

  fromJSON(object: any): GetWorkspaceAuthInfoRequest {
    return { workspaceId: isSet(object.workspaceId) ? String(object.workspaceId) : "" };
  },

  toJSON(message: GetWorkspaceAuthInfoRequest): unknown {
    const obj: any = {};
    message.workspaceId !== undefined && (obj.workspaceId = message.workspaceId);
    return obj;
  },

  create(base?: DeepPartial<GetWorkspaceAuthInfoRequest>): GetWorkspaceAuthInfoRequest {
    return GetWorkspaceAuthInfoRequest.fromPartial(base ?? {});
  },

  fromPartial(object: DeepPartial<GetWorkspaceAuthInfoRequest>): GetWorkspaceAuthInfoRequest {
    const message = createBaseGetWorkspaceAuthInfoRequest();
    message.workspaceId = object.workspaceId ?? "";
    return message;
  },
};

function createBaseGetWorkspaceAuthInfoResponse(): GetWorkspaceAuthInfoResponse {
  return { workspaceId: "", workspaceHost: "", ownerToken: "" };
}

export const GetWorkspaceAuthInfoResponse = {
  encode(message: GetWorkspaceAuthInfoResponse, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.workspaceId !== "") {
      writer.uint32(10).string(message.workspaceId);
    }
    if (message.workspaceHost !== "") {
      writer.uint32(18).string(message.workspaceHost);
    }
    if (message.ownerToken !== "") {
      writer.uint32(26).string(message.ownerToken);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): GetWorkspaceAuthInfoResponse {
    const reader = input instanceof _m0.Reader ? input : new _m0.Reader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseGetWorkspaceAuthInfoResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.workspaceId = reader.string();
          break;
        case 2:
          message.workspaceHost = reader.string();
          break;
        case 3:
          message.ownerToken = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },

  fromJSON(object: any): GetWorkspaceAuthInfoResponse {
    return {
      workspaceId: isSet(object.workspaceId) ? String(object.workspaceId) : "",
      workspaceHost: isSet(object.workspaceHost) ? String(object.workspaceHost) : "",
      ownerToken: isSet(object.ownerToken) ? String(object.ownerToken) : "",
    };
  },

  toJSON(message: GetWorkspaceAuthInfoResponse): unknown {
    const obj: any = {};
    message.workspaceId !== undefined && (obj.workspaceId = message.workspaceId);
    message.workspaceHost !== undefined && (obj.workspaceHost = message.workspaceHost);
    message.ownerToken !== undefined && (obj.ownerToken = message.ownerToken);
    return obj;
  },

  create(base?: DeepPartial<GetWorkspaceAuthInfoResponse>): GetWorkspaceAuthInfoResponse {
    return GetWorkspaceAuthInfoResponse.fromPartial(base ?? {});
  },

  fromPartial(object: DeepPartial<GetWorkspaceAuthInfoResponse>): GetWorkspaceAuthInfoResponse {
    const message = createBaseGetWorkspaceAuthInfoResponse();
    message.workspaceId = object.workspaceId ?? "";
    message.workspaceHost = object.workspaceHost ?? "";
    message.ownerToken = object.ownerToken ?? "";
    return message;
  },
};

export type LocalSSHServiceDefinition = typeof LocalSSHServiceDefinition;
export const LocalSSHServiceDefinition = {
  name: "LocalSSHService",
  fullName: "ipc.v1.LocalSSHService",
  methods: {
    /** Active is called when extension is activated */
    active: {
      name: "Active",
      requestType: ActiveRequest,
      requestStream: false,
      responseType: ActiveResponse,
      responseStream: false,
      options: {},
    },
    /** Inactive is called when extension is deactivated */
    inactive: {
      name: "Inactive",
      requestType: InactiveRequest,
      requestStream: false,
      responseType: InactiveResponse,
      responseStream: false,
      options: {},
    },
    ping: {
      name: "Ping",
      requestType: PingRequest,
      requestStream: false,
      responseType: PingResponse,
      responseStream: false,
      options: {},
    },
  },
} as const;

export interface LocalSSHServiceImplementation<CallContextExt = {}> {
  /** Active is called when extension is activated */
  active(request: ActiveRequest, context: CallContext & CallContextExt): Promise<DeepPartial<ActiveResponse>>;
  /** Inactive is called when extension is deactivated */
  inactive(request: InactiveRequest, context: CallContext & CallContextExt): Promise<DeepPartial<InactiveResponse>>;
  ping(request: PingRequest, context: CallContext & CallContextExt): Promise<DeepPartial<PingResponse>>;
}

export interface LocalSSHServiceClient<CallOptionsExt = {}> {
  /** Active is called when extension is activated */
  active(request: DeepPartial<ActiveRequest>, options?: CallOptions & CallOptionsExt): Promise<ActiveResponse>;
  /** Inactive is called when extension is deactivated */
  inactive(request: DeepPartial<InactiveRequest>, options?: CallOptions & CallOptionsExt): Promise<InactiveResponse>;
  ping(request: DeepPartial<PingRequest>, options?: CallOptions & CallOptionsExt): Promise<PingResponse>;
}

export type ExtensionServiceDefinition = typeof ExtensionServiceDefinition;
export const ExtensionServiceDefinition = {
  name: "ExtensionService",
  fullName: "ipc.v1.ExtensionService",
  methods: {
    ping: {
      name: "Ping",
      requestType: PingRequest,
      requestStream: false,
      responseType: PingResponse,
      responseStream: false,
      options: {},
    },
    getWorkspaceAuthInfo: {
      name: "GetWorkspaceAuthInfo",
      requestType: GetWorkspaceAuthInfoRequest,
      requestStream: false,
      responseType: GetWorkspaceAuthInfoResponse,
      responseStream: false,
      options: {},
    },
  },
} as const;

export interface ExtensionServiceImplementation<CallContextExt = {}> {
  ping(request: PingRequest, context: CallContext & CallContextExt): Promise<DeepPartial<PingResponse>>;
  getWorkspaceAuthInfo(
    request: GetWorkspaceAuthInfoRequest,
    context: CallContext & CallContextExt,
  ): Promise<DeepPartial<GetWorkspaceAuthInfoResponse>>;
}

export interface ExtensionServiceClient<CallOptionsExt = {}> {
  ping(request: DeepPartial<PingRequest>, options?: CallOptions & CallOptionsExt): Promise<PingResponse>;
  getWorkspaceAuthInfo(
    request: DeepPartial<GetWorkspaceAuthInfoRequest>,
    options?: CallOptions & CallOptionsExt,
  ): Promise<GetWorkspaceAuthInfoResponse>;
}

type Builtin = Date | Function | Uint8Array | string | number | boolean | undefined;

export type DeepPartial<T> = T extends Builtin ? T
  : T extends Array<infer U> ? Array<DeepPartial<U>> : T extends ReadonlyArray<infer U> ? ReadonlyArray<DeepPartial<U>>
  : T extends {} ? { [K in keyof T]?: DeepPartial<T[K]> }
  : Partial<T>;

function isSet(value: any): boolean {
  return value !== null && value !== undefined;
}
