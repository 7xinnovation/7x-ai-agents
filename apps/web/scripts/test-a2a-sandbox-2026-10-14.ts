/**
 * The A2A task doorway and the PO Box sandbox, checked.
 *
 * Part one needs no server: the protocol module's invariants, the Agent Card
 * builder, the reply-block parser, the sandbox simulation's shapes.
 *
 * Part two drives a running deployment with an application's credentials:
 * discovery, the token endpoint, a guest question, a renewal with the signed-in
 * persona through to the payment request, the sandbox settlement, the task
 * completing by itself, the REST binding, and the error cases.
 *
 * From apps/web:
 *   npx tsx scripts/test-a2a-sandbox-2026-10-14.ts                              (part one only)
 *   npx tsx scripts/test-a2a-sandbox-2026-10-14.ts --base http://localhost:3000 --key <api key>
 *   npx tsx scripts/test-a2a-sandbox-2026-10-14.ts --base <origin> --client-id <id> --secret <secret>
 */
import { A2A_ERRORS, A2AError, isTerminal, validateInboundMessage, type AgentCard, type Task } from "@dialog/core";
import { buildAgentCard, agentEntry, CITIZEN_IDENTITY_EXTENSION } from "../lib/a2a/catalogue";
import { parseReply } from "../lib/a2a/blocks";
import { simulateNxnMockOp } from "../lib/mockPersona";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const BASE = arg("--base")?.replace(/\/$/, "");
const KEY = arg("--key");
const CLIENT_ID = arg("--client-id");
const SECRET = arg("--secret");

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, got?: unknown) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : " — got: " + JSON.stringify(got)?.slice(0, 300)}`);
  ok ? pass++ : fail++;
};

async function partOne() {
  console.log("\nThe protocol module");
  check("every A2A error has a negative code and an HTTP status", Object.values(A2A_ERRORS).every((e) => e.code < 0 && e.http >= 400));
  check("the spec's codes: TaskNotFound -32001, UnsupportedOperation -32004, VersionNotSupported -32009", A2A_ERRORS.TaskNotFoundError.code === -32001 && A2A_ERRORS.UnsupportedOperationError.code === -32004 && A2A_ERRORS.VersionNotSupportedError.code === -32009);
  const err = new A2AError("TaskNotFoundError", undefined, { taskId: "x" });
  check("an error carries a google.rpc.ErrorInfo detail with a reason", (err.details[0] as { "@type": string; reason: string })["@type"].endsWith("ErrorInfo") && (err.details[0] as { reason: string }).reason === "TASK_NOT_FOUND");
  check("terminal states are the four the spec names", ["TASK_STATE_COMPLETED", "TASK_STATE_FAILED", "TASK_STATE_CANCELED", "TASK_STATE_REJECTED"].every((s) => isTerminal(s as never)) && !isTerminal("TASK_STATE_INPUT_REQUIRED"));
  const m = validateInboundMessage({ role: "ROLE_USER", parts: [{ text: "hello" }], metadata: { a: 1 } });
  check("an inbound message without an id is given one; role is the user's", /^[0-9a-f-]{36}$/.test(m.messageId) && m.role === "ROLE_USER");
  const refuse = (raw: unknown) => {
    try {
      validateInboundMessage(raw);
      return null;
    } catch (e) {
      return (e as A2AError).name;
    }
  };
  check("no parts is InvalidParams; a file part is ContentTypeNotSupported; an agent role is refused", refuse({ parts: [] }) === "InvalidParamsError" && refuse({ parts: [{ url: "https://x" }] }) === "ContentTypeNotSupportedError" && refuse({ role: "ROLE_AGENT", parts: [{ text: "x" }] }) === "InvalidParamsError");

  console.log("\nThe Agent Card");
  const entry = agentEntry("po-box-sandbox")!;
  const card: AgentCard = buildAgentCard(entry, "https://example.gov.ae");
  check("required fields present", Boolean(card.name && card.description && card.version && card.capabilities && card.defaultInputModes.length && card.defaultOutputModes.length && card.skills.length));
  check("JSON-RPC first, HTTP+JSON second, both 1.0 on the card's origin", card.supportedInterfaces[0]!.protocolBinding === "JSONRPC" && card.supportedInterfaces[1]!.protocolBinding === "HTTP+JSON" && card.supportedInterfaces.every((i) => i.protocolVersion === "1.0" && i.url.startsWith("https://example.gov.ae/a2a/po-box-sandbox")));
  check("oauth2 client-credentials with a token URL and the tasks scope; an API key header", "oauth2SecurityScheme" in card.securitySchemes!.oauth2! && "apiKeySecurityScheme" in card.securitySchemes!.apiKey! && (card.securitySchemes!.oauth2 as { oauth2SecurityScheme: { flows: { clientCredentials: { tokenUrl: string; scopes: Record<string, string> } } } }).oauth2SecurityScheme.flows.clientCredentials.tokenUrl === "https://example.gov.ae/a2a/oauth/token");
  check("streaming yes, push notifications no, the citizen-identity extension declared with the personas", card.capabilities.streaming === true && card.capabilities.pushNotifications === false && card.capabilities.extensions!.some((e) => e.uri === CITIZEN_IDENTITY_EXTENSION && Array.isArray((e.params as { personas: unknown[] }).personas)));
  check("four skills, each with id, name, description and tags", card.skills.length === 4 && card.skills.every((s) => s.id && s.name && s.description && s.tags.length));

  console.log("\nThe reply blocks");
  const reply = parseReply(
    "Here is your renewal.\n\n```summary\ntitle: Renewal summary\n- Box: 50500\n- Term: 1 year\ntotal: AED 695.00\n```\n\n```pay\nurl: https://pay.example/x\namount: AED 695.00\nlabel: Pay AED 695 with Card\n```\n\n```buttons\n- Pay with Noqodi instead\n- Change the term\n```\nPaying accepts the terms."
  );
  check("three blocks: summary, pay, buttons", reply.blocks.map((b) => b.type).join(",") === "summary,pay,buttons", reply.blocks.map((b) => b.type));
  check("the pay block keeps url, amount and label", reply.blocks.some((b) => b.type === "pay" && b.url === "https://pay.example/x" && b.amount === "AED 695.00" && b.label === "Pay AED 695 with Card"));
  check("the text keeps a readable line for each block and the prose around them", /Here is your renewal/.test(reply.text) && /Pay AED 695 with Card: https:\/\/pay.example\/x/.test(reply.text) && /Options: Pay with Noqodi instead · Change the term/.test(reply.text) && /Paying accepts the terms/.test(reply.text) && !/```/.test(reply.text), reply.text);
  const toggles = parseReply("```toggles\ntitle: Before payment\nstyle: checkbox\n- terms_accepted: I accept the [Terms](https://x)\nconfirm: Pay AED 300 with Card | Pay with Noqodi\n```");
  const tg = toggles.blocks[0];
  check("toggles: items, two confirm labels, a reply recipe without markdown links", tg?.type === "toggles" && tg.items[0]!.label === "I accept the Terms" && tg.confirm.length === 2 && /I accept the Terms: Yes/.test(tg.reply));

  console.log("\nThe payable simulation (no database: shapes only)");
  const legacy = await simulateNxnMockOp("nxnstaging__post_api_Rental_Select", { body: { bundleId: "IN" } });
  check("without a context, Rental/Select is NOT simulated (the demo persona is unchanged)", legacy === null);
  const sel = await simulateNxnMockOp("nxnstaging__post_api_Rental_Select", { body: { bundleId: "IN", uniqueBoxID: "2450063", poBoxExpiryDate: new Date(Date.now() + 366 * 864e5).toISOString() } }, { payable: true, rentFor: () => 300 });
  const selBody = JSON.parse(sel!.raw!);
  check("with a context, Select returns a hold in Emirates Post's shape", selBody.payload.subscriptionReferenceNumber.startsWith("SBXHOLD-") && selBody.payload.minimumAmount === 370 && Array.isArray(selBody.payload.priceDetails) && selBody.payload.subcsriptionReferenceNumberExpiryDate, selBody);
  check("...with RENT from the live price book, NEW-REG, an inclusive and an additional AGENT line, KEY-DELIVERY", ["RENT", "NEW-REG", "AGENT", "KEY-DELIVERY"].every((t) => selBody.payload.priceDetails.some((d: { serviceType: string }) => d.serviceType === t)) && selBody.payload.priceDetails.find((d: { serviceType: string; serviceCriteria: string }) => d.serviceType === "AGENT" && d.serviceCriteria === "I"));
  const save = await simulateNxnMockOp("nxnstaging__post_api_Rental_Save", { body: { totalAmount: 370 } }, { payable: true });
  const saveBody = JSON.parse(save!.raw!);
  check("Save (no conversation) still returns an order with a reference and a mock-checkout URL", saveBody.payload.orderNo.startsWith("SBX") && /^SBX-/.test(saveBody.payload.paymentGateWayResponse.referenceNumber) && /\/api\/payments\/mock-checkout\?ref=SBX-/.test(saveBody.payload.paymentGateWayResponse.paymentUrl), saveBody);
  const confirm = await simulateNxnMockOp("nxnstaging__post_api_Rental_UpdatePayment_paymentReferenceNo", { paymentReferenceNo: saveBody.payload.paymentGateWayResponse.referenceNumber }, { payable: true });
  const confirmBody = JSON.parse(confirm!.raw!);
  check("the confirm answers NOT paid for an order nobody has paid", confirmBody.payload.isPaymentSuccess === false, confirmBody);
  const free = await simulateNxnMockOp("nxnstaging__get_api_Rental_FreeBoxes", { BundleId: "IN", LocationId: "244" }, { payable: true });
  check("FreeBoxes is simulated as before", Boolean(free && JSON.parse(free.raw!).availableBoxNumbers.length === 12));
}

// ─── Part two: a running deployment ─────────────────────────────────────────

type Rpc = { jsonrpc: "2.0"; id: number; result?: unknown; error?: { code: number; message: string } };

async function partTwo() {
  if (!BASE) {
    console.log("\n(no --base: the live checks were skipped)");
    return;
  }
  console.log(`\nLive: ${BASE}`);
  const AGENT = "po-box-sandbox";
  let rpcId = 0;
  let bearer = "";

  const card = (await (await fetch(`${BASE}/.well-known/agent-card.json`)).json()) as AgentCard;
  check("the well-known card names this origin's JSON-RPC endpoint", card.supportedInterfaces?.[0]?.url === `${BASE}/a2a/${AGENT}`, card.supportedInterfaces);
  const own = await fetch(`${BASE}/a2a/${AGENT}/agent-card.json`);
  check("the agent's own card is served with a cache header", own.ok && /max-age/.test(own.headers.get("cache-control") ?? ""));

  if (CLIENT_ID && SECRET) {
    const tok = await fetch(`${BASE}/a2a/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", authorization: "Basic " + Buffer.from(`${CLIENT_ID}:${SECRET}`).toString("base64") },
      body: "grant_type=client_credentials&scope=tasks",
    });
    const t = (await tok.json()) as { access_token?: string; token_type?: string; expires_in?: number; error?: string };
    check("client credentials → a one-hour Bearer token", tok.status === 200 && t.token_type === "Bearer" && t.expires_in === 3600 && Boolean(t.access_token), t);
    bearer = t.access_token ?? "";
    const bad = await fetch(`${BASE}/a2a/oauth/token`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ grant_type: "client_credentials", client_id: CLIENT_ID, client_secret: "wrong" }) });
    check("a wrong secret is invalid_client, 401", bad.status === 401 && ((await bad.json()) as { error: string }).error === "invalid_client");
  } else if (KEY) {
    bearer = KEY;
  } else {
    console.log("(no --key or --client-id/--secret: the authenticated checks were skipped)");
    return;
  }
  const auth = { authorization: `Bearer ${bearer}`, "content-type": "application/json", "a2a-version": "1.0" };
  const rpc = async (method: string, params?: unknown, headers: Record<string, string> = auth) => {
    const res = await fetch(`${BASE}/a2a/${AGENT}`, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }) });
    return { status: res.status, body: (await res.json()) as Rpc };
  };
  const send = async (text: string, extra: Record<string, unknown> = {}, metadata?: Record<string, unknown>) => {
    const r = await rpc("SendMessage", { message: { role: "ROLE_USER", parts: [{ text }], ...extra, ...(metadata ? { metadata } : {}) } });
    return { status: r.status, error: r.body.error, task: (r.body.result as { task?: Task } | undefined)?.task };
  };

  const noAuth = await rpc("GetTask", { id: "x" }, { "content-type": "application/json" });
  check("no credentials → HTTP 401 and the A2A unauthenticated code", noAuth.status === 401 && noAuth.body.error?.code === A2A_ERRORS.UnauthenticatedError.code, noAuth.body);
  const unknown = await rpc("DoSomething", {});
  check("an unknown method → -32601", unknown.body.error?.code === -32601, unknown.body);
  const missing = await rpc("GetTask", { id: "00000000-0000-4000-8000-000000000000" });
  check("an unknown task → -32001 TaskNotFound", missing.body.error?.code === -32001, missing.body);
  const push = await rpc("CreateTaskPushNotificationConfig", { taskId: "x", url: "https://x" });
  check("push notifications → -32003", push.body.error?.code === -32003, push.body);
  const badVersion = await rpc("ListTasks", {}, { ...auth, "a2a-version": "9.9" });
  check("an unsupported A2A-Version → -32009", badVersion.body.error?.code === -32009, badVersion.body);

  console.log("\nA guest question");
  const q = await send("How much does a personal PO Box cost in Dubai, and which bundles are there?", {}, { [CITIZEN_IDENTITY_EXTENSION]: { persona: "guest" } });
  check("the task comes back INPUT_REQUIRED with a contextId and an agent message", q.task?.status.state === "TASK_STATE_INPUT_REQUIRED" && Boolean(q.task?.contextId) && q.task?.status.message?.role === "ROLE_AGENT", q.error ?? q.task?.status);
  const qText = q.task?.status.message?.parts.find((p) => p.text)?.text ?? "";
  const qData = q.task?.status.message?.parts.find((p) => p.data)?.data as Record<string, unknown> | undefined;
  check("...the reply has text and a dialog-reply data part with blocks, case and awaiting", qText.length > 20 && Array.isArray(qData?.blocks) && qData?.case !== undefined && qData?.awaiting === "input", { qText: qText.slice(0, 120), qData });
  check("...history holds the user message and the agent's", (q.task?.history?.length ?? 0) === 2 && q.task!.history![0]!.role === "ROLE_USER" && q.task!.history![1]!.role === "ROLE_AGENT");
  const got = await rpc("GetTask", { id: q.task!.id, historyLength: 1 });
  check("GetTask with historyLength 1 returns the task with one message", (got.body.result as Task).id === q.task!.id && (got.body.result as Task).history?.length === 1, got.body);

  console.log("\nA signed-in renewal, through to the payment");
  const r1 = await send("Renew my PO Box 50500 in Dubai for one more year, same bundle and options.", {}, { [CITIZEN_IDENTITY_EXTENSION]: { persona: "ahmed-al-mansoori" }, locale: "en" });
  check("the renewal task exists and is not failed", Boolean(r1.task) && r1.task!.status.state !== "TASK_STATE_FAILED", r1.error ?? r1.task?.status.message?.parts?.[0]);
  let task = r1.task!;
  let pay = task.artifacts?.find((a) => a.name === "payment-request");
  // The one-tap renewal usually saves and offers payment in the first reply; a
  // clarifying question first is allowed — answer it once.
  if (!pay && task.status.state === "TASK_STATE_INPUT_REQUIRED") {
    const r2 = await send("Yes, one year, same bundle, pay with card.", { taskId: task.id, contextId: task.contextId });
    task = r2.task ?? task;
    pay = task.artifacts?.find((a) => a.name === "payment-request");
  }
  const payData = pay?.parts[0]?.data as { reference?: string; url?: string; amount?: number; sandbox?: { settleUrl?: string } } | undefined;
  check("a payment-request artifact with a sandbox reference, an absolute checkout URL and a settle URL", Boolean(payData?.reference?.startsWith("SBX-")) && /^https?:\/\/.+mock-checkout/.test(payData?.url ?? "") && Boolean(payData?.sandbox?.settleUrl), { state: task.status.state, text: task.status.message?.parts?.[0]?.text?.slice(0, 300), artifacts: task.artifacts?.map((a) => a.name) });
  check("...the task waits for the payment", task.status.state === "TASK_STATE_INPUT_REQUIRED" && (task.metadata as { awaiting?: string })?.awaiting === "payment", task.metadata);

  if (payData?.sandbox?.settleUrl) {
    const settle = await fetch(payData.sandbox.settleUrl, { method: "POST", headers: auth, body: JSON.stringify({ outcome: "paid" }) });
    const settled = (await settle.json()) as { ok?: boolean; reference?: string };
    check("settling the sandbox payment answers ok", settle.status === 200 && settled.ok === true && settled.reference === payData.reference, settled);
    // The task continues by itself; give the engine up to 90 seconds.
    const deadline = Date.now() + 90_000;
    let final: Task | null = null;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3000));
      const g = await rpc("GetTask", { id: task.id });
      const t = g.body.result as Task | undefined;
      if (t && t.status.state !== "TASK_STATE_WORKING" && t.status.state !== "TASK_STATE_INPUT_REQUIRED") {
        final = t;
        break;
      }
      if (t && t.status.state === "TASK_STATE_INPUT_REQUIRED" && (t.metadata as { awaiting?: string })?.awaiting !== "payment") {
        final = t;
        break;
      }
    }
    check("after settlement the task completes by itself", final?.status.state === "TASK_STATE_COMPLETED", { state: final?.status.state, awaiting: (final?.metadata as { awaiting?: string })?.awaiting, text: final?.status.message?.parts?.[0]?.text?.slice(0, 300) });
    const outcome = final?.artifacts?.find((a) => a.name === "service-outcome");
    check("...with a service-outcome artifact carrying a reference and the payment as paid", Boolean(outcome) && (outcome!.parts[0]!.data as { reference?: string; payment?: { status?: string } }).payment?.status === "paid", outcome?.parts[0]?.data);
    const again = await send("thanks", { taskId: task.id });
    check("a message to a completed task → -32004 UnsupportedOperation", again.error?.code === -32004, again.error);
  }

  console.log("\nListing, cancelling, the REST binding");
  const list = await rpc("ListTasks", { pageSize: 5 });
  const listed = list.body.result as { tasks: Task[]; nextPageToken: string; totalSize: number };
  check("ListTasks: newest first, nextPageToken present, totalSize counted, artifacts omitted by default", Array.isArray(listed.tasks) && typeof listed.nextPageToken === "string" && listed.totalSize >= 2 && listed.tasks.every((t) => t.artifacts === undefined), listed);
  const fresh = await send("I want to rent a new PO Box", {}, { [CITIZEN_IDENTITY_EXTENSION]: { persona: "guest" } });
  check("a guest asking to rent is told to sign in: TASK_STATE_AUTH_REQUIRED", fresh.task?.status.state === "TASK_STATE_AUTH_REQUIRED" && (fresh.task?.metadata as { awaiting?: string })?.awaiting === "auth", { state: fresh.task?.status.state, text: fresh.task?.status.message?.parts?.[0]?.text?.slice(0, 200) });
  if (fresh.task) {
    const cancelled = await rpc("CancelTask", { id: fresh.task.id });
    check("CancelTask → TASK_STATE_CANCELED", (cancelled.body.result as Task)?.status.state === "TASK_STATE_CANCELED", cancelled.body);
    const twice = await rpc("CancelTask", { id: fresh.task.id });
    check("cancelling again → -32002 TaskNotCancelable", twice.body.error?.code === -32002, twice.body);
  }
  const rest = await fetch(`${BASE}/a2a/${AGENT}/rest/tasks/${q.task!.id}`, { headers: auth });
  check("REST GET /rest/tasks/{id} returns the same task", rest.status === 200 && ((await rest.json()) as Task).id === q.task!.id);
  const restMissing = await fetch(`${BASE}/a2a/${AGENT}/rest/tasks/00000000-0000-4000-8000-000000000000`, { headers: auth });
  check("REST unknown task → HTTP 404 with an error body", restMissing.status === 404 && Boolean(((await restMissing.json()) as { error: unknown }).error));

  console.log("\nStreaming");
  const stream = await fetch(`${BASE}/a2a/${AGENT}`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ jsonrpc: "2.0", id: 99, method: "SendStreamingMessage", params: { message: { role: "ROLE_USER", parts: [{ text: "Which emirates can I rent a PO Box in?" }], metadata: { [CITIZEN_IDENTITY_EXTENSION]: { persona: "guest" } } } } }),
  });
  const frames = (await stream.text()).split("\n\n").filter((f) => f.startsWith("data: ")).map((f) => JSON.parse(f.slice(6)) as Rpc);
  const kinds = frames.map((f) => Object.keys((f.result ?? {}) as object)[0]);
  check("SSE: a task first, status updates after, the last one not WORKING", stream.headers.get("content-type")?.includes("text/event-stream") === true && kinds[0] === "task" && kinds.slice(1).every((k) => k === "statusUpdate" || k === "artifactUpdate") && ((frames.at(-1)?.result as { statusUpdate?: { status: { state: string } } })?.statusUpdate?.status.state ?? "") !== "TASK_STATE_WORKING", kinds);
}

async function main() {
  await partOne();
  await partTwo();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
