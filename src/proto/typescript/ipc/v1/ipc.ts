/* eslint-disable */
import type { CallContext, CallOptions } from "nice-grpc-common";
import * as _m0 from "protobufjs/minimal";

export const protobufPackage = "ipc.v1";

export interface SendErrorReportRequest {
  workspaceId: string;
  instanceId: string;
  errorName: string;
  errorMessage: string;
  errorStack: string;
  daemonVersion: string;
  extensionVersion: string;
  gitpodHost: string;
  userId: string;
}

export interface SendErrorReportResponse {
}

export interface SendLocalSSHUserFlowStatusRequest {
  status: SendLocalSSHUserFlowStatusRequest_Status;
  workspaceId: string;
  instanceId: string;
  failureCode: SendLocalSSHUserFlowStatusRequest_Code;
  daemonVersion: string;
  connType: SendLocalSSHUserFlowStatusRequest_ConnType;
  gitpodHost: string;
  userId: string;
  flowStatus: string;
  flowFailureCode: string;
}

export enum SendLocalSSHUserFlowStatusRequest_ConnType {
  CONN_TYPE_UNSPECIFIED = 0,
  CONN_TYPE_SSH = 1,
  CONN_TYPE_TUNNEL = 2,
  UNRECOGNIZED = -1,
}

export function sendLocalSSHUserFlowStatusRequest_ConnTypeFromJSON(
  object: any,
): SendLocalSSHUserFlowStatusRequest_ConnType {
  switch (object) {
    case 0:
    case "CONN_TYPE_UNSPECIFIED":
      return SendLocalSSHUserFlowStatusRequest_ConnType.CONN_TYPE_UNSPECIFIED;
    case 1:
    case "CONN_TYPE_SSH":
      return SendLocalSSHUserFlowStatusRequest_ConnType.CONN_TYPE_SSH;
    case 2:
    case "CONN_TYPE_TUNNEL":
      return SendLocalSSHUserFlowStatusRequest_ConnType.CONN_TYPE_TUNNEL;
    case -1:
    case "UNRECOGNIZED":
    default:
      return SendLocalSSHUserFlowStatusRequest_ConnType.UNRECOGNIZED;
  }
}

export function sendLocalSSHUserFlowStatusRequest_ConnTypeToJSON(
  object: SendLocalSSHUserFlowStatusRequest_ConnType,
): string {
  switch (object) {
    case SendLocalSSHUserFlowStatusRequest_ConnType.CONN_TYPE_UNSPECIFIED:
      return "CONN_TYPE_UNSPECIFIED";
    case SendLocalSSHUserFlowStatusRequest_ConnType.CONN_TYPE_SSH:
      return "CONN_TYPE_SSH";
    case SendLocalSSHUserFlowStatusRequest_ConnType.CONN_TYPE_TUNNEL:
      return "CONN_TYPE_TUNNEL";
    case SendLocalSSHUserFlowStatusRequest_ConnType.UNRECOGNIZED:
    default:
      return "UNRECOGNIZED";
  }
}

export enum SendLocalSSHUserFlowStatusRequest_Status {
  STATUS_UNSPECIFIED = 0,
  STATUS_SUCCESS = 1,
  STATUS_FAILURE = 2,
  UNRECOGNIZED = -1,
}

export function sendLocalSSHUserFlowStatusRequest_StatusFromJSON(
  object: any,
): SendLocalSSHUserFlowStatusRequest_Status {
  switch (object) {
    case 0:
    case "STATUS_UNSPECIFIED":
      return SendLocalSSHUserFlowStatusRequest_Status.STATUS_UNSPECIFIED;
    case 1:
    case "STATUS_SUCCESS":
      return SendLocalSSHUserFlowStatusRequest_Status.STATUS_SUCCESS;
    case 2:
    case "STATUS_FAILURE":
      return SendLocalSSHUserFlowStatusRequest_Status.STATUS_FAILURE;
    case -1:
    case "UNRECOGNIZED":
    default:
      return SendLocalSSHUserFlowStatusRequest_Status.UNRECOGNIZED;
  }
}

export function sendLocalSSHUserFlowStatusRequest_StatusToJSON(
  object: SendLocalSSHUserFlowStatusRequest_Status,
): string {
  switch (object) {
    case SendLocalSSHUserFlowStatusRequest_Status.STATUS_UNSPECIFIED:
      return "STATUS_UNSPECIFIED";
    case SendLocalSSHUserFlowStatusRequest_Status.STATUS_SUCCESS:
      return "STATUS_SUCCESS";
    case SendLocalSSHUserFlowStatusRequest_Status.STATUS_FAILURE:
      return "STATUS_FAILURE";
    case SendLocalSSHUserFlowStatusRequest_Status.UNRECOGNIZED:
    default:
      return "UNRECOGNIZED";
  }
}

export enum SendLocalSSHUserFlowStatusRequest_Code {
  CODE_UNSPECIFIED = 0,
  /** CODE_NO_WORKSPACE_AUTO_INFO - CODE_NO_WORKSPACE_AUTO_INFO is used if failed to get workspace auto info */
  CODE_NO_WORKSPACE_AUTO_INFO = 1,
  /** CODE_TUNNEL_CANNOT_CREATE_WEBSOCKET - CODE_TUNNEL_CANNOT_CREATE_WEBSOCKET is used if failed to create websocket to supervisor */
  CODE_TUNNEL_CANNOT_CREATE_WEBSOCKET = 2,
  /** CODE_TUNNEL_FAILED_FORWARD_SSH_PORT - CODE_TUNNEL_FAILED_FORWARD_SSH_PORT is used if failed to forward ssh port in supervisor */
  CODE_TUNNEL_FAILED_FORWARD_SSH_PORT = 3,
  /** CODE_TUNNEL_NO_PRIVATEKEY - CODE_TUNNEL_NO_PRIVATEKEY when failed to create private key in supervisor */
  CODE_TUNNEL_NO_PRIVATEKEY = 4,
  /** CODE_TUNNEL_NO_ESTABLISHED_CONNECTION - CODE_TUNNEL_NO_ESTABLISHED_CONNECTION is used if the tunnel is not established */
  CODE_TUNNEL_NO_ESTABLISHED_CONNECTION = 5,
  /** CODE_SSH_CANNOT_CONNECT - CODE_SSH_CANNOT_CONNECT is used if failed to direct connect to ssh gateway */
  CODE_SSH_CANNOT_CONNECT = 6,
  UNRECOGNIZED = -1,
}

export function sendLocalSSHUserFlowStatusRequest_CodeFromJSON(object: any): SendLocalSSHUserFlowStatusRequest_Code {
  switch (object) {
    case 0:
    case "CODE_UNSPECIFIED":
      return SendLocalSSHUserFlowStatusRequest_Code.CODE_UNSPECIFIED;
    case 1:
    case "CODE_NO_WORKSPACE_AUTO_INFO":
      return SendLocalSSHUserFlowStatusRequest_Code.CODE_NO_WORKSPACE_AUTO_INFO;
    case 2:
    case "CODE_TUNNEL_CANNOT_CREATE_WEBSOCKET":
      return SendLocalSSHUserFlowStatusRequest_Code.CODE_TUNNEL_CANNOT_CREATE_WEBSOCKET;
    case 3:
    case "CODE_TUNNEL_FAILED_FORWARD_SSH_PORT":
      return SendLocalSSHUserFlowStatusRequest_Code.CODE_TUNNEL_FAILED_FORWARD_SSH_PORT;
    case 4:
    case "CODE_TUNNEL_NO_PRIVATEKEY":
      return SendLocalSSHUserFlowStatusRequest_Code.CODE_TUNNEL_NO_PRIVATEKEY;
    case 5:
    case "CODE_TUNNEL_NO_ESTABLISHED_CONNECTION":
      return SendLocalSSHUserFlowStatusRequest_Code.CODE_TUNNEL_NO_ESTABLISHED_CONNECTION;
    case 6:
    case "CODE_SSH_CANNOT_CONNECT":
      return SendLocalSSHUserFlowStatusRequest_Code.CODE_SSH_CANNOT_CONNECT;
    case -1:
    case "UNRECOGNIZED":
    default:
      return SendLocalSSHUserFlowStatusRequest_Code.UNRECOGNIZED;
  }
}

export function sendLocalSSHUserFlowStatusRequest_CodeToJSON(object: SendLocalSSHUserFlowStatusRequest_Code): string {
  switch (object) {
    case SendLocalSSHUserFlowStatusRequest_Code.CODE_UNSPECIFIED:
      return "CODE_UNSPECIFIED";
    case SendLocalSSHUserFlowStatusRequest_Code.CODE_NO_WORKSPACE_AUTO_INFO:
      return "CODE_NO_WORKSPACE_AUTO_INFO";
    case SendLocalSSHUserFlowStatusRequest_Code.CODE_TUNNEL_CANNOT_CREATE_WEBSOCKET:
      return "CODE_TUNNEL_CANNOT_CREATE_WEBSOCKET";
    case SendLocalSSHUserFlowStatusRequest_Code.CODE_TUNNEL_FAILED_FORWARD_SSH_PORT:
      return "CODE_TUNNEL_FAILED_FORWARD_SSH_PORT";
    case SendLocalSSHUserFlowStatusRequest_Code.CODE_TUNNEL_NO_PRIVATEKEY:
      return "CODE_TUNNEL_NO_PRIVATEKEY";
    case SendLocalSSHUserFlowStatusRequest_Code.CODE_TUNNEL_NO_ESTABLISHED_CONNECTION:
      return "CODE_TUNNEL_NO_ESTABLISHED_CONNECTION";
    case SendLocalSSHUserFlowStatusRequest_Code.CODE_SSH_CANNOT_CONNECT:
      return "CODE_SSH_CANNOT_CONNECT";
    case SendLocalSSHUserFlowStatusRequest_Code.UNRECOGNIZED:
    default:
      return "UNRECOGNIZED";
  }
}

export interface SendLocalSSHUserFlowStatusResponse {
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
}

function createBaseSendErrorReportRequest(): SendErrorReportRequest {
  return {
    workspaceId: "",
    instanceId: "",
    errorName: "",
    errorMessage: "",
    errorStack: "",
    daemonVersion: "",
    extensionVersion: "",
    gitpodHost: "",
    userId: "",
  };
}

export const SendErrorReportRequest = {
  encode(message: SendErrorReportRequest, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.workspaceId !== "") {
      writer.uint32(10).string(message.workspaceId);
    }
    if (message.instanceId !== "") {
      writer.uint32(18).string(message.instanceId);
    }
    if (message.errorName !== "") {
      writer.uint32(26).string(message.errorName);
    }
    if (message.errorMessage !== "") {
      writer.uint32(34).string(message.errorMessage);
    }
    if (message.errorStack !== "") {
      writer.uint32(42).string(message.errorStack);
    }
    if (message.daemonVersion !== "") {
      writer.uint32(50).string(message.daemonVersion);
    }
    if (message.extensionVersion !== "") {
      writer.uint32(58).string(message.extensionVersion);
    }
    if (message.gitpodHost !== "") {
      writer.uint32(66).string(message.gitpodHost);
    }
    if (message.userId !== "") {
      writer.uint32(74).string(message.userId);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SendErrorReportRequest {
    const reader = input instanceof _m0.Reader ? input : new _m0.Reader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSendErrorReportRequest();
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
          message.errorName = reader.string();
          break;
        case 4:
          message.errorMessage = reader.string();
          break;
        case 5:
          message.errorStack = reader.string();
          break;
        case 6:
          message.daemonVersion = reader.string();
          break;
        case 7:
          message.extensionVersion = reader.string();
          break;
        case 8:
          message.gitpodHost = reader.string();
          break;
        case 9:
          message.userId = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },

  fromJSON(object: any): SendErrorReportRequest {
    return {
      workspaceId: isSet(object.workspaceId) ? String(object.workspaceId) : "",
      instanceId: isSet(object.instanceId) ? String(object.instanceId) : "",
      errorName: isSet(object.errorName) ? String(object.errorName) : "",
      errorMessage: isSet(object.errorMessage) ? String(object.errorMessage) : "",
      errorStack: isSet(object.errorStack) ? String(object.errorStack) : "",
      daemonVersion: isSet(object.daemonVersion) ? String(object.daemonVersion) : "",
      extensionVersion: isSet(object.extensionVersion) ? String(object.extensionVersion) : "",
      gitpodHost: isSet(object.gitpodHost) ? String(object.gitpodHost) : "",
      userId: isSet(object.userId) ? String(object.userId) : "",
    };
  },

  toJSON(message: SendErrorReportRequest): unknown {
    const obj: any = {};
    message.workspaceId !== undefined && (obj.workspaceId = message.workspaceId);
    message.instanceId !== undefined && (obj.instanceId = message.instanceId);
    message.errorName !== undefined && (obj.errorName = message.errorName);
    message.errorMessage !== undefined && (obj.errorMessage = message.errorMessage);
    message.errorStack !== undefined && (obj.errorStack = message.errorStack);
    message.daemonVersion !== undefined && (obj.daemonVersion = message.daemonVersion);
    message.extensionVersion !== undefined && (obj.extensionVersion = message.extensionVersion);
    message.gitpodHost !== undefined && (obj.gitpodHost = message.gitpodHost);
    message.userId !== undefined && (obj.userId = message.userId);
    return obj;
  },

  create(base?: DeepPartial<SendErrorReportRequest>): SendErrorReportRequest {
    return SendErrorReportRequest.fromPartial(base ?? {});
  },

  fromPartial(object: DeepPartial<SendErrorReportRequest>): SendErrorReportRequest {
    const message = createBaseSendErrorReportRequest();
    message.workspaceId = object.workspaceId ?? "";
    message.instanceId = object.instanceId ?? "";
    message.errorName = object.errorName ?? "";
    message.errorMessage = object.errorMessage ?? "";
    message.errorStack = object.errorStack ?? "";
    message.daemonVersion = object.daemonVersion ?? "";
    message.extensionVersion = object.extensionVersion ?? "";
    message.gitpodHost = object.gitpodHost ?? "";
    message.userId = object.userId ?? "";
    return message;
  },
};

function createBaseSendErrorReportResponse(): SendErrorReportResponse {
  return {};
}

export const SendErrorReportResponse = {
  encode(_: SendErrorReportResponse, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SendErrorReportResponse {
    const reader = input instanceof _m0.Reader ? input : new _m0.Reader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSendErrorReportResponse();
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

  fromJSON(_: any): SendErrorReportResponse {
    return {};
  },

  toJSON(_: SendErrorReportResponse): unknown {
    const obj: any = {};
    return obj;
  },

  create(base?: DeepPartial<SendErrorReportResponse>): SendErrorReportResponse {
    return SendErrorReportResponse.fromPartial(base ?? {});
  },

  fromPartial(_: DeepPartial<SendErrorReportResponse>): SendErrorReportResponse {
    const message = createBaseSendErrorReportResponse();
    return message;
  },
};

function createBaseSendLocalSSHUserFlowStatusRequest(): SendLocalSSHUserFlowStatusRequest {
  return {
    status: 0,
    workspaceId: "",
    instanceId: "",
    failureCode: 0,
    daemonVersion: "",
    connType: 0,
    gitpodHost: "",
    userId: "",
    flowStatus: "",
    flowFailureCode: "",
  };
}

export const SendLocalSSHUserFlowStatusRequest = {
  encode(message: SendLocalSSHUserFlowStatusRequest, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.status !== 0) {
      writer.uint32(8).int32(message.status);
    }
    if (message.workspaceId !== "") {
      writer.uint32(18).string(message.workspaceId);
    }
    if (message.instanceId !== "") {
      writer.uint32(26).string(message.instanceId);
    }
    if (message.failureCode !== 0) {
      writer.uint32(40).int32(message.failureCode);
    }
    if (message.daemonVersion !== "") {
      writer.uint32(58).string(message.daemonVersion);
    }
    if (message.connType !== 0) {
      writer.uint32(72).int32(message.connType);
    }
    if (message.gitpodHost !== "") {
      writer.uint32(82).string(message.gitpodHost);
    }
    if (message.userId !== "") {
      writer.uint32(90).string(message.userId);
    }
    if (message.flowStatus !== "") {
      writer.uint32(98).string(message.flowStatus);
    }
    if (message.flowFailureCode !== "") {
      writer.uint32(106).string(message.flowFailureCode);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SendLocalSSHUserFlowStatusRequest {
    const reader = input instanceof _m0.Reader ? input : new _m0.Reader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSendLocalSSHUserFlowStatusRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.status = reader.int32() as any;
          break;
        case 2:
          message.workspaceId = reader.string();
          break;
        case 3:
          message.instanceId = reader.string();
          break;
        case 5:
          message.failureCode = reader.int32() as any;
          break;
        case 7:
          message.daemonVersion = reader.string();
          break;
        case 9:
          message.connType = reader.int32() as any;
          break;
        case 10:
          message.gitpodHost = reader.string();
          break;
        case 11:
          message.userId = reader.string();
          break;
        case 12:
          message.flowStatus = reader.string();
          break;
        case 13:
          message.flowFailureCode = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },

  fromJSON(object: any): SendLocalSSHUserFlowStatusRequest {
    return {
      status: isSet(object.status) ? sendLocalSSHUserFlowStatusRequest_StatusFromJSON(object.status) : 0,
      workspaceId: isSet(object.workspaceId) ? String(object.workspaceId) : "",
      instanceId: isSet(object.instanceId) ? String(object.instanceId) : "",
      failureCode: isSet(object.failureCode) ? sendLocalSSHUserFlowStatusRequest_CodeFromJSON(object.failureCode) : 0,
      daemonVersion: isSet(object.daemonVersion) ? String(object.daemonVersion) : "",
      connType: isSet(object.connType) ? sendLocalSSHUserFlowStatusRequest_ConnTypeFromJSON(object.connType) : 0,
      gitpodHost: isSet(object.gitpodHost) ? String(object.gitpodHost) : "",
      userId: isSet(object.userId) ? String(object.userId) : "",
      flowStatus: isSet(object.flowStatus) ? String(object.flowStatus) : "",
      flowFailureCode: isSet(object.flowFailureCode) ? String(object.flowFailureCode) : "",
    };
  },

  toJSON(message: SendLocalSSHUserFlowStatusRequest): unknown {
    const obj: any = {};
    message.status !== undefined && (obj.status = sendLocalSSHUserFlowStatusRequest_StatusToJSON(message.status));
    message.workspaceId !== undefined && (obj.workspaceId = message.workspaceId);
    message.instanceId !== undefined && (obj.instanceId = message.instanceId);
    message.failureCode !== undefined &&
      (obj.failureCode = sendLocalSSHUserFlowStatusRequest_CodeToJSON(message.failureCode));
    message.daemonVersion !== undefined && (obj.daemonVersion = message.daemonVersion);
    message.connType !== undefined &&
      (obj.connType = sendLocalSSHUserFlowStatusRequest_ConnTypeToJSON(message.connType));
    message.gitpodHost !== undefined && (obj.gitpodHost = message.gitpodHost);
    message.userId !== undefined && (obj.userId = message.userId);
    message.flowStatus !== undefined && (obj.flowStatus = message.flowStatus);
    message.flowFailureCode !== undefined && (obj.flowFailureCode = message.flowFailureCode);
    return obj;
  },

  create(base?: DeepPartial<SendLocalSSHUserFlowStatusRequest>): SendLocalSSHUserFlowStatusRequest {
    return SendLocalSSHUserFlowStatusRequest.fromPartial(base ?? {});
  },

  fromPartial(object: DeepPartial<SendLocalSSHUserFlowStatusRequest>): SendLocalSSHUserFlowStatusRequest {
    const message = createBaseSendLocalSSHUserFlowStatusRequest();
    message.status = object.status ?? 0;
    message.workspaceId = object.workspaceId ?? "";
    message.instanceId = object.instanceId ?? "";
    message.failureCode = object.failureCode ?? 0;
    message.daemonVersion = object.daemonVersion ?? "";
    message.connType = object.connType ?? 0;
    message.gitpodHost = object.gitpodHost ?? "";
    message.userId = object.userId ?? "";
    message.flowStatus = object.flowStatus ?? "";
    message.flowFailureCode = object.flowFailureCode ?? "";
    return message;
  },
};

function createBaseSendLocalSSHUserFlowStatusResponse(): SendLocalSSHUserFlowStatusResponse {
  return {};
}

export const SendLocalSSHUserFlowStatusResponse = {
  encode(_: SendLocalSSHUserFlowStatusResponse, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SendLocalSSHUserFlowStatusResponse {
    const reader = input instanceof _m0.Reader ? input : new _m0.Reader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseSendLocalSSHUserFlowStatusResponse();
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

  fromJSON(_: any): SendLocalSSHUserFlowStatusResponse {
    return {};
  },

  toJSON(_: SendLocalSSHUserFlowStatusResponse): unknown {
    const obj: any = {};
    return obj;
  },

  create(base?: DeepPartial<SendLocalSSHUserFlowStatusResponse>): SendLocalSSHUserFlowStatusResponse {
    return SendLocalSSHUserFlowStatusResponse.fromPartial(base ?? {});
  },

  fromPartial(_: DeepPartial<SendLocalSSHUserFlowStatusResponse>): SendLocalSSHUserFlowStatusResponse {
    const message = createBaseSendLocalSSHUserFlowStatusResponse();
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
  return { workspaceId: "", instanceId: "", workspaceHost: "", ownerToken: "", gitpodHost: "", userId: "", sshkey: "" };
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
    sendLocalSSHUserFlowStatus: {
      name: "SendLocalSSHUserFlowStatus",
      requestType: SendLocalSSHUserFlowStatusRequest,
      requestStream: false,
      responseType: SendLocalSSHUserFlowStatusResponse,
      responseStream: false,
      options: {},
    },
    sendErrorReport: {
      name: "SendErrorReport",
      requestType: SendErrorReportRequest,
      requestStream: false,
      responseType: SendErrorReportResponse,
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
  sendLocalSSHUserFlowStatus(
    request: SendLocalSSHUserFlowStatusRequest,
    context: CallContext & CallContextExt,
  ): Promise<DeepPartial<SendLocalSSHUserFlowStatusResponse>>;
  sendErrorReport(
    request: SendErrorReportRequest,
    context: CallContext & CallContextExt,
  ): Promise<DeepPartial<SendErrorReportResponse>>;
}

export interface ExtensionServiceClient<CallOptionsExt = {}> {
  getWorkspaceAuthInfo(
    request: DeepPartial<GetWorkspaceAuthInfoRequest>,
    options?: CallOptions & CallOptionsExt,
  ): Promise<GetWorkspaceAuthInfoResponse>;
  sendLocalSSHUserFlowStatus(
    request: DeepPartial<SendLocalSSHUserFlowStatusRequest>,
    options?: CallOptions & CallOptionsExt,
  ): Promise<SendLocalSSHUserFlowStatusResponse>;
  sendErrorReport(
    request: DeepPartial<SendErrorReportRequest>,
    options?: CallOptions & CallOptionsExt,
  ): Promise<SendErrorReportResponse>;
}

type Builtin = Date | Function | Uint8Array | string | number | boolean | undefined;

export type DeepPartial<T> = T extends Builtin ? T
  : T extends Array<infer U> ? Array<DeepPartial<U>> : T extends ReadonlyArray<infer U> ? ReadonlyArray<DeepPartial<U>>
  : T extends {} ? { [K in keyof T]?: DeepPartial<T[K]> }
  : Partial<T>;

function isSet(value: any): boolean {
  return value !== null && value !== undefined;
}
