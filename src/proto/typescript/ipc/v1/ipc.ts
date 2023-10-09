/* eslint-disable */
import type { CallContext, CallOptions } from "nice-grpc-common";
import * as _m0 from "protobufjs/minimal";

export const protobufPackage = "ipc.v1";

export interface PingRequest {
}

export interface PingResponse {
}

export interface GetWorkspaceAuthInfoRequest {
  workspaceId: string;
  gitpodHost: string;
}

export interface GetWorkspaceAuthInfoResponse {
  workspaceId: string;
  instanceId: string;
  workspaceHost: string;
  ownerToken: string;
  gitpodHost: string;
  userId: string;
  sshkey: string;
  phase: string;
  username: string;
}

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
  return { workspaceId: "", gitpodHost: "" };
}

export const GetWorkspaceAuthInfoRequest = {
  encode(message: GetWorkspaceAuthInfoRequest, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.workspaceId !== "") {
      writer.uint32(10).string(message.workspaceId);
    }
    if (message.gitpodHost !== "") {
      writer.uint32(18).string(message.gitpodHost);
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
        case 2:
          message.gitpodHost = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },

  fromJSON(object: any): GetWorkspaceAuthInfoRequest {
    return {
      workspaceId: isSet(object.workspaceId) ? String(object.workspaceId) : "",
      gitpodHost: isSet(object.gitpodHost) ? String(object.gitpodHost) : "",
    };
  },

  toJSON(message: GetWorkspaceAuthInfoRequest): unknown {
    const obj: any = {};
    message.workspaceId !== undefined && (obj.workspaceId = message.workspaceId);
    message.gitpodHost !== undefined && (obj.gitpodHost = message.gitpodHost);
    return obj;
  },

  create(base?: DeepPartial<GetWorkspaceAuthInfoRequest>): GetWorkspaceAuthInfoRequest {
    return GetWorkspaceAuthInfoRequest.fromPartial(base ?? {});
  },

  fromPartial(object: DeepPartial<GetWorkspaceAuthInfoRequest>): GetWorkspaceAuthInfoRequest {
    const message = createBaseGetWorkspaceAuthInfoRequest();
    message.workspaceId = object.workspaceId ?? "";
    message.gitpodHost = object.gitpodHost ?? "";
    return message;
  },
};

function createBaseGetWorkspaceAuthInfoResponse(): GetWorkspaceAuthInfoResponse {
  return {
    workspaceId: "",
    instanceId: "",
    workspaceHost: "",
    ownerToken: "",
    gitpodHost: "",
    userId: "",
    sshkey: "",
    phase: "",
    username: "",
  };
}

export const GetWorkspaceAuthInfoResponse = {
  encode(message: GetWorkspaceAuthInfoResponse, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.workspaceId !== "") {
      writer.uint32(10).string(message.workspaceId);
    }
    if (message.instanceId !== "") {
      writer.uint32(18).string(message.instanceId);
    }
    if (message.workspaceHost !== "") {
      writer.uint32(26).string(message.workspaceHost);
    }
    if (message.ownerToken !== "") {
      writer.uint32(34).string(message.ownerToken);
    }
    if (message.gitpodHost !== "") {
      writer.uint32(42).string(message.gitpodHost);
    }
    if (message.userId !== "") {
      writer.uint32(50).string(message.userId);
    }
    if (message.sshkey !== "") {
      writer.uint32(58).string(message.sshkey);
    }
    if (message.phase !== "") {
      writer.uint32(66).string(message.phase);
    }
    if (message.username !== "") {
      writer.uint32(74).string(message.username);
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
          message.instanceId = reader.string();
          break;
        case 3:
          message.workspaceHost = reader.string();
          break;
        case 4:
          message.ownerToken = reader.string();
          break;
        case 5:
          message.gitpodHost = reader.string();
          break;
        case 6:
          message.userId = reader.string();
          break;
        case 7:
          message.sshkey = reader.string();
          break;
        case 8:
          message.phase = reader.string();
          break;
        case 9:
          message.username = reader.string();
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
      instanceId: isSet(object.instanceId) ? String(object.instanceId) : "",
      workspaceHost: isSet(object.workspaceHost) ? String(object.workspaceHost) : "",
      ownerToken: isSet(object.ownerToken) ? String(object.ownerToken) : "",
      gitpodHost: isSet(object.gitpodHost) ? String(object.gitpodHost) : "",
      userId: isSet(object.userId) ? String(object.userId) : "",
      sshkey: isSet(object.sshkey) ? String(object.sshkey) : "",
      phase: isSet(object.phase) ? String(object.phase) : "",
      username: isSet(object.username) ? String(object.username) : "",
    };
  },

  toJSON(message: GetWorkspaceAuthInfoResponse): unknown {
    const obj: any = {};
    message.workspaceId !== undefined && (obj.workspaceId = message.workspaceId);
    message.instanceId !== undefined && (obj.instanceId = message.instanceId);
    message.workspaceHost !== undefined && (obj.workspaceHost = message.workspaceHost);
    message.ownerToken !== undefined && (obj.ownerToken = message.ownerToken);
    message.gitpodHost !== undefined && (obj.gitpodHost = message.gitpodHost);
    message.userId !== undefined && (obj.userId = message.userId);
    message.sshkey !== undefined && (obj.sshkey = message.sshkey);
    message.phase !== undefined && (obj.phase = message.phase);
    message.username !== undefined && (obj.username = message.username);
    return obj;
  },

  create(base?: DeepPartial<GetWorkspaceAuthInfoResponse>): GetWorkspaceAuthInfoResponse {
    return GetWorkspaceAuthInfoResponse.fromPartial(base ?? {});
  },

  fromPartial(object: DeepPartial<GetWorkspaceAuthInfoResponse>): GetWorkspaceAuthInfoResponse {
    const message = createBaseGetWorkspaceAuthInfoResponse();
    message.workspaceId = object.workspaceId ?? "";
    message.instanceId = object.instanceId ?? "";
    message.workspaceHost = object.workspaceHost ?? "";
    message.ownerToken = object.ownerToken ?? "";
    message.gitpodHost = object.gitpodHost ?? "";
    message.userId = object.userId ?? "";
    message.sshkey = object.sshkey ?? "";
    message.phase = object.phase ?? "";
    message.username = object.username ?? "";
    return message;
  },
};

export type ExtensionServiceDefinition = typeof ExtensionServiceDefinition;
export const ExtensionServiceDefinition = {
  name: "ExtensionService",
  fullName: "ipc.v1.ExtensionService",
  methods: {
    getWorkspaceAuthInfo: {
      name: "GetWorkspaceAuthInfo",
      requestType: GetWorkspaceAuthInfoRequest,
      requestStream: false,
      responseType: GetWorkspaceAuthInfoResponse,
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

export interface ExtensionServiceImplementation<CallContextExt = {}> {
  getWorkspaceAuthInfo(
    request: GetWorkspaceAuthInfoRequest,
    context: CallContext & CallContextExt,
  ): Promise<DeepPartial<GetWorkspaceAuthInfoResponse>>;
  ping(request: PingRequest, context: CallContext & CallContextExt): Promise<DeepPartial<PingResponse>>;
}

export interface ExtensionServiceClient<CallOptionsExt = {}> {
  getWorkspaceAuthInfo(
    request: DeepPartial<GetWorkspaceAuthInfoRequest>,
    options?: CallOptions & CallOptionsExt,
  ): Promise<GetWorkspaceAuthInfoResponse>;
  ping(request: DeepPartial<PingRequest>, options?: CallOptions & CallOptionsExt): Promise<PingResponse>;
}

type Builtin = Date | Function | Uint8Array | string | number | boolean | undefined;

export type DeepPartial<T> = T extends Builtin ? T
  : T extends Array<infer U> ? Array<DeepPartial<U>> : T extends ReadonlyArray<infer U> ? ReadonlyArray<DeepPartial<U>>
  : T extends {} ? { [K in keyof T]?: DeepPartial<T[K]> }
  : Partial<T>;

function isSet(value: any): boolean {
  return value !== null && value !== undefined;
}
