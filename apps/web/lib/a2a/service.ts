/**
 * The operations, independent of binding. The JSON-RPC route and the REST route
 * both call `handle`; streaming operations hand back an async iterator of
 * StreamResponse objects for the binding to frame.
 */
import { A2AError, type JsonRpcMethod, type ListTasksRequest, type SendMessageRequest, type StreamResponse } from "@dialog/core";
import { buildAgentCard } from "./catalogue";
import { cancelTask, getTask, listTasks, sendMessage, subscribeToTask, type A2AContext } from "./tasks";

export type Operation = JsonRpcMethod;

export const STREAMING_OPERATIONS: ReadonlySet<string> = new Set(["SendStreamingMessage", "SubscribeToTask"]);

/** A unary operation's result. */
export async function handleUnary(ctx: A2AContext, method: string, params: unknown): Promise<unknown> {
  switch (method) {
    case "SendMessage":
      return { task: await sendMessage(ctx, params as SendMessageRequest) };
    case "GetTask":
      return getTask(ctx, (params ?? {}) as { id: string; historyLength?: number });
    case "ListTasks":
      return listTasks(ctx, (params ?? {}) as ListTasksRequest);
    case "CancelTask":
      return cancelTask(ctx, (params ?? {}) as { id: string });
    case "GetExtendedAgentCard":
      // Declared false in the card; the public card is the whole card.
      throw new A2AError("UnsupportedOperationError", "this agent has no extended Agent Card; the public card is complete");
    case "CreateTaskPushNotificationConfig":
    case "GetTaskPushNotificationConfig":
    case "ListTaskPushNotificationConfigs":
    case "DeleteTaskPushNotificationConfig":
      throw new A2AError("PushNotificationNotSupportedError", "use SendStreamingMessage, SubscribeToTask or GetTask polling");
    case "SendStreamingMessage":
    case "SubscribeToTask":
      throw new A2AError("InvalidRequestError", `${method} is a streaming operation; this endpoint answers it with text/event-stream`);
    default:
      throw new A2AError("MethodNotFoundError", `unknown method "${method}"`);
  }
}

/** A streaming operation's events. */
export function handleStream(ctx: A2AContext, method: string, params: unknown): AsyncGenerator<StreamResponse> {
  if (method === "SubscribeToTask") return subscribeToTask(ctx, (params ?? {}) as { id: string });
  if (method === "SendStreamingMessage") return streamSend(ctx, params as SendMessageRequest);
  throw new A2AError("MethodNotFoundError", `unknown streaming method "${method}"`);
}

async function* streamSend(ctx: A2AContext, params: SendMessageRequest): AsyncGenerator<StreamResponse> {
  const queue: StreamResponse[] = [];
  let wake: (() => void) | null = null;
  let finished = false;
  let failure: unknown = null;
  const done = sendMessage(ctx, params, {
    onEvent: (ev) => {
      queue.push(ev);
      wake?.();
    },
  })
    .catch((e) => {
      failure = e;
    })
    .finally(() => {
      finished = true;
      wake?.();
    });
  for (;;) {
    while (queue.length) yield queue.shift()!;
    if (finished) break;
    await new Promise<void>((resolve) => {
      wake = resolve;
    });
    wake = null;
  }
  await done;
  if (failure) throw failure;
}

export { buildAgentCard };
