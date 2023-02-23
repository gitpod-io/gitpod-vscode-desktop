/**
 * Copyright (c) 2023 Gitpod GmbH. All rights reserved.
 * Licensed under the GNU Affero General Public License (AGPL).
 * See License.AGPL.txt in the project root for license information.
 */

/* eslint-disable */
import {
  CallOptions,
  ChannelCredentials,
  ChannelOptions,
  Client,
  ClientReadableStream,
  ClientUnaryCall,
  handleServerStreamingCall,
  handleUnaryCall,
  makeGenericClientConstructor,
  Metadata,
  ServiceError,
  UntypedServiceImplementation,
} from "@grpc/grpc-js";
import Long from "long";
import _m0 from "protobufjs/minimal.js";
import { FieldMask } from "../../../google/protobuf/field_mask.pb";
import { Timestamp } from "../../../google/protobuf/timestamp.pb";
import { Pagination } from "./pagination.pb";

export const protobufPackage = "gitpod.experimental.v1";

/** PortPolicy defines the accssbility policy of a workspace port is guarded by an authentication in the proxy */
export enum PortPolicy {
  PORT_POLICY_UNSPECIFIED = "PORT_POLICY_UNSPECIFIED",
  /** PORT_POLICY_PRIVATE - Private means the port is accessible by the workspace owner only using the workspace port URL */
  PORT_POLICY_PRIVATE = "PORT_POLICY_PRIVATE",
  /** PORT_POLICY_PUBLIC - Public means the port is accessible by everybody using the workspace port URL */
  PORT_POLICY_PUBLIC = "PORT_POLICY_PUBLIC",
  UNRECOGNIZED = "UNRECOGNIZED",
}

export function portPolicyFromJSON(object: any): PortPolicy {
  switch (object) {
    case 0:
    case "PORT_POLICY_UNSPECIFIED":
      return PortPolicy.PORT_POLICY_UNSPECIFIED;
    case 1:
    case "PORT_POLICY_PRIVATE":
      return PortPolicy.PORT_POLICY_PRIVATE;
    case 2:
    case "PORT_POLICY_PUBLIC":
      return PortPolicy.PORT_POLICY_PUBLIC;
    case -1:
    case "UNRECOGNIZED":
    default:
      return PortPolicy.UNRECOGNIZED;
  }
}

export function portPolicyToJSON(object: PortPolicy): string {
  switch (object) {
    case PortPolicy.PORT_POLICY_UNSPECIFIED:
      return "PORT_POLICY_UNSPECIFIED";
    case PortPolicy.PORT_POLICY_PRIVATE:
      return "PORT_POLICY_PRIVATE";
    case PortPolicy.PORT_POLICY_PUBLIC:
      return "PORT_POLICY_PUBLIC";
    case PortPolicy.UNRECOGNIZED:
    default:
      return "UNRECOGNIZED";
  }
}

export function portPolicyToNumber(object: PortPolicy): number {
  switch (object) {
    case PortPolicy.PORT_POLICY_UNSPECIFIED:
      return 0;
    case PortPolicy.PORT_POLICY_PRIVATE:
      return 1;
    case PortPolicy.PORT_POLICY_PUBLIC:
      return 2;
    case PortPolicy.UNRECOGNIZED:
    default:
      return -1;
  }
}

/** Admission level describes who can access a workspace instance and its ports. */
export enum AdmissionLevel {
  ADMISSION_LEVEL_UNSPECIFIED = "ADMISSION_LEVEL_UNSPECIFIED",
  /** ADMISSION_LEVEL_OWNER_ONLY - ADMISSION_LEVEL_OWNER_ONLY means the workspace can only be accessed using the owner token */
  ADMISSION_LEVEL_OWNER_ONLY = "ADMISSION_LEVEL_OWNER_ONLY",
  /** ADMISSION_LEVEL_EVERYONE - ADMISSION_LEVEL_EVERYONE means the workspace (including ports) can be accessed by everyone. */
  ADMISSION_LEVEL_EVERYONE = "ADMISSION_LEVEL_EVERYONE",
  UNRECOGNIZED = "UNRECOGNIZED",
}

export function admissionLevelFromJSON(object: any): AdmissionLevel {
  switch (object) {
    case 0:
    case "ADMISSION_LEVEL_UNSPECIFIED":
      return AdmissionLevel.ADMISSION_LEVEL_UNSPECIFIED;
    case 1:
    case "ADMISSION_LEVEL_OWNER_ONLY":
      return AdmissionLevel.ADMISSION_LEVEL_OWNER_ONLY;
    case 2:
    case "ADMISSION_LEVEL_EVERYONE":
      return AdmissionLevel.ADMISSION_LEVEL_EVERYONE;
    case -1:
    case "UNRECOGNIZED":
    default:
      return AdmissionLevel.UNRECOGNIZED;
  }
}

export function admissionLevelToJSON(object: AdmissionLevel): string {
  switch (object) {
    case AdmissionLevel.ADMISSION_LEVEL_UNSPECIFIED:
      return "ADMISSION_LEVEL_UNSPECIFIED";
    case AdmissionLevel.ADMISSION_LEVEL_OWNER_ONLY:
      return "ADMISSION_LEVEL_OWNER_ONLY";
    case AdmissionLevel.ADMISSION_LEVEL_EVERYONE:
      return "ADMISSION_LEVEL_EVERYONE";
    case AdmissionLevel.UNRECOGNIZED:
    default:
      return "UNRECOGNIZED";
  }
}

export function admissionLevelToNumber(object: AdmissionLevel): number {
  switch (object) {
    case AdmissionLevel.ADMISSION_LEVEL_UNSPECIFIED:
      return 0;
    case AdmissionLevel.ADMISSION_LEVEL_OWNER_ONLY:
      return 1;
    case AdmissionLevel.ADMISSION_LEVEL_EVERYONE:
      return 2;
    case AdmissionLevel.UNRECOGNIZED:
    default:
      return -1;
  }
}

export interface ListWorkspacesRequest {
  pagination: Pagination | undefined;
  fieldMask: string[] | undefined;
}

export interface ListWorkspacesResponse {
  nextPageToken: string;
  result: Workspace[];
}

export interface GetWorkspaceRequest {
  workspaceId: string;
}

export interface GetWorkspaceResponse {
  result: Workspace | undefined;
}

export interface StreamWorkspaceStatusRequest {
  workspaceId: string;
}

export interface StreamWorkspaceStatusResponse {
  result: WorkspaceStatus | undefined;
}

export interface GetOwnerTokenRequest {
  workspaceId: string;
}

export interface GetOwnerTokenResponse {
  token: string;
}

export interface CreateAndStartWorkspaceRequest {
  idempotencyToken: string;
  contextUrl: string | undefined;
  prebuildId: string | undefined;
  startSpec: StartWorkspaceSpec | undefined;
}

export interface CreateAndStartWorkspaceResponse {
  workspaceId: string;
}

export interface StartWorkspaceRequest {
  idempotencyToken: string;
  workspaceId: string;
  spec: StartWorkspaceSpec | undefined;
}

export interface StartWorkspaceResponse {
  instanceId: string;
  workspaceUrl: string;
}

export interface StopWorkspaceRequest {
  workspaceId: string;
}

export interface StopWorkspaceResponse {
}

export interface DeleteWorkspaceRequest {
  workspaceId: string;
}

export interface DeleteWorkspaceResponse {
}

/** Workspace describes a single workspace */
export interface Workspace {
  /** workspace_id is the ID of the workspace */
  workspaceId: string;
  /** owner_id is the ID of the user who created this workspace */
  ownerId: string;
  /** project_id is the ID of the project which this workspace belongs to */
  projectId: string;
  /** context reports the original context the workspace was created from */
  context:
    | WorkspaceContext
    | undefined;
  /** description is a human readable description of the workspace */
  description: string;
  /** status is the current status of this Workspace. */
  status: WorkspaceStatus | undefined;
}

/** WorkspaceStatus represents the currently observed status of a Workspace, including data about child resources that belong to this Workspace. */
export interface WorkspaceStatus {
  /** instance is the currently assigned WorkspaceInstance to this workspace. Empty when there is no WorkspaceInstance assigned. */
  instance: WorkspaceInstance | undefined;
}

/** WorkspaceContext describes the context a workspace was created from */
export interface WorkspaceContext {
  /**
   * All workspace context originates from a URL - this is the context URL
   * which led to the creation of a workspace.
   */
  contextUrl: string;
  git: WorkspaceContext_Git | undefined;
  prebuild: WorkspaceContext_Prebuild | undefined;
  snapshot: WorkspaceContext_Snapshot | undefined;
}

/** Explicit Git context */
export interface WorkspaceContext_Git {
  normalizedContextUrl: string;
  commit: string;
}

/** Workspace was created from a prebuild */
export interface WorkspaceContext_Prebuild {
  /**
   * original_context is the Git context which lead to the selection
   * of a prebuild.
   */
  originalContext:
    | WorkspaceContext_Git
    | undefined;
  /** prebuild_id is the ID of the prebuild which was used to create this workspace */
  prebuildId: string;
}

/** Snapshot context points to the snapshot which the workspace was created from */
export interface WorkspaceContext_Snapshot {
  snapshotId: string;
}

/** WorkspaceInstance describes a single workspace instance */
export interface WorkspaceInstance {
  /** Instance ID is the unique identifier of the workspace instance */
  instanceId: string;
  /** Worksapce ID is the unique identifier of the workspace this instance belongs to */
  workspaceId: string;
  createdAt: Date | undefined;
  status: WorkspaceInstanceStatus | undefined;
}

/** WorkspaceStatus describes a workspace status */
export interface WorkspaceInstanceStatus {
  /**
   * version of the status update. Workspace instances themselves are unversioned,
   * but their statuus has different versions.
   * The value of this field has no semantic meaning (e.g. don't interpret it as
   * as a timestemp), but it can be used to impose a partial order.
   * If a.status_version < b.status_version then a was the status before b.
   */
  statusVersion: number;
  /** the phase of a workspace is a simple, high-level summary of where the workspace instance is in its lifecycle */
  phase: WorkspaceInstanceStatus_Phase;
  /** conditions detail the current state of the workspace instance */
  conditions:
    | WorkspaceInstanceStatus_Conditions
    | undefined;
  /** message is an optional human-readable message detailing the current phase */
  message: string;
  /** URL contains the endpoint at which the workspace instance is available */
  url: string;
  /** Admission describes who can access a workspace instance and its ports. */
  admission: AdmissionLevel;
  /** ports is the list of exposed ports in the workspace. */
  ports: Port[];
}

/**
 * Phase is a simple, high-level summary of where the workspace instance is in its lifecycle.
 * The phase is not intended to be a comprehensive rollup of observations of the workspace state,
 * nor is it intended to be a comprehensive state machine.
 * (based on  https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-phase)
 */
export enum WorkspaceInstanceStatus_Phase {
  /**
   * PHASE_UNSPECIFIED - Unknown indicates an issue within the workspace manager in that it cannot determine the actual phase of
   * a workspace. This phase is usually accompanied by an error.
   */
  PHASE_UNSPECIFIED = "PHASE_UNSPECIFIED",
  /**
   * PHASE_PREPARING - Preparing means that we haven't actually started the workspace instance just yet, but rather
   * are still preparing for launch.
   */
  PHASE_PREPARING = "PHASE_PREPARING",
  /** PHASE_IMAGEBUILD - ImageBuild indicates that there's an image build running for this workspace. */
  PHASE_IMAGEBUILD = "PHASE_IMAGEBUILD",
  /**
   * PHASE_PENDING - Pending means the workspace does not yet consume resources in the cluster, but rather is looking for
   * some space within the cluster. If for example the cluster needs to scale up to accomodate the
   * workspace, the workspace will be in Pending state until that happened.
   */
  PHASE_PENDING = "PHASE_PENDING",
  /**
   * PHASE_CREATING - Creating means the workspace is currently being created. That includes downloading the images required
   * to run the workspace over the network. The time spent in this phase varies widely and depends on the current
   * network speed, image size and cache states.
   */
  PHASE_CREATING = "PHASE_CREATING",
  /**
   * PHASE_INITIALIZING - Initializing is the phase in which the workspace is executing the appropriate workspace initializer (e.g. Git
   * clone or backup download). After this phase one can expect the workspace to either be Running or Failed.
   */
  PHASE_INITIALIZING = "PHASE_INITIALIZING",
  /**
   * PHASE_RUNNING - Running means the workspace is able to actively perform work, either by serving a user through Theia,
   * or as a headless workspace.
   */
  PHASE_RUNNING = "PHASE_RUNNING",
  /**
   * PHASE_INTERRUPTED - Interrupted is an exceptional state where the container should be running but is temporarily unavailable.
   * When in this state, we expect it to become running or stopping anytime soon.
   */
  PHASE_INTERRUPTED = "PHASE_INTERRUPTED",
  /** PHASE_STOPPING - Stopping means that the workspace is currently shutting down. It could go to stopped every moment. */
  PHASE_STOPPING = "PHASE_STOPPING",
  /** PHASE_STOPPED - Stopped means the workspace ended regularly because it was shut down. */
  PHASE_STOPPED = "PHASE_STOPPED",
  UNRECOGNIZED = "UNRECOGNIZED",
}

export function workspaceInstanceStatus_PhaseFromJSON(object: any): WorkspaceInstanceStatus_Phase {
  switch (object) {
    case 0:
    case "PHASE_UNSPECIFIED":
      return WorkspaceInstanceStatus_Phase.PHASE_UNSPECIFIED;
    case 1:
    case "PHASE_PREPARING":
      return WorkspaceInstanceStatus_Phase.PHASE_PREPARING;
    case 2:
    case "PHASE_IMAGEBUILD":
      return WorkspaceInstanceStatus_Phase.PHASE_IMAGEBUILD;
    case 3:
    case "PHASE_PENDING":
      return WorkspaceInstanceStatus_Phase.PHASE_PENDING;
    case 4:
    case "PHASE_CREATING":
      return WorkspaceInstanceStatus_Phase.PHASE_CREATING;
    case 5:
    case "PHASE_INITIALIZING":
      return WorkspaceInstanceStatus_Phase.PHASE_INITIALIZING;
    case 6:
    case "PHASE_RUNNING":
      return WorkspaceInstanceStatus_Phase.PHASE_RUNNING;
    case 7:
    case "PHASE_INTERRUPTED":
      return WorkspaceInstanceStatus_Phase.PHASE_INTERRUPTED;
    case 8:
    case "PHASE_STOPPING":
      return WorkspaceInstanceStatus_Phase.PHASE_STOPPING;
    case 9:
    case "PHASE_STOPPED":
      return WorkspaceInstanceStatus_Phase.PHASE_STOPPED;
    case -1:
    case "UNRECOGNIZED":
    default:
      return WorkspaceInstanceStatus_Phase.UNRECOGNIZED;
  }
}

export function workspaceInstanceStatus_PhaseToJSON(object: WorkspaceInstanceStatus_Phase): string {
  switch (object) {
    case WorkspaceInstanceStatus_Phase.PHASE_UNSPECIFIED:
      return "PHASE_UNSPECIFIED";
    case WorkspaceInstanceStatus_Phase.PHASE_PREPARING:
      return "PHASE_PREPARING";
    case WorkspaceInstanceStatus_Phase.PHASE_IMAGEBUILD:
      return "PHASE_IMAGEBUILD";
    case WorkspaceInstanceStatus_Phase.PHASE_PENDING:
      return "PHASE_PENDING";
    case WorkspaceInstanceStatus_Phase.PHASE_CREATING:
      return "PHASE_CREATING";
    case WorkspaceInstanceStatus_Phase.PHASE_INITIALIZING:
      return "PHASE_INITIALIZING";
    case WorkspaceInstanceStatus_Phase.PHASE_RUNNING:
      return "PHASE_RUNNING";
    case WorkspaceInstanceStatus_Phase.PHASE_INTERRUPTED:
      return "PHASE_INTERRUPTED";
    case WorkspaceInstanceStatus_Phase.PHASE_STOPPING:
      return "PHASE_STOPPING";
    case WorkspaceInstanceStatus_Phase.PHASE_STOPPED:
      return "PHASE_STOPPED";
    case WorkspaceInstanceStatus_Phase.UNRECOGNIZED:
    default:
      return "UNRECOGNIZED";
  }
}

export function workspaceInstanceStatus_PhaseToNumber(object: WorkspaceInstanceStatus_Phase): number {
  switch (object) {
    case WorkspaceInstanceStatus_Phase.PHASE_UNSPECIFIED:
      return 0;
    case WorkspaceInstanceStatus_Phase.PHASE_PREPARING:
      return 1;
    case WorkspaceInstanceStatus_Phase.PHASE_IMAGEBUILD:
      return 2;
    case WorkspaceInstanceStatus_Phase.PHASE_PENDING:
      return 3;
    case WorkspaceInstanceStatus_Phase.PHASE_CREATING:
      return 4;
    case WorkspaceInstanceStatus_Phase.PHASE_INITIALIZING:
      return 5;
    case WorkspaceInstanceStatus_Phase.PHASE_RUNNING:
      return 6;
    case WorkspaceInstanceStatus_Phase.PHASE_INTERRUPTED:
      return 7;
    case WorkspaceInstanceStatus_Phase.PHASE_STOPPING:
      return 8;
    case WorkspaceInstanceStatus_Phase.PHASE_STOPPED:
      return 9;
    case WorkspaceInstanceStatus_Phase.UNRECOGNIZED:
    default:
      return -1;
  }
}

/**
 * Conditions gives more detailed information as to the state of the workspace. Which condition actually
 * has a value depends on the phase the workspace is in.
 */
export interface WorkspaceInstanceStatus_Conditions {
  /**
   * failed contains the reason the workspace failed to operate. If this field is empty, the workspace has not failed.
   * This field is filled exclusively when caused by system errors.
   */
  failed: string;
  /** timeout contains the reason the workspace has timed out. If this field is empty, the workspace has not timed out. */
  timeout: string;
  /** first_user_activity is the time when MarkActive was first called on the workspace */
  firstUserActivity:
    | Date
    | undefined;
  /** stopped_by_request is true if the workspace was stopped using a StopWorkspace call */
  stoppedByRequest?: boolean | undefined;
}

export interface Port {
  /** port number */
  port: number;
  /** policy of this port */
  policy: PortPolicy;
  /** url that can be used to access the port */
  url: string;
}

/** StartWorkspaceSpec influences the workspace start */
export interface StartWorkspaceSpec {
}

export interface PortSpec {
  /** port number */
  port: number;
  /** policy of this port */
  policy: PortPolicy;
}

export interface UpdatePortRequest {
  workspaceId: string;
  port: PortSpec | undefined;
}

export interface UpdatePortResponse {
}

function createBaseListWorkspacesRequest(): ListWorkspacesRequest {
  return { pagination: undefined, fieldMask: undefined };
}

export const ListWorkspacesRequest = {
  encode(message: ListWorkspacesRequest, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.pagination !== undefined) {
      Pagination.encode(message.pagination, writer.uint32(10).fork()).ldelim();
    }
    if (message.fieldMask !== undefined) {
      FieldMask.encode(FieldMask.wrap(message.fieldMask), writer.uint32(18).fork()).ldelim();
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): ListWorkspacesRequest {
    const reader = input instanceof _m0.Reader ? input : new _m0.Reader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseListWorkspacesRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.pagination = Pagination.decode(reader, reader.uint32());
          break;
        case 2:
          message.fieldMask = FieldMask.unwrap(FieldMask.decode(reader, reader.uint32()));
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },

  fromJSON(object: any): ListWorkspacesRequest {
    return {
      pagination: isSet(object.pagination) ? Pagination.fromJSON(object.pagination) : undefined,
      fieldMask: isSet(object.fieldMask) ? FieldMask.unwrap(FieldMask.fromJSON(object.fieldMask)) : undefined,
    };
  },

  toJSON(message: ListWorkspacesRequest): unknown {
    const obj: any = {};
    message.pagination !== undefined &&
      (obj.pagination = message.pagination ? Pagination.toJSON(message.pagination) : undefined);
    message.fieldMask !== undefined && (obj.fieldMask = FieldMask.toJSON(FieldMask.wrap(message.fieldMask)));
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<ListWorkspacesRequest>, I>>(object: I): ListWorkspacesRequest {
    const message = createBaseListWorkspacesRequest();
    message.pagination = (object.pagination !== undefined && object.pagination !== null)
      ? Pagination.fromPartial(object.pagination)
      : undefined;
    message.fieldMask = object.fieldMask ?? undefined;
    return message;
  },
};

function createBaseListWorkspacesResponse(): ListWorkspacesResponse {
  return { nextPageToken: "", result: [] };
}

export const ListWorkspacesResponse = {
  encode(message: ListWorkspacesResponse, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.nextPageToken !== "") {
      writer.uint32(10).string(message.nextPageToken);
    }
    for (const v of message.result) {
      Workspace.encode(v!, writer.uint32(18).fork()).ldelim();
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): ListWorkspacesResponse {
    const reader = input instanceof _m0.Reader ? input : new _m0.Reader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseListWorkspacesResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.nextPageToken = reader.string();
          break;
        case 2:
          message.result.push(Workspace.decode(reader, reader.uint32()));
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },

  fromJSON(object: any): ListWorkspacesResponse {
    return {
      nextPageToken: isSet(object.nextPageToken) ? String(object.nextPageToken) : "",
      result: Array.isArray(object?.result) ? object.result.map((e: any) => Workspace.fromJSON(e)) : [],
    };
  },

  toJSON(message: ListWorkspacesResponse): unknown {
    const obj: any = {};
    message.nextPageToken !== undefined && (obj.nextPageToken = message.nextPageToken);
    if (message.result) {
      obj.result = message.result.map((e) => e ? Workspace.toJSON(e) : undefined);
    } else {
      obj.result = [];
    }
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<ListWorkspacesResponse>, I>>(object: I): ListWorkspacesResponse {
    const message = createBaseListWorkspacesResponse();
    message.nextPageToken = object.nextPageToken ?? "";
    message.result = object.result?.map((e) => Workspace.fromPartial(e)) || [];
    return message;
  },
};

function createBaseGetWorkspaceRequest(): GetWorkspaceRequest {
  return { workspaceId: "" };
}

export const GetWorkspaceRequest = {
  encode(message: GetWorkspaceRequest, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.workspaceId !== "") {
      writer.uint32(10).string(message.workspaceId);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): GetWorkspaceRequest {
    const reader = input instanceof _m0.Reader ? input : new _m0.Reader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseGetWorkspaceRequest();
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

  fromJSON(object: any): GetWorkspaceRequest {
    return { workspaceId: isSet(object.workspaceId) ? String(object.workspaceId) : "" };
  },

  toJSON(message: GetWorkspaceRequest): unknown {
    const obj: any = {};
    message.workspaceId !== undefined && (obj.workspaceId = message.workspaceId);
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<GetWorkspaceRequest>, I>>(object: I): GetWorkspaceRequest {
    const message = createBaseGetWorkspaceRequest();
    message.workspaceId = object.workspaceId ?? "";
    return message;
  },
};

function createBaseGetWorkspaceResponse(): GetWorkspaceResponse {
  return { result: undefined };
}

export const GetWorkspaceResponse = {
  encode(message: GetWorkspaceResponse, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.result !== undefined) {
      Workspace.encode(message.result, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): GetWorkspaceResponse {
    const reader = input instanceof _m0.Reader ? input : new _m0.Reader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseGetWorkspaceResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.result = Workspace.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },

  fromJSON(object: any): GetWorkspaceResponse {
    return { result: isSet(object.result) ? Workspace.fromJSON(object.result) : undefined };
  },

  toJSON(message: GetWorkspaceResponse): unknown {
    const obj: any = {};
    message.result !== undefined && (obj.result = message.result ? Workspace.toJSON(message.result) : undefined);
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<GetWorkspaceResponse>, I>>(object: I): GetWorkspaceResponse {
    const message = createBaseGetWorkspaceResponse();
    message.result = (object.result !== undefined && object.result !== null)
      ? Workspace.fromPartial(object.result)
      : undefined;
    return message;
  },
};

function createBaseStreamWorkspaceStatusRequest(): StreamWorkspaceStatusRequest {
  return { workspaceId: "" };
}

export const StreamWorkspaceStatusRequest = {
  encode(message: StreamWorkspaceStatusRequest, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.workspaceId !== "") {
      writer.uint32(10).string(message.workspaceId);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): StreamWorkspaceStatusRequest {
    const reader = input instanceof _m0.Reader ? input : new _m0.Reader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseStreamWorkspaceStatusRequest();
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

  fromJSON(object: any): StreamWorkspaceStatusRequest {
    return { workspaceId: isSet(object.workspaceId) ? String(object.workspaceId) : "" };
  },

  toJSON(message: StreamWorkspaceStatusRequest): unknown {
    const obj: any = {};
    message.workspaceId !== undefined && (obj.workspaceId = message.workspaceId);
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<StreamWorkspaceStatusRequest>, I>>(object: I): StreamWorkspaceStatusRequest {
    const message = createBaseStreamWorkspaceStatusRequest();
    message.workspaceId = object.workspaceId ?? "";
    return message;
  },
};

function createBaseStreamWorkspaceStatusResponse(): StreamWorkspaceStatusResponse {
  return { result: undefined };
}

export const StreamWorkspaceStatusResponse = {
  encode(message: StreamWorkspaceStatusResponse, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.result !== undefined) {
      WorkspaceStatus.encode(message.result, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): StreamWorkspaceStatusResponse {
    const reader = input instanceof _m0.Reader ? input : new _m0.Reader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseStreamWorkspaceStatusResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.result = WorkspaceStatus.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },

  fromJSON(object: any): StreamWorkspaceStatusResponse {
    return { result: isSet(object.result) ? WorkspaceStatus.fromJSON(object.result) : undefined };
  },

  toJSON(message: StreamWorkspaceStatusResponse): unknown {
    const obj: any = {};
    message.result !== undefined && (obj.result = message.result ? WorkspaceStatus.toJSON(message.result) : undefined);
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<StreamWorkspaceStatusResponse>, I>>(
    object: I,
  ): StreamWorkspaceStatusResponse {
    const message = createBaseStreamWorkspaceStatusResponse();
    message.result = (object.result !== undefined && object.result !== null)
      ? WorkspaceStatus.fromPartial(object.result)
      : undefined;
    return message;
  },
};

function createBaseGetOwnerTokenRequest(): GetOwnerTokenRequest {
  return { workspaceId: "" };
}

export const GetOwnerTokenRequest = {
  encode(message: GetOwnerTokenRequest, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.workspaceId !== "") {
      writer.uint32(10).string(message.workspaceId);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): GetOwnerTokenRequest {
    const reader = input instanceof _m0.Reader ? input : new _m0.Reader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseGetOwnerTokenRequest();
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

  fromJSON(object: any): GetOwnerTokenRequest {
    return { workspaceId: isSet(object.workspaceId) ? String(object.workspaceId) : "" };
  },

  toJSON(message: GetOwnerTokenRequest): unknown {
    const obj: any = {};
    message.workspaceId !== undefined && (obj.workspaceId = message.workspaceId);
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<GetOwnerTokenRequest>, I>>(object: I): GetOwnerTokenRequest {
    const message = createBaseGetOwnerTokenRequest();
    message.workspaceId = object.workspaceId ?? "";
    return message;
  },
};

function createBaseGetOwnerTokenResponse(): GetOwnerTokenResponse {
  return { token: "" };
}

export const GetOwnerTokenResponse = {
  encode(message: GetOwnerTokenResponse, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.token !== "") {
      writer.uint32(10).string(message.token);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): GetOwnerTokenResponse {
    const reader = input instanceof _m0.Reader ? input : new _m0.Reader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseGetOwnerTokenResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.token = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },

  fromJSON(object: any): GetOwnerTokenResponse {
    return { token: isSet(object.token) ? String(object.token) : "" };
  },

  toJSON(message: GetOwnerTokenResponse): unknown {
    const obj: any = {};
    message.token !== undefined && (obj.token = message.token);
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<GetOwnerTokenResponse>, I>>(object: I): GetOwnerTokenResponse {
    const message = createBaseGetOwnerTokenResponse();
    message.token = object.token ?? "";
    return message;
  },
};

function createBaseCreateAndStartWorkspaceRequest(): CreateAndStartWorkspaceRequest {
  return { idempotencyToken: "", contextUrl: undefined, prebuildId: undefined, startSpec: undefined };
}

export const CreateAndStartWorkspaceRequest = {
  encode(message: CreateAndStartWorkspaceRequest, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.idempotencyToken !== "") {
      writer.uint32(10).string(message.idempotencyToken);
    }
    if (message.contextUrl !== undefined) {
      writer.uint32(18).string(message.contextUrl);
    }
    if (message.prebuildId !== undefined) {
      writer.uint32(26).string(message.prebuildId);
    }
    if (message.startSpec !== undefined) {
      StartWorkspaceSpec.encode(message.startSpec, writer.uint32(42).fork()).ldelim();
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): CreateAndStartWorkspaceRequest {
    const reader = input instanceof _m0.Reader ? input : new _m0.Reader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseCreateAndStartWorkspaceRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.idempotencyToken = reader.string();
          break;
        case 2:
          message.contextUrl = reader.string();
          break;
        case 3:
          message.prebuildId = reader.string();
          break;
        case 5:
          message.startSpec = StartWorkspaceSpec.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },

  fromJSON(object: any): CreateAndStartWorkspaceRequest {
    return {
      idempotencyToken: isSet(object.idempotencyToken) ? String(object.idempotencyToken) : "",
      contextUrl: isSet(object.contextUrl) ? String(object.contextUrl) : undefined,
      prebuildId: isSet(object.prebuildId) ? String(object.prebuildId) : undefined,
      startSpec: isSet(object.startSpec) ? StartWorkspaceSpec.fromJSON(object.startSpec) : undefined,
    };
  },

  toJSON(message: CreateAndStartWorkspaceRequest): unknown {
    const obj: any = {};
    message.idempotencyToken !== undefined && (obj.idempotencyToken = message.idempotencyToken);
    message.contextUrl !== undefined && (obj.contextUrl = message.contextUrl);
    message.prebuildId !== undefined && (obj.prebuildId = message.prebuildId);
    message.startSpec !== undefined &&
      (obj.startSpec = message.startSpec ? StartWorkspaceSpec.toJSON(message.startSpec) : undefined);
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<CreateAndStartWorkspaceRequest>, I>>(
    object: I,
  ): CreateAndStartWorkspaceRequest {
    const message = createBaseCreateAndStartWorkspaceRequest();
    message.idempotencyToken = object.idempotencyToken ?? "";
    message.contextUrl = object.contextUrl ?? undefined;
    message.prebuildId = object.prebuildId ?? undefined;
    message.startSpec = (object.startSpec !== undefined && object.startSpec !== null)
      ? StartWorkspaceSpec.fromPartial(object.startSpec)
      : undefined;
    return message;
  },
};

function createBaseCreateAndStartWorkspaceResponse(): CreateAndStartWorkspaceResponse {
  return { workspaceId: "" };
}

export const CreateAndStartWorkspaceResponse = {
  encode(message: CreateAndStartWorkspaceResponse, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.workspaceId !== "") {
      writer.uint32(10).string(message.workspaceId);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): CreateAndStartWorkspaceResponse {
    const reader = input instanceof _m0.Reader ? input : new _m0.Reader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseCreateAndStartWorkspaceResponse();
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

  fromJSON(object: any): CreateAndStartWorkspaceResponse {
    return { workspaceId: isSet(object.workspaceId) ? String(object.workspaceId) : "" };
  },

  toJSON(message: CreateAndStartWorkspaceResponse): unknown {
    const obj: any = {};
    message.workspaceId !== undefined && (obj.workspaceId = message.workspaceId);
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<CreateAndStartWorkspaceResponse>, I>>(
    object: I,
  ): CreateAndStartWorkspaceResponse {
    const message = createBaseCreateAndStartWorkspaceResponse();
    message.workspaceId = object.workspaceId ?? "";
    return message;
  },
};

function createBaseStartWorkspaceRequest(): StartWorkspaceRequest {
  return { idempotencyToken: "", workspaceId: "", spec: undefined };
}

export const StartWorkspaceRequest = {
  encode(message: StartWorkspaceRequest, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.idempotencyToken !== "") {
      writer.uint32(10).string(message.idempotencyToken);
    }
    if (message.workspaceId !== "") {
      writer.uint32(18).string(message.workspaceId);
    }
    if (message.spec !== undefined) {
      StartWorkspaceSpec.encode(message.spec, writer.uint32(26).fork()).ldelim();
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): StartWorkspaceRequest {
    const reader = input instanceof _m0.Reader ? input : new _m0.Reader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseStartWorkspaceRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.idempotencyToken = reader.string();
          break;
        case 2:
          message.workspaceId = reader.string();
          break;
        case 3:
          message.spec = StartWorkspaceSpec.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },

  fromJSON(object: any): StartWorkspaceRequest {
    return {
      idempotencyToken: isSet(object.idempotencyToken) ? String(object.idempotencyToken) : "",
      workspaceId: isSet(object.workspaceId) ? String(object.workspaceId) : "",
      spec: isSet(object.spec) ? StartWorkspaceSpec.fromJSON(object.spec) : undefined,
    };
  },

  toJSON(message: StartWorkspaceRequest): unknown {
    const obj: any = {};
    message.idempotencyToken !== undefined && (obj.idempotencyToken = message.idempotencyToken);
    message.workspaceId !== undefined && (obj.workspaceId = message.workspaceId);
    message.spec !== undefined && (obj.spec = message.spec ? StartWorkspaceSpec.toJSON(message.spec) : undefined);
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<StartWorkspaceRequest>, I>>(object: I): StartWorkspaceRequest {
    const message = createBaseStartWorkspaceRequest();
    message.idempotencyToken = object.idempotencyToken ?? "";
    message.workspaceId = object.workspaceId ?? "";
    message.spec = (object.spec !== undefined && object.spec !== null)
      ? StartWorkspaceSpec.fromPartial(object.spec)
      : undefined;
    return message;
  },
};

function createBaseStartWorkspaceResponse(): StartWorkspaceResponse {
  return { instanceId: "", workspaceUrl: "" };
}

export const StartWorkspaceResponse = {
  encode(message: StartWorkspaceResponse, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.instanceId !== "") {
      writer.uint32(10).string(message.instanceId);
    }
    if (message.workspaceUrl !== "") {
      writer.uint32(18).string(message.workspaceUrl);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): StartWorkspaceResponse {
    const reader = input instanceof _m0.Reader ? input : new _m0.Reader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseStartWorkspaceResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.instanceId = reader.string();
          break;
        case 2:
          message.workspaceUrl = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },

  fromJSON(object: any): StartWorkspaceResponse {
    return {
      instanceId: isSet(object.instanceId) ? String(object.instanceId) : "",
      workspaceUrl: isSet(object.workspaceUrl) ? String(object.workspaceUrl) : "",
    };
  },

  toJSON(message: StartWorkspaceResponse): unknown {
    const obj: any = {};
    message.instanceId !== undefined && (obj.instanceId = message.instanceId);
    message.workspaceUrl !== undefined && (obj.workspaceUrl = message.workspaceUrl);
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<StartWorkspaceResponse>, I>>(object: I): StartWorkspaceResponse {
    const message = createBaseStartWorkspaceResponse();
    message.instanceId = object.instanceId ?? "";
    message.workspaceUrl = object.workspaceUrl ?? "";
    return message;
  },
};

function createBaseStopWorkspaceRequest(): StopWorkspaceRequest {
  return { workspaceId: "" };
}

export const StopWorkspaceRequest = {
  encode(message: StopWorkspaceRequest, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.workspaceId !== "") {
      writer.uint32(10).string(message.workspaceId);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): StopWorkspaceRequest {
    const reader = input instanceof _m0.Reader ? input : new _m0.Reader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseStopWorkspaceRequest();
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

  fromJSON(object: any): StopWorkspaceRequest {
    return { workspaceId: isSet(object.workspaceId) ? String(object.workspaceId) : "" };
  },

  toJSON(message: StopWorkspaceRequest): unknown {
    const obj: any = {};
    message.workspaceId !== undefined && (obj.workspaceId = message.workspaceId);
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<StopWorkspaceRequest>, I>>(object: I): StopWorkspaceRequest {
    const message = createBaseStopWorkspaceRequest();
    message.workspaceId = object.workspaceId ?? "";
    return message;
  },
};

function createBaseStopWorkspaceResponse(): StopWorkspaceResponse {
  return {};
}

export const StopWorkspaceResponse = {
  encode(_: StopWorkspaceResponse, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): StopWorkspaceResponse {
    const reader = input instanceof _m0.Reader ? input : new _m0.Reader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseStopWorkspaceResponse();
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

  fromJSON(_: any): StopWorkspaceResponse {
    return {};
  },

  toJSON(_: StopWorkspaceResponse): unknown {
    const obj: any = {};
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<StopWorkspaceResponse>, I>>(_: I): StopWorkspaceResponse {
    const message = createBaseStopWorkspaceResponse();
    return message;
  },
};

function createBaseDeleteWorkspaceRequest(): DeleteWorkspaceRequest {
  return { workspaceId: "" };
}

export const DeleteWorkspaceRequest = {
  encode(message: DeleteWorkspaceRequest, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.workspaceId !== "") {
      writer.uint32(10).string(message.workspaceId);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): DeleteWorkspaceRequest {
    const reader = input instanceof _m0.Reader ? input : new _m0.Reader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseDeleteWorkspaceRequest();
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

  fromJSON(object: any): DeleteWorkspaceRequest {
    return { workspaceId: isSet(object.workspaceId) ? String(object.workspaceId) : "" };
  },

  toJSON(message: DeleteWorkspaceRequest): unknown {
    const obj: any = {};
    message.workspaceId !== undefined && (obj.workspaceId = message.workspaceId);
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<DeleteWorkspaceRequest>, I>>(object: I): DeleteWorkspaceRequest {
    const message = createBaseDeleteWorkspaceRequest();
    message.workspaceId = object.workspaceId ?? "";
    return message;
  },
};

function createBaseDeleteWorkspaceResponse(): DeleteWorkspaceResponse {
  return {};
}

export const DeleteWorkspaceResponse = {
  encode(_: DeleteWorkspaceResponse, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): DeleteWorkspaceResponse {
    const reader = input instanceof _m0.Reader ? input : new _m0.Reader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseDeleteWorkspaceResponse();
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

  fromJSON(_: any): DeleteWorkspaceResponse {
    return {};
  },

  toJSON(_: DeleteWorkspaceResponse): unknown {
    const obj: any = {};
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<DeleteWorkspaceResponse>, I>>(_: I): DeleteWorkspaceResponse {
    const message = createBaseDeleteWorkspaceResponse();
    return message;
  },
};

function createBaseWorkspace(): Workspace {
  return { workspaceId: "", ownerId: "", projectId: "", context: undefined, description: "", status: undefined };
}

export const Workspace = {
  encode(message: Workspace, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.workspaceId !== "") {
      writer.uint32(10).string(message.workspaceId);
    }
    if (message.ownerId !== "") {
      writer.uint32(18).string(message.ownerId);
    }
    if (message.projectId !== "") {
      writer.uint32(26).string(message.projectId);
    }
    if (message.context !== undefined) {
      WorkspaceContext.encode(message.context, writer.uint32(34).fork()).ldelim();
    }
    if (message.description !== "") {
      writer.uint32(42).string(message.description);
    }
    if (message.status !== undefined) {
      WorkspaceStatus.encode(message.status, writer.uint32(50).fork()).ldelim();
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): Workspace {
    const reader = input instanceof _m0.Reader ? input : new _m0.Reader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseWorkspace();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.workspaceId = reader.string();
          break;
        case 2:
          message.ownerId = reader.string();
          break;
        case 3:
          message.projectId = reader.string();
          break;
        case 4:
          message.context = WorkspaceContext.decode(reader, reader.uint32());
          break;
        case 5:
          message.description = reader.string();
          break;
        case 6:
          message.status = WorkspaceStatus.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },

  fromJSON(object: any): Workspace {
    return {
      workspaceId: isSet(object.workspaceId) ? String(object.workspaceId) : "",
      ownerId: isSet(object.ownerId) ? String(object.ownerId) : "",
      projectId: isSet(object.projectId) ? String(object.projectId) : "",
      context: isSet(object.context) ? WorkspaceContext.fromJSON(object.context) : undefined,
      description: isSet(object.description) ? String(object.description) : "",
      status: isSet(object.status) ? WorkspaceStatus.fromJSON(object.status) : undefined,
    };
  },

  toJSON(message: Workspace): unknown {
    const obj: any = {};
    message.workspaceId !== undefined && (obj.workspaceId = message.workspaceId);
    message.ownerId !== undefined && (obj.ownerId = message.ownerId);
    message.projectId !== undefined && (obj.projectId = message.projectId);
    message.context !== undefined &&
      (obj.context = message.context ? WorkspaceContext.toJSON(message.context) : undefined);
    message.description !== undefined && (obj.description = message.description);
    message.status !== undefined && (obj.status = message.status ? WorkspaceStatus.toJSON(message.status) : undefined);
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<Workspace>, I>>(object: I): Workspace {
    const message = createBaseWorkspace();
    message.workspaceId = object.workspaceId ?? "";
    message.ownerId = object.ownerId ?? "";
    message.projectId = object.projectId ?? "";
    message.context = (object.context !== undefined && object.context !== null)
      ? WorkspaceContext.fromPartial(object.context)
      : undefined;
    message.description = object.description ?? "";
    message.status = (object.status !== undefined && object.status !== null)
      ? WorkspaceStatus.fromPartial(object.status)
      : undefined;
    return message;
  },
};

function createBaseWorkspaceStatus(): WorkspaceStatus {
  return { instance: undefined };
}

export const WorkspaceStatus = {
  encode(message: WorkspaceStatus, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.instance !== undefined) {
      WorkspaceInstance.encode(message.instance, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): WorkspaceStatus {
    const reader = input instanceof _m0.Reader ? input : new _m0.Reader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseWorkspaceStatus();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.instance = WorkspaceInstance.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },

  fromJSON(object: any): WorkspaceStatus {
    return { instance: isSet(object.instance) ? WorkspaceInstance.fromJSON(object.instance) : undefined };
  },

  toJSON(message: WorkspaceStatus): unknown {
    const obj: any = {};
    message.instance !== undefined &&
      (obj.instance = message.instance ? WorkspaceInstance.toJSON(message.instance) : undefined);
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<WorkspaceStatus>, I>>(object: I): WorkspaceStatus {
    const message = createBaseWorkspaceStatus();
    message.instance = (object.instance !== undefined && object.instance !== null)
      ? WorkspaceInstance.fromPartial(object.instance)
      : undefined;
    return message;
  },
};

function createBaseWorkspaceContext(): WorkspaceContext {
  return { contextUrl: "", git: undefined, prebuild: undefined, snapshot: undefined };
}

export const WorkspaceContext = {
  encode(message: WorkspaceContext, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.contextUrl !== "") {
      writer.uint32(10).string(message.contextUrl);
    }
    if (message.git !== undefined) {
      WorkspaceContext_Git.encode(message.git, writer.uint32(18).fork()).ldelim();
    }
    if (message.prebuild !== undefined) {
      WorkspaceContext_Prebuild.encode(message.prebuild, writer.uint32(26).fork()).ldelim();
    }
    if (message.snapshot !== undefined) {
      WorkspaceContext_Snapshot.encode(message.snapshot, writer.uint32(34).fork()).ldelim();
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): WorkspaceContext {
    const reader = input instanceof _m0.Reader ? input : new _m0.Reader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseWorkspaceContext();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.contextUrl = reader.string();
          break;
        case 2:
          message.git = WorkspaceContext_Git.decode(reader, reader.uint32());
          break;
        case 3:
          message.prebuild = WorkspaceContext_Prebuild.decode(reader, reader.uint32());
          break;
        case 4:
          message.snapshot = WorkspaceContext_Snapshot.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },

  fromJSON(object: any): WorkspaceContext {
    return {
      contextUrl: isSet(object.contextUrl) ? String(object.contextUrl) : "",
      git: isSet(object.git) ? WorkspaceContext_Git.fromJSON(object.git) : undefined,
      prebuild: isSet(object.prebuild) ? WorkspaceContext_Prebuild.fromJSON(object.prebuild) : undefined,
      snapshot: isSet(object.snapshot) ? WorkspaceContext_Snapshot.fromJSON(object.snapshot) : undefined,
    };
  },

  toJSON(message: WorkspaceContext): unknown {
    const obj: any = {};
    message.contextUrl !== undefined && (obj.contextUrl = message.contextUrl);
    message.git !== undefined && (obj.git = message.git ? WorkspaceContext_Git.toJSON(message.git) : undefined);
    message.prebuild !== undefined &&
      (obj.prebuild = message.prebuild ? WorkspaceContext_Prebuild.toJSON(message.prebuild) : undefined);
    message.snapshot !== undefined &&
      (obj.snapshot = message.snapshot ? WorkspaceContext_Snapshot.toJSON(message.snapshot) : undefined);
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<WorkspaceContext>, I>>(object: I): WorkspaceContext {
    const message = createBaseWorkspaceContext();
    message.contextUrl = object.contextUrl ?? "";
    message.git = (object.git !== undefined && object.git !== null)
      ? WorkspaceContext_Git.fromPartial(object.git)
      : undefined;
    message.prebuild = (object.prebuild !== undefined && object.prebuild !== null)
      ? WorkspaceContext_Prebuild.fromPartial(object.prebuild)
      : undefined;
    message.snapshot = (object.snapshot !== undefined && object.snapshot !== null)
      ? WorkspaceContext_Snapshot.fromPartial(object.snapshot)
      : undefined;
    return message;
  },
};

function createBaseWorkspaceContext_Git(): WorkspaceContext_Git {
  return { normalizedContextUrl: "", commit: "" };
}

export const WorkspaceContext_Git = {
  encode(message: WorkspaceContext_Git, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.normalizedContextUrl !== "") {
      writer.uint32(10).string(message.normalizedContextUrl);
    }
    if (message.commit !== "") {
      writer.uint32(18).string(message.commit);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): WorkspaceContext_Git {
    const reader = input instanceof _m0.Reader ? input : new _m0.Reader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseWorkspaceContext_Git();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.normalizedContextUrl = reader.string();
          break;
        case 2:
          message.commit = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },

  fromJSON(object: any): WorkspaceContext_Git {
    return {
      normalizedContextUrl: isSet(object.normalizedContextUrl) ? String(object.normalizedContextUrl) : "",
      commit: isSet(object.commit) ? String(object.commit) : "",
    };
  },

  toJSON(message: WorkspaceContext_Git): unknown {
    const obj: any = {};
    message.normalizedContextUrl !== undefined && (obj.normalizedContextUrl = message.normalizedContextUrl);
    message.commit !== undefined && (obj.commit = message.commit);
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<WorkspaceContext_Git>, I>>(object: I): WorkspaceContext_Git {
    const message = createBaseWorkspaceContext_Git();
    message.normalizedContextUrl = object.normalizedContextUrl ?? "";
    message.commit = object.commit ?? "";
    return message;
  },
};

function createBaseWorkspaceContext_Prebuild(): WorkspaceContext_Prebuild {
  return { originalContext: undefined, prebuildId: "" };
}

export const WorkspaceContext_Prebuild = {
  encode(message: WorkspaceContext_Prebuild, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.originalContext !== undefined) {
      WorkspaceContext_Git.encode(message.originalContext, writer.uint32(10).fork()).ldelim();
    }
    if (message.prebuildId !== "") {
      writer.uint32(18).string(message.prebuildId);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): WorkspaceContext_Prebuild {
    const reader = input instanceof _m0.Reader ? input : new _m0.Reader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseWorkspaceContext_Prebuild();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.originalContext = WorkspaceContext_Git.decode(reader, reader.uint32());
          break;
        case 2:
          message.prebuildId = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },

  fromJSON(object: any): WorkspaceContext_Prebuild {
    return {
      originalContext: isSet(object.originalContext)
        ? WorkspaceContext_Git.fromJSON(object.originalContext)
        : undefined,
      prebuildId: isSet(object.prebuildId) ? String(object.prebuildId) : "",
    };
  },

  toJSON(message: WorkspaceContext_Prebuild): unknown {
    const obj: any = {};
    message.originalContext !== undefined &&
      (obj.originalContext = message.originalContext
        ? WorkspaceContext_Git.toJSON(message.originalContext)
        : undefined);
    message.prebuildId !== undefined && (obj.prebuildId = message.prebuildId);
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<WorkspaceContext_Prebuild>, I>>(object: I): WorkspaceContext_Prebuild {
    const message = createBaseWorkspaceContext_Prebuild();
    message.originalContext = (object.originalContext !== undefined && object.originalContext !== null)
      ? WorkspaceContext_Git.fromPartial(object.originalContext)
      : undefined;
    message.prebuildId = object.prebuildId ?? "";
    return message;
  },
};

function createBaseWorkspaceContext_Snapshot(): WorkspaceContext_Snapshot {
  return { snapshotId: "" };
}

export const WorkspaceContext_Snapshot = {
  encode(message: WorkspaceContext_Snapshot, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.snapshotId !== "") {
      writer.uint32(10).string(message.snapshotId);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): WorkspaceContext_Snapshot {
    const reader = input instanceof _m0.Reader ? input : new _m0.Reader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseWorkspaceContext_Snapshot();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.snapshotId = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },

  fromJSON(object: any): WorkspaceContext_Snapshot {
    return { snapshotId: isSet(object.snapshotId) ? String(object.snapshotId) : "" };
  },

  toJSON(message: WorkspaceContext_Snapshot): unknown {
    const obj: any = {};
    message.snapshotId !== undefined && (obj.snapshotId = message.snapshotId);
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<WorkspaceContext_Snapshot>, I>>(object: I): WorkspaceContext_Snapshot {
    const message = createBaseWorkspaceContext_Snapshot();
    message.snapshotId = object.snapshotId ?? "";
    return message;
  },
};

function createBaseWorkspaceInstance(): WorkspaceInstance {
  return { instanceId: "", workspaceId: "", createdAt: undefined, status: undefined };
}

export const WorkspaceInstance = {
  encode(message: WorkspaceInstance, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.instanceId !== "") {
      writer.uint32(10).string(message.instanceId);
    }
    if (message.workspaceId !== "") {
      writer.uint32(18).string(message.workspaceId);
    }
    if (message.createdAt !== undefined) {
      Timestamp.encode(toTimestamp(message.createdAt), writer.uint32(26).fork()).ldelim();
    }
    if (message.status !== undefined) {
      WorkspaceInstanceStatus.encode(message.status, writer.uint32(34).fork()).ldelim();
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): WorkspaceInstance {
    const reader = input instanceof _m0.Reader ? input : new _m0.Reader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseWorkspaceInstance();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.instanceId = reader.string();
          break;
        case 2:
          message.workspaceId = reader.string();
          break;
        case 3:
          message.createdAt = fromTimestamp(Timestamp.decode(reader, reader.uint32()));
          break;
        case 4:
          message.status = WorkspaceInstanceStatus.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },

  fromJSON(object: any): WorkspaceInstance {
    return {
      instanceId: isSet(object.instanceId) ? String(object.instanceId) : "",
      workspaceId: isSet(object.workspaceId) ? String(object.workspaceId) : "",
      createdAt: isSet(object.createdAt) ? fromJsonTimestamp(object.createdAt) : undefined,
      status: isSet(object.status) ? WorkspaceInstanceStatus.fromJSON(object.status) : undefined,
    };
  },

  toJSON(message: WorkspaceInstance): unknown {
    const obj: any = {};
    message.instanceId !== undefined && (obj.instanceId = message.instanceId);
    message.workspaceId !== undefined && (obj.workspaceId = message.workspaceId);
    message.createdAt !== undefined && (obj.createdAt = message.createdAt.toISOString());
    message.status !== undefined &&
      (obj.status = message.status ? WorkspaceInstanceStatus.toJSON(message.status) : undefined);
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<WorkspaceInstance>, I>>(object: I): WorkspaceInstance {
    const message = createBaseWorkspaceInstance();
    message.instanceId = object.instanceId ?? "";
    message.workspaceId = object.workspaceId ?? "";
    message.createdAt = object.createdAt ?? undefined;
    message.status = (object.status !== undefined && object.status !== null)
      ? WorkspaceInstanceStatus.fromPartial(object.status)
      : undefined;
    return message;
  },
};

function createBaseWorkspaceInstanceStatus(): WorkspaceInstanceStatus {
  return {
    statusVersion: 0,
    phase: WorkspaceInstanceStatus_Phase.PHASE_UNSPECIFIED,
    conditions: undefined,
    message: "",
    url: "",
    admission: AdmissionLevel.ADMISSION_LEVEL_UNSPECIFIED,
    ports: [],
  };
}

export const WorkspaceInstanceStatus = {
  encode(message: WorkspaceInstanceStatus, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.statusVersion !== 0) {
      writer.uint32(8).uint64(message.statusVersion);
    }
    if (message.phase !== WorkspaceInstanceStatus_Phase.PHASE_UNSPECIFIED) {
      writer.uint32(16).int32(workspaceInstanceStatus_PhaseToNumber(message.phase));
    }
    if (message.conditions !== undefined) {
      WorkspaceInstanceStatus_Conditions.encode(message.conditions, writer.uint32(26).fork()).ldelim();
    }
    if (message.message !== "") {
      writer.uint32(34).string(message.message);
    }
    if (message.url !== "") {
      writer.uint32(42).string(message.url);
    }
    if (message.admission !== AdmissionLevel.ADMISSION_LEVEL_UNSPECIFIED) {
      writer.uint32(48).int32(admissionLevelToNumber(message.admission));
    }
    for (const v of message.ports) {
      Port.encode(v!, writer.uint32(58).fork()).ldelim();
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): WorkspaceInstanceStatus {
    const reader = input instanceof _m0.Reader ? input : new _m0.Reader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseWorkspaceInstanceStatus();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.statusVersion = longToNumber(reader.uint64() as Long);
          break;
        case 2:
          message.phase = workspaceInstanceStatus_PhaseFromJSON(reader.int32());
          break;
        case 3:
          message.conditions = WorkspaceInstanceStatus_Conditions.decode(reader, reader.uint32());
          break;
        case 4:
          message.message = reader.string();
          break;
        case 5:
          message.url = reader.string();
          break;
        case 6:
          message.admission = admissionLevelFromJSON(reader.int32());
          break;
        case 7:
          message.ports.push(Port.decode(reader, reader.uint32()));
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },

  fromJSON(object: any): WorkspaceInstanceStatus {
    return {
      statusVersion: isSet(object.statusVersion) ? Number(object.statusVersion) : 0,
      phase: isSet(object.phase)
        ? workspaceInstanceStatus_PhaseFromJSON(object.phase)
        : WorkspaceInstanceStatus_Phase.PHASE_UNSPECIFIED,
      conditions: isSet(object.conditions) ? WorkspaceInstanceStatus_Conditions.fromJSON(object.conditions) : undefined,
      message: isSet(object.message) ? String(object.message) : "",
      url: isSet(object.url) ? String(object.url) : "",
      admission: isSet(object.admission)
        ? admissionLevelFromJSON(object.admission)
        : AdmissionLevel.ADMISSION_LEVEL_UNSPECIFIED,
      ports: Array.isArray(object?.ports) ? object.ports.map((e: any) => Port.fromJSON(e)) : [],
    };
  },

  toJSON(message: WorkspaceInstanceStatus): unknown {
    const obj: any = {};
    message.statusVersion !== undefined && (obj.statusVersion = Math.round(message.statusVersion));
    message.phase !== undefined && (obj.phase = workspaceInstanceStatus_PhaseToJSON(message.phase));
    message.conditions !== undefined &&
      (obj.conditions = message.conditions ? WorkspaceInstanceStatus_Conditions.toJSON(message.conditions) : undefined);
    message.message !== undefined && (obj.message = message.message);
    message.url !== undefined && (obj.url = message.url);
    message.admission !== undefined && (obj.admission = admissionLevelToJSON(message.admission));
    if (message.ports) {
      obj.ports = message.ports.map((e) => e ? Port.toJSON(e) : undefined);
    } else {
      obj.ports = [];
    }
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<WorkspaceInstanceStatus>, I>>(object: I): WorkspaceInstanceStatus {
    const message = createBaseWorkspaceInstanceStatus();
    message.statusVersion = object.statusVersion ?? 0;
    message.phase = object.phase ?? WorkspaceInstanceStatus_Phase.PHASE_UNSPECIFIED;
    message.conditions = (object.conditions !== undefined && object.conditions !== null)
      ? WorkspaceInstanceStatus_Conditions.fromPartial(object.conditions)
      : undefined;
    message.message = object.message ?? "";
    message.url = object.url ?? "";
    message.admission = object.admission ?? AdmissionLevel.ADMISSION_LEVEL_UNSPECIFIED;
    message.ports = object.ports?.map((e) => Port.fromPartial(e)) || [];
    return message;
  },
};

function createBaseWorkspaceInstanceStatus_Conditions(): WorkspaceInstanceStatus_Conditions {
  return { failed: "", timeout: "", firstUserActivity: undefined, stoppedByRequest: undefined };
}

export const WorkspaceInstanceStatus_Conditions = {
  encode(message: WorkspaceInstanceStatus_Conditions, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.failed !== "") {
      writer.uint32(10).string(message.failed);
    }
    if (message.timeout !== "") {
      writer.uint32(18).string(message.timeout);
    }
    if (message.firstUserActivity !== undefined) {
      Timestamp.encode(toTimestamp(message.firstUserActivity), writer.uint32(74).fork()).ldelim();
    }
    if (message.stoppedByRequest !== undefined) {
      writer.uint32(88).bool(message.stoppedByRequest);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): WorkspaceInstanceStatus_Conditions {
    const reader = input instanceof _m0.Reader ? input : new _m0.Reader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseWorkspaceInstanceStatus_Conditions();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.failed = reader.string();
          break;
        case 2:
          message.timeout = reader.string();
          break;
        case 9:
          message.firstUserActivity = fromTimestamp(Timestamp.decode(reader, reader.uint32()));
          break;
        case 11:
          message.stoppedByRequest = reader.bool();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },

  fromJSON(object: any): WorkspaceInstanceStatus_Conditions {
    return {
      failed: isSet(object.failed) ? String(object.failed) : "",
      timeout: isSet(object.timeout) ? String(object.timeout) : "",
      firstUserActivity: isSet(object.firstUserActivity) ? fromJsonTimestamp(object.firstUserActivity) : undefined,
      stoppedByRequest: isSet(object.stoppedByRequest) ? Boolean(object.stoppedByRequest) : undefined,
    };
  },

  toJSON(message: WorkspaceInstanceStatus_Conditions): unknown {
    const obj: any = {};
    message.failed !== undefined && (obj.failed = message.failed);
    message.timeout !== undefined && (obj.timeout = message.timeout);
    message.firstUserActivity !== undefined && (obj.firstUserActivity = message.firstUserActivity.toISOString());
    message.stoppedByRequest !== undefined && (obj.stoppedByRequest = message.stoppedByRequest);
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<WorkspaceInstanceStatus_Conditions>, I>>(
    object: I,
  ): WorkspaceInstanceStatus_Conditions {
    const message = createBaseWorkspaceInstanceStatus_Conditions();
    message.failed = object.failed ?? "";
    message.timeout = object.timeout ?? "";
    message.firstUserActivity = object.firstUserActivity ?? undefined;
    message.stoppedByRequest = object.stoppedByRequest ?? undefined;
    return message;
  },
};

function createBasePort(): Port {
  return { port: 0, policy: PortPolicy.PORT_POLICY_UNSPECIFIED, url: "" };
}

export const Port = {
  encode(message: Port, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.port !== 0) {
      writer.uint32(8).uint64(message.port);
    }
    if (message.policy !== PortPolicy.PORT_POLICY_UNSPECIFIED) {
      writer.uint32(16).int32(portPolicyToNumber(message.policy));
    }
    if (message.url !== "") {
      writer.uint32(26).string(message.url);
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): Port {
    const reader = input instanceof _m0.Reader ? input : new _m0.Reader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBasePort();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.port = longToNumber(reader.uint64() as Long);
          break;
        case 2:
          message.policy = portPolicyFromJSON(reader.int32());
          break;
        case 3:
          message.url = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },

  fromJSON(object: any): Port {
    return {
      port: isSet(object.port) ? Number(object.port) : 0,
      policy: isSet(object.policy) ? portPolicyFromJSON(object.policy) : PortPolicy.PORT_POLICY_UNSPECIFIED,
      url: isSet(object.url) ? String(object.url) : "",
    };
  },

  toJSON(message: Port): unknown {
    const obj: any = {};
    message.port !== undefined && (obj.port = Math.round(message.port));
    message.policy !== undefined && (obj.policy = portPolicyToJSON(message.policy));
    message.url !== undefined && (obj.url = message.url);
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<Port>, I>>(object: I): Port {
    const message = createBasePort();
    message.port = object.port ?? 0;
    message.policy = object.policy ?? PortPolicy.PORT_POLICY_UNSPECIFIED;
    message.url = object.url ?? "";
    return message;
  },
};

function createBaseStartWorkspaceSpec(): StartWorkspaceSpec {
  return {};
}

export const StartWorkspaceSpec = {
  encode(_: StartWorkspaceSpec, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): StartWorkspaceSpec {
    const reader = input instanceof _m0.Reader ? input : new _m0.Reader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseStartWorkspaceSpec();
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

  fromJSON(_: any): StartWorkspaceSpec {
    return {};
  },

  toJSON(_: StartWorkspaceSpec): unknown {
    const obj: any = {};
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<StartWorkspaceSpec>, I>>(_: I): StartWorkspaceSpec {
    const message = createBaseStartWorkspaceSpec();
    return message;
  },
};

function createBasePortSpec(): PortSpec {
  return { port: 0, policy: PortPolicy.PORT_POLICY_UNSPECIFIED };
}

export const PortSpec = {
  encode(message: PortSpec, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.port !== 0) {
      writer.uint32(8).uint64(message.port);
    }
    if (message.policy !== PortPolicy.PORT_POLICY_UNSPECIFIED) {
      writer.uint32(16).int32(portPolicyToNumber(message.policy));
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): PortSpec {
    const reader = input instanceof _m0.Reader ? input : new _m0.Reader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBasePortSpec();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.port = longToNumber(reader.uint64() as Long);
          break;
        case 2:
          message.policy = portPolicyFromJSON(reader.int32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },

  fromJSON(object: any): PortSpec {
    return {
      port: isSet(object.port) ? Number(object.port) : 0,
      policy: isSet(object.policy) ? portPolicyFromJSON(object.policy) : PortPolicy.PORT_POLICY_UNSPECIFIED,
    };
  },

  toJSON(message: PortSpec): unknown {
    const obj: any = {};
    message.port !== undefined && (obj.port = Math.round(message.port));
    message.policy !== undefined && (obj.policy = portPolicyToJSON(message.policy));
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<PortSpec>, I>>(object: I): PortSpec {
    const message = createBasePortSpec();
    message.port = object.port ?? 0;
    message.policy = object.policy ?? PortPolicy.PORT_POLICY_UNSPECIFIED;
    return message;
  },
};

function createBaseUpdatePortRequest(): UpdatePortRequest {
  return { workspaceId: "", port: undefined };
}

export const UpdatePortRequest = {
  encode(message: UpdatePortRequest, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.workspaceId !== "") {
      writer.uint32(10).string(message.workspaceId);
    }
    if (message.port !== undefined) {
      PortSpec.encode(message.port, writer.uint32(18).fork()).ldelim();
    }
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): UpdatePortRequest {
    const reader = input instanceof _m0.Reader ? input : new _m0.Reader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseUpdatePortRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.workspaceId = reader.string();
          break;
        case 2:
          message.port = PortSpec.decode(reader, reader.uint32());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },

  fromJSON(object: any): UpdatePortRequest {
    return {
      workspaceId: isSet(object.workspaceId) ? String(object.workspaceId) : "",
      port: isSet(object.port) ? PortSpec.fromJSON(object.port) : undefined,
    };
  },

  toJSON(message: UpdatePortRequest): unknown {
    const obj: any = {};
    message.workspaceId !== undefined && (obj.workspaceId = message.workspaceId);
    message.port !== undefined && (obj.port = message.port ? PortSpec.toJSON(message.port) : undefined);
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<UpdatePortRequest>, I>>(object: I): UpdatePortRequest {
    const message = createBaseUpdatePortRequest();
    message.workspaceId = object.workspaceId ?? "";
    message.port = (object.port !== undefined && object.port !== null) ? PortSpec.fromPartial(object.port) : undefined;
    return message;
  },
};

function createBaseUpdatePortResponse(): UpdatePortResponse {
  return {};
}

export const UpdatePortResponse = {
  encode(_: UpdatePortResponse, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    return writer;
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): UpdatePortResponse {
    const reader = input instanceof _m0.Reader ? input : new _m0.Reader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseUpdatePortResponse();
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

  fromJSON(_: any): UpdatePortResponse {
    return {};
  },

  toJSON(_: UpdatePortResponse): unknown {
    const obj: any = {};
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<UpdatePortResponse>, I>>(_: I): UpdatePortResponse {
    const message = createBaseUpdatePortResponse();
    return message;
  },
};

export type WorkspacesServiceService = typeof WorkspacesServiceService;
export const WorkspacesServiceService = {
  /** ListWorkspaces enumerates all workspaces belonging to the authenticated user. */
  listWorkspaces: {
    path: "/gitpod.experimental.v1.WorkspacesService/ListWorkspaces",
    requestStream: false,
    responseStream: false,
    requestSerialize: (value: ListWorkspacesRequest) => Buffer.from(ListWorkspacesRequest.encode(value).finish()),
    requestDeserialize: (value: Buffer) => ListWorkspacesRequest.decode(value),
    responseSerialize: (value: ListWorkspacesResponse) => Buffer.from(ListWorkspacesResponse.encode(value).finish()),
    responseDeserialize: (value: Buffer) => ListWorkspacesResponse.decode(value),
  },
  /** GetWorkspace returns a single workspace. */
  getWorkspace: {
    path: "/gitpod.experimental.v1.WorkspacesService/GetWorkspace",
    requestStream: false,
    responseStream: false,
    requestSerialize: (value: GetWorkspaceRequest) => Buffer.from(GetWorkspaceRequest.encode(value).finish()),
    requestDeserialize: (value: Buffer) => GetWorkspaceRequest.decode(value),
    responseSerialize: (value: GetWorkspaceResponse) => Buffer.from(GetWorkspaceResponse.encode(value).finish()),
    responseDeserialize: (value: Buffer) => GetWorkspaceResponse.decode(value),
  },
  /** StreamWorkspaceStatus returns workspace status once it changed. */
  streamWorkspaceStatus: {
    path: "/gitpod.experimental.v1.WorkspacesService/StreamWorkspaceStatus",
    requestStream: false,
    responseStream: true,
    requestSerialize: (value: StreamWorkspaceStatusRequest) =>
      Buffer.from(StreamWorkspaceStatusRequest.encode(value).finish()),
    requestDeserialize: (value: Buffer) => StreamWorkspaceStatusRequest.decode(value),
    responseSerialize: (value: StreamWorkspaceStatusResponse) =>
      Buffer.from(StreamWorkspaceStatusResponse.encode(value).finish()),
    responseDeserialize: (value: Buffer) => StreamWorkspaceStatusResponse.decode(value),
  },
  /** GetOwnerToken returns an owner token. */
  getOwnerToken: {
    path: "/gitpod.experimental.v1.WorkspacesService/GetOwnerToken",
    requestStream: false,
    responseStream: false,
    requestSerialize: (value: GetOwnerTokenRequest) => Buffer.from(GetOwnerTokenRequest.encode(value).finish()),
    requestDeserialize: (value: Buffer) => GetOwnerTokenRequest.decode(value),
    responseSerialize: (value: GetOwnerTokenResponse) => Buffer.from(GetOwnerTokenResponse.encode(value).finish()),
    responseDeserialize: (value: Buffer) => GetOwnerTokenResponse.decode(value),
  },
  /** CreateAndStartWorkspace creates a new workspace and starts it. */
  createAndStartWorkspace: {
    path: "/gitpod.experimental.v1.WorkspacesService/CreateAndStartWorkspace",
    requestStream: false,
    responseStream: false,
    requestSerialize: (value: CreateAndStartWorkspaceRequest) =>
      Buffer.from(CreateAndStartWorkspaceRequest.encode(value).finish()),
    requestDeserialize: (value: Buffer) => CreateAndStartWorkspaceRequest.decode(value),
    responseSerialize: (value: CreateAndStartWorkspaceResponse) =>
      Buffer.from(CreateAndStartWorkspaceResponse.encode(value).finish()),
    responseDeserialize: (value: Buffer) => CreateAndStartWorkspaceResponse.decode(value),
  },
  /**
   * StopWorkspace stops a running workspace (instance).
   * Errors:
   *   NOT_FOUND:           the workspace_id is unkown
   *   FAILED_PRECONDITION: if there's no running instance
   */
  stopWorkspace: {
    path: "/gitpod.experimental.v1.WorkspacesService/StopWorkspace",
    requestStream: false,
    responseStream: false,
    requestSerialize: (value: StopWorkspaceRequest) => Buffer.from(StopWorkspaceRequest.encode(value).finish()),
    requestDeserialize: (value: Buffer) => StopWorkspaceRequest.decode(value),
    responseSerialize: (value: StopWorkspaceResponse) => Buffer.from(StopWorkspaceResponse.encode(value).finish()),
    responseDeserialize: (value: Buffer) => StopWorkspaceResponse.decode(value),
  },
  /**
   * DeleteWorkspace deletes a workspace.
   * When the workspace is running, it will be stopped as well.
   * Deleted workspaces cannot be started again.
   */
  deleteWorkspace: {
    path: "/gitpod.experimental.v1.WorkspacesService/DeleteWorkspace",
    requestStream: false,
    responseStream: false,
    requestSerialize: (value: DeleteWorkspaceRequest) => Buffer.from(DeleteWorkspaceRequest.encode(value).finish()),
    requestDeserialize: (value: Buffer) => DeleteWorkspaceRequest.decode(value),
    responseSerialize: (value: DeleteWorkspaceResponse) => Buffer.from(DeleteWorkspaceResponse.encode(value).finish()),
    responseDeserialize: (value: Buffer) => DeleteWorkspaceResponse.decode(value),
  },
  updatePort: {
    path: "/gitpod.experimental.v1.WorkspacesService/UpdatePort",
    requestStream: false,
    responseStream: false,
    requestSerialize: (value: UpdatePortRequest) => Buffer.from(UpdatePortRequest.encode(value).finish()),
    requestDeserialize: (value: Buffer) => UpdatePortRequest.decode(value),
    responseSerialize: (value: UpdatePortResponse) => Buffer.from(UpdatePortResponse.encode(value).finish()),
    responseDeserialize: (value: Buffer) => UpdatePortResponse.decode(value),
  },
} as const;

export interface WorkspacesServiceServer extends UntypedServiceImplementation {
  /** ListWorkspaces enumerates all workspaces belonging to the authenticated user. */
  listWorkspaces: handleUnaryCall<ListWorkspacesRequest, ListWorkspacesResponse>;
  /** GetWorkspace returns a single workspace. */
  getWorkspace: handleUnaryCall<GetWorkspaceRequest, GetWorkspaceResponse>;
  /** StreamWorkspaceStatus returns workspace status once it changed. */
  streamWorkspaceStatus: handleServerStreamingCall<StreamWorkspaceStatusRequest, StreamWorkspaceStatusResponse>;
  /** GetOwnerToken returns an owner token. */
  getOwnerToken: handleUnaryCall<GetOwnerTokenRequest, GetOwnerTokenResponse>;
  /** CreateAndStartWorkspace creates a new workspace and starts it. */
  createAndStartWorkspace: handleUnaryCall<CreateAndStartWorkspaceRequest, CreateAndStartWorkspaceResponse>;
  /**
   * StopWorkspace stops a running workspace (instance).
   * Errors:
   *   NOT_FOUND:           the workspace_id is unkown
   *   FAILED_PRECONDITION: if there's no running instance
   */
  stopWorkspace: handleUnaryCall<StopWorkspaceRequest, StopWorkspaceResponse>;
  /**
   * DeleteWorkspace deletes a workspace.
   * When the workspace is running, it will be stopped as well.
   * Deleted workspaces cannot be started again.
   */
  deleteWorkspace: handleUnaryCall<DeleteWorkspaceRequest, DeleteWorkspaceResponse>;
  updatePort: handleUnaryCall<UpdatePortRequest, UpdatePortResponse>;
}

export interface WorkspacesServiceClient extends Client {
  /** ListWorkspaces enumerates all workspaces belonging to the authenticated user. */
  listWorkspaces(
    request: ListWorkspacesRequest,
    callback: (error: ServiceError | null, response: ListWorkspacesResponse) => void,
  ): ClientUnaryCall;
  listWorkspaces(
    request: ListWorkspacesRequest,
    metadata: Metadata,
    callback: (error: ServiceError | null, response: ListWorkspacesResponse) => void,
  ): ClientUnaryCall;
  listWorkspaces(
    request: ListWorkspacesRequest,
    metadata: Metadata,
    options: Partial<CallOptions>,
    callback: (error: ServiceError | null, response: ListWorkspacesResponse) => void,
  ): ClientUnaryCall;
  /** GetWorkspace returns a single workspace. */
  getWorkspace(
    request: GetWorkspaceRequest,
    callback: (error: ServiceError | null, response: GetWorkspaceResponse) => void,
  ): ClientUnaryCall;
  getWorkspace(
    request: GetWorkspaceRequest,
    metadata: Metadata,
    callback: (error: ServiceError | null, response: GetWorkspaceResponse) => void,
  ): ClientUnaryCall;
  getWorkspace(
    request: GetWorkspaceRequest,
    metadata: Metadata,
    options: Partial<CallOptions>,
    callback: (error: ServiceError | null, response: GetWorkspaceResponse) => void,
  ): ClientUnaryCall;
  /** StreamWorkspaceStatus returns workspace status once it changed. */
  streamWorkspaceStatus(
    request: StreamWorkspaceStatusRequest,
    options?: Partial<CallOptions>,
  ): ClientReadableStream<StreamWorkspaceStatusResponse>;
  streamWorkspaceStatus(
    request: StreamWorkspaceStatusRequest,
    metadata?: Metadata,
    options?: Partial<CallOptions>,
  ): ClientReadableStream<StreamWorkspaceStatusResponse>;
  /** GetOwnerToken returns an owner token. */
  getOwnerToken(
    request: GetOwnerTokenRequest,
    callback: (error: ServiceError | null, response: GetOwnerTokenResponse) => void,
  ): ClientUnaryCall;
  getOwnerToken(
    request: GetOwnerTokenRequest,
    metadata: Metadata,
    callback: (error: ServiceError | null, response: GetOwnerTokenResponse) => void,
  ): ClientUnaryCall;
  getOwnerToken(
    request: GetOwnerTokenRequest,
    metadata: Metadata,
    options: Partial<CallOptions>,
    callback: (error: ServiceError | null, response: GetOwnerTokenResponse) => void,
  ): ClientUnaryCall;
  /** CreateAndStartWorkspace creates a new workspace and starts it. */
  createAndStartWorkspace(
    request: CreateAndStartWorkspaceRequest,
    callback: (error: ServiceError | null, response: CreateAndStartWorkspaceResponse) => void,
  ): ClientUnaryCall;
  createAndStartWorkspace(
    request: CreateAndStartWorkspaceRequest,
    metadata: Metadata,
    callback: (error: ServiceError | null, response: CreateAndStartWorkspaceResponse) => void,
  ): ClientUnaryCall;
  createAndStartWorkspace(
    request: CreateAndStartWorkspaceRequest,
    metadata: Metadata,
    options: Partial<CallOptions>,
    callback: (error: ServiceError | null, response: CreateAndStartWorkspaceResponse) => void,
  ): ClientUnaryCall;
  /**
   * StopWorkspace stops a running workspace (instance).
   * Errors:
   *   NOT_FOUND:           the workspace_id is unkown
   *   FAILED_PRECONDITION: if there's no running instance
   */
  stopWorkspace(
    request: StopWorkspaceRequest,
    callback: (error: ServiceError | null, response: StopWorkspaceResponse) => void,
  ): ClientUnaryCall;
  stopWorkspace(
    request: StopWorkspaceRequest,
    metadata: Metadata,
    callback: (error: ServiceError | null, response: StopWorkspaceResponse) => void,
  ): ClientUnaryCall;
  stopWorkspace(
    request: StopWorkspaceRequest,
    metadata: Metadata,
    options: Partial<CallOptions>,
    callback: (error: ServiceError | null, response: StopWorkspaceResponse) => void,
  ): ClientUnaryCall;
  /**
   * DeleteWorkspace deletes a workspace.
   * When the workspace is running, it will be stopped as well.
   * Deleted workspaces cannot be started again.
   */
  deleteWorkspace(
    request: DeleteWorkspaceRequest,
    callback: (error: ServiceError | null, response: DeleteWorkspaceResponse) => void,
  ): ClientUnaryCall;
  deleteWorkspace(
    request: DeleteWorkspaceRequest,
    metadata: Metadata,
    callback: (error: ServiceError | null, response: DeleteWorkspaceResponse) => void,
  ): ClientUnaryCall;
  deleteWorkspace(
    request: DeleteWorkspaceRequest,
    metadata: Metadata,
    options: Partial<CallOptions>,
    callback: (error: ServiceError | null, response: DeleteWorkspaceResponse) => void,
  ): ClientUnaryCall;
  updatePort(
    request: UpdatePortRequest,
    callback: (error: ServiceError | null, response: UpdatePortResponse) => void,
  ): ClientUnaryCall;
  updatePort(
    request: UpdatePortRequest,
    metadata: Metadata,
    callback: (error: ServiceError | null, response: UpdatePortResponse) => void,
  ): ClientUnaryCall;
  updatePort(
    request: UpdatePortRequest,
    metadata: Metadata,
    options: Partial<CallOptions>,
    callback: (error: ServiceError | null, response: UpdatePortResponse) => void,
  ): ClientUnaryCall;
}

export const WorkspacesServiceClient = makeGenericClientConstructor(
  WorkspacesServiceService,
  "gitpod.experimental.v1.WorkspacesService",
) as unknown as {
  new (address: string, credentials: ChannelCredentials, options?: Partial<ChannelOptions>): WorkspacesServiceClient;
  service: typeof WorkspacesServiceService;
};

export interface DataLoaderOptions {
  cache?: boolean;
}

export interface DataLoaders {
  rpcDataLoaderOptions?: DataLoaderOptions;
  getDataLoader<T>(identifier: string, constructorFn: () => T): T;
}

declare var self: any | undefined;
declare var window: any | undefined;
declare var global: any | undefined;
var globalThis: any = (() => {
  if (typeof globalThis !== "undefined") {
    return globalThis;
  }
  if (typeof self !== "undefined") {
    return self;
  }
  if (typeof window !== "undefined") {
    return window;
  }
  if (typeof global !== "undefined") {
    return global;
  }
  throw "Unable to locate global object";
})();

type Builtin = Date | Function | Uint8Array | string | number | boolean | undefined;

export type DeepPartial<T> = T extends Builtin ? T
  : T extends Array<infer U> ? Array<DeepPartial<U>> : T extends ReadonlyArray<infer U> ? ReadonlyArray<DeepPartial<U>>
  : T extends {} ? { [K in keyof T]?: DeepPartial<T[K]> }
  : Partial<T>;

type KeysOfUnion<T> = T extends T ? keyof T : never;
export type Exact<P, I extends P> = P extends Builtin ? P
  : P & { [K in keyof P]: Exact<P[K], I[K]> } & { [K in Exclude<keyof I, KeysOfUnion<P>>]: never };

function toTimestamp(date: Date): Timestamp {
  const seconds = date.getTime() / 1_000;
  const nanos = (date.getTime() % 1_000) * 1_000_000;
  return { seconds, nanos };
}

function fromTimestamp(t: Timestamp): Date {
  let millis = t.seconds * 1_000;
  millis += t.nanos / 1_000_000;
  return new Date(millis);
}

function fromJsonTimestamp(o: any): Date {
  if (o instanceof Date) {
    return o;
  } else if (typeof o === "string") {
    return new Date(o);
  } else {
    return fromTimestamp(Timestamp.fromJSON(o));
  }
}

function longToNumber(long: Long): number {
  if (long.gt(Number.MAX_SAFE_INTEGER)) {
    throw new globalThis.Error("Value is larger than Number.MAX_SAFE_INTEGER");
  }
  return long.toNumber();
}

if (_m0.util.Long !== Long) {
  _m0.util.Long = Long as any;
  _m0.configure();
}

function isSet(value: any): boolean {
  return value !== null && value !== undefined;
}
