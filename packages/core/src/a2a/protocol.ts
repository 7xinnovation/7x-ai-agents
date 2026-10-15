/**
 * A2A protocol 1.0 — the wire shapes, as the specification's proto defines
 * them (specification/a2a.proto, JSON per ProtoJSON: camelCase fields, enums
 * as their SCREAMING_SNAKE names, timestamps as ISO 8601 in UTC).
 *
 * Nothing in here knows about Dialog. It is the vocabulary an A2A client and
 * server share: Agent Card, Task, Message, Part, Artifact, the streaming
 * events, and the JSON-RPC envelope with the A2A error codes.
 */

export const A2A_PROTOCOL_VERSION = "1.0";

// ─── Enums ───────────────────────────────────────────────────────────────────

export type TaskState =
  | "TASK_STATE_UNSPECIFIED"
  | "TASK_STATE_SUBMITTED"
  | "TASK_STATE_WORKING"
  | "TASK_STATE_COMPLETED"
  | "TASK_STATE_FAILED"
  | "TASK_STATE_CANCELED"
  | "TASK_STATE_INPUT_REQUIRED"
  | "TASK_STATE_REJECTED"
  | "TASK_STATE_AUTH_REQUIRED";

export const TERMINAL_STATES: ReadonlySet<TaskState> = new Set<TaskState>([
  "TASK_STATE_COMPLETED",
  "TASK_STATE_FAILED",
  "TASK_STATE_CANCELED",
  "TASK_STATE_REJECTED",
]);

/** Interrupted states: the task is waiting on the client, not finished. */
export const INTERRUPTED_STATES: ReadonlySet<TaskState> = new Set<TaskState>([
  "TASK_STATE_INPUT_REQUIRED",
  "TASK_STATE_AUTH_REQUIRED",
]);

export const isTerminal = (s: TaskState): boolean => TERMINAL_STATES.has(s);
export const isInterrupted = (s: TaskState): boolean => INTERRUPTED_STATES.has(s);

export type Role = "ROLE_UNSPECIFIED" | "ROLE_USER" | "ROLE_AGENT";

// ─── Core objects ────────────────────────────────────────────────────────────

/** Exactly one of text / raw / url / data is set. */
export type Part = {
  text?: string;
  /** base64 (ProtoJSON bytes). */
  raw?: string;
  url?: string;
  data?: unknown;
  metadata?: Record<string, unknown>;
  filename?: string;
  mediaType?: string;
};

export type Message = {
  messageId: string;
  contextId?: string;
  taskId?: string;
  role: Role;
  parts: Part[];
  metadata?: Record<string, unknown>;
  extensions?: string[];
  referenceTaskIds?: string[];
};

export type Artifact = {
  artifactId: string;
  name?: string;
  description?: string;
  parts: Part[];
  metadata?: Record<string, unknown>;
  extensions?: string[];
};

export type TaskStatus = {
  state: TaskState;
  message?: Message;
  /** ISO 8601, UTC, millisecond precision. */
  timestamp?: string;
};

export type Task = {
  id: string;
  contextId: string;
  status: TaskStatus;
  artifacts?: Artifact[];
  history?: Message[];
  metadata?: Record<string, unknown>;
};

// ─── Streaming events ────────────────────────────────────────────────────────

export type TaskStatusUpdateEvent = {
  taskId: string;
  contextId: string;
  status: TaskStatus;
  metadata?: Record<string, unknown>;
};

export type TaskArtifactUpdateEvent = {
  taskId: string;
  contextId: string;
  artifact: Artifact;
  append?: boolean;
  lastChunk?: boolean;
  metadata?: Record<string, unknown>;
};

/** Exactly one field is set. */
export type StreamResponse =
  | { task: Task }
  | { message: Message }
  | { statusUpdate: TaskStatusUpdateEvent }
  | { artifactUpdate: TaskArtifactUpdateEvent };

// ─── Operation parameters ────────────────────────────────────────────────────

export type TaskPushNotificationConfig = {
  tenant?: string;
  id?: string;
  taskId?: string;
  url: string;
  token?: string;
  authentication?: { scheme: string; credentials?: string };
};

export type SendMessageConfiguration = {
  acceptedOutputModes?: string[];
  taskPushNotificationConfig?: TaskPushNotificationConfig;
  historyLength?: number;
  returnImmediately?: boolean;
};

export type SendMessageRequest = {
  tenant?: string;
  message: Message;
  configuration?: SendMessageConfiguration;
  metadata?: Record<string, unknown>;
};

export type SendMessageResponse = { task: Task } | { message: Message };

export type GetTaskRequest = { tenant?: string; id: string; historyLength?: number };

export type ListTasksRequest = {
  tenant?: string;
  contextId?: string;
  status?: TaskState;
  pageSize?: number;
  pageToken?: string;
  historyLength?: number;
  statusTimestampAfter?: string;
  includeArtifacts?: boolean;
};

export type ListTasksResponse = {
  tasks: Task[];
  /** Empty string on the last page — the spec requires the field. */
  nextPageToken: string;
  pageSize: number;
  totalSize: number;
};

export type CancelTaskRequest = { tenant?: string; id: string; metadata?: Record<string, unknown> };
export type SubscribeToTaskRequest = { tenant?: string; id: string };

// ─── Agent Card ──────────────────────────────────────────────────────────────

export type AgentInterface = {
  url: string;
  /** "JSONRPC" | "GRPC" | "HTTP+JSON" | a URI for a custom binding. */
  protocolBinding: string;
  tenant?: string;
  protocolVersion: string;
};

export type AgentProvider = { url: string; organization: string };

export type AgentExtension = {
  uri: string;
  description?: string;
  required?: boolean;
  params?: Record<string, unknown>;
};

export type AgentCapabilities = {
  streaming?: boolean;
  pushNotifications?: boolean;
  extensions?: AgentExtension[];
  extendedAgentCard?: boolean;
};

export type SecurityRequirement = { schemes: Record<string, { list: string[] }> };

export type AgentSkill = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
  securityRequirements?: SecurityRequirement[];
};

/** Exactly one scheme field is set. */
export type SecurityScheme =
  | { apiKeySecurityScheme: { description?: string; location: "header" | "query" | "cookie"; name: string } }
  | { httpAuthSecurityScheme: { description?: string; scheme: string; bearerFormat?: string } }
  | {
      oauth2SecurityScheme: {
        description?: string;
        flows: {
          clientCredentials?: { tokenUrl: string; refreshUrl?: string; scopes: Record<string, string> };
          authorizationCode?: {
            authorizationUrl: string;
            tokenUrl: string;
            refreshUrl?: string;
            scopes: Record<string, string>;
            pkceRequired?: boolean;
          };
        };
      };
    }
  | { openIdConnectSecurityScheme: { description?: string; openIdConnectUrl: string } }
  | { mtlsSecurityScheme: { description?: string } };

export type AgentCardSignature = { protected: string; signature: string; header?: Record<string, unknown> };

export type AgentCard = {
  name: string;
  description: string;
  supportedInterfaces: AgentInterface[];
  provider?: AgentProvider;
  version: string;
  documentationUrl?: string;
  capabilities: AgentCapabilities;
  securitySchemes?: Record<string, SecurityScheme>;
  securityRequirements?: SecurityRequirement[];
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: AgentSkill[];
  signatures?: AgentCardSignature[];
  iconUrl?: string;
};

export const AGENT_CARD_WELL_KNOWN_PATH = "/.well-known/agent-card.json";

// ─── JSON-RPC 2.0 envelope ───────────────────────────────────────────────────

export type JsonRpcId = string | number | null;

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: unknown;
};

export type JsonRpcError = { code: number; message: string; data?: unknown[] };

export type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: JsonRpcId; result: unknown }
  | { jsonrpc: "2.0"; id: JsonRpcId; error: JsonRpcError };

/** Section 5.3 — PascalCase, matching the gRPC service. */
export const JSONRPC_METHODS = [
  "SendMessage",
  "SendStreamingMessage",
  "GetTask",
  "ListTasks",
  "CancelTask",
  "SubscribeToTask",
  "CreateTaskPushNotificationConfig",
  "GetTaskPushNotificationConfig",
  "ListTaskPushNotificationConfigs",
  "DeleteTaskPushNotificationConfig",
  "GetExtendedAgentCard",
] as const;
export type JsonRpcMethod = (typeof JSONRPC_METHODS)[number];

/** Section 5.4 — the A2A error types and their JSON-RPC codes / HTTP statuses. */
export const A2A_ERRORS = {
  // JSON-RPC standard
  JSONParseError: { code: -32700, http: 400, message: "Invalid JSON payload" },
  InvalidRequestError: { code: -32600, http: 400, message: "Request payload validation error" },
  MethodNotFoundError: { code: -32601, http: 404, message: "Method not found" },
  InvalidParamsError: { code: -32602, http: 400, message: "Invalid parameters" },
  InternalError: { code: -32603, http: 500, message: "Internal error" },
  // A2A-specific
  TaskNotFoundError: { code: -32001, http: 404, message: "Task not found" },
  TaskNotCancelableError: { code: -32002, http: 400, message: "Task cannot be canceled" },
  PushNotificationNotSupportedError: { code: -32003, http: 400, message: "Push notifications are not supported" },
  UnsupportedOperationError: { code: -32004, http: 400, message: "This operation is not supported" },
  ContentTypeNotSupportedError: { code: -32005, http: 400, message: "Incompatible content types" },
  InvalidAgentResponseError: { code: -32006, http: 500, message: "Invalid agent response" },
  ExtendedAgentCardNotConfiguredError: { code: -32007, http: 400, message: "Extended agent card not configured" },
  ExtensionSupportRequiredError: { code: -32008, http: 400, message: "A required extension was not declared" },
  VersionNotSupportedError: { code: -32009, http: 400, message: "A2A protocol version not supported" },
  // Authentication and authorization have no reserved A2A code; these sit in
  // the implementation range the spec leaves open (-32010 .. -32099).
  UnauthenticatedError: { code: -32010, http: 401, message: "Authentication required" },
  PermissionDeniedError: { code: -32011, http: 403, message: "Permission denied" },
  RateLimitedError: { code: -32012, http: 429, message: "Too many requests" },
} as const;

export type A2AErrorName = keyof typeof A2A_ERRORS;

/** An error the handlers throw; the binding turns it into JSON-RPC or HTTP. */
export class A2AError extends Error {
  readonly name: A2AErrorName;
  readonly code: number;
  readonly http: number;
  readonly details: unknown[];
  constructor(name: A2AErrorName, detail?: string, extra?: Record<string, unknown>) {
    const def = A2A_ERRORS[name];
    super(detail ? `${def.message}: ${detail}` : def.message);
    this.name = name;
    this.code = def.code;
    this.http = def.http;
    this.details = [
      {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        reason: name.replace(/Error$/, "").replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase(),
        domain: "a2a-protocol.org",
        metadata: { ...(extra ?? {}), timestamp: nowIso() },
      },
    ];
  }
  toJsonRpc(): JsonRpcError {
    return { code: this.code, message: this.message, data: this.details };
  }
}

export const nowIso = (): string => new Date().toISOString();

/** A messageId / taskId / artifactId: a UUID, which every client can parse. */
export const newId = (): string => crypto.randomUUID();

// ─── Small constructors ──────────────────────────────────────────────────────

export const textPart = (text: string): Part => ({ text });
export const dataPart = (data: unknown, mediaType = "application/json"): Part => ({ data, mediaType });

export function agentMessage(parts: Part[], ids: { contextId: string; taskId: string }, metadata?: Record<string, unknown>): Message {
  return { messageId: newId(), role: "ROLE_AGENT", parts, contextId: ids.contextId, taskId: ids.taskId, ...(metadata ? { metadata } : {}) };
}

export function status(state: TaskState, message?: Message): TaskStatus {
  return { state, ...(message ? { message } : {}), timestamp: nowIso() };
}

/** The plain text of a message: its text parts joined, nothing else. */
export function messageText(m: Message | undefined): string {
  if (!m) return "";
  return m.parts
    .map((p) => (typeof p.text === "string" ? p.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

/** The first data part of a message, if any. */
export function messageData(m: Message | undefined): unknown {
  return m?.parts.find((p) => p.data !== undefined)?.data;
}

/** Trim a task's history to `historyLength` (spec 3.2.4): 0 omits it, >0 keeps the most recent. */
export function withHistory(task: Task, historyLength: number | undefined): Task {
  if (historyLength === undefined || historyLength === null) return task;
  if (historyLength <= 0) {
    const { history: _h, ...rest } = task;
    return rest;
  }
  return { ...task, history: (task.history ?? []).slice(-historyLength) };
}

// ─── Validation of inbound messages (lenient on unknown fields, strict on the required ones) ──

export function validateInboundMessage(raw: unknown): Message {
  if (!raw || typeof raw !== "object") throw new A2AError("InvalidParamsError", "message must be an object");
  const m = raw as Record<string, unknown>;
  if (m.role !== undefined && m.role !== "ROLE_USER")
    throw new A2AError("InvalidParamsError", 'message.role must be "ROLE_USER"');
  if (!Array.isArray(m.parts) || m.parts.length === 0)
    throw new A2AError("InvalidParamsError", "message.parts must contain at least one part");
  const parts: Part[] = m.parts.map((p, i) => {
    if (!p || typeof p !== "object") throw new A2AError("InvalidParamsError", `message.parts[${i}] must be an object`);
    const part = p as Record<string, unknown>;
    const kinds = ["text", "raw", "url", "data"].filter((k) => part[k] !== undefined);
    if (kinds.length !== 1)
      throw new A2AError("InvalidParamsError", `message.parts[${i}] must set exactly one of text, raw, url, data`);
    if (part.text !== undefined && typeof part.text !== "string")
      throw new A2AError("InvalidParamsError", `message.parts[${i}].text must be a string`);
    if (part.url !== undefined || part.raw !== undefined)
      throw new A2AError("ContentTypeNotSupportedError", `message.parts[${i}]: file parts are not accepted by this agent; send text or data`);
    return part as Part;
  });
  for (const k of ["messageId", "contextId", "taskId"] as const) {
    if (m[k] !== undefined && (typeof m[k] !== "string" || (m[k] as string).length > 200))
      throw new A2AError("InvalidParamsError", `message.${k} must be a string`);
  }
  return {
    messageId: typeof m.messageId === "string" && m.messageId ? m.messageId : newId(),
    role: "ROLE_USER",
    parts,
    ...(typeof m.contextId === "string" && m.contextId ? { contextId: m.contextId } : {}),
    ...(typeof m.taskId === "string" && m.taskId ? { taskId: m.taskId } : {}),
    ...(m.metadata && typeof m.metadata === "object" ? { metadata: m.metadata as Record<string, unknown> } : {}),
    ...(Array.isArray(m.extensions) ? { extensions: m.extensions.filter((e) => typeof e === "string") as string[] } : {}),
    ...(Array.isArray(m.referenceTaskIds) ? { referenceTaskIds: m.referenceTaskIds.filter((e) => typeof e === "string") as string[] } : {}),
  };
}

/** SSE framing for a StreamResponse inside a JSON-RPC result (section 9.4.2). */
export function sseJsonRpc(id: JsonRpcId, result: StreamResponse): string {
  return `data: ${JSON.stringify({ jsonrpc: "2.0", id, result })}\n\n`;
}

/** SSE framing for the HTTP+JSON binding (section 11.7). */
export function sseRest(result: StreamResponse): string {
  return `data: ${JSON.stringify(result)}\n\n`;
}
