import type { Metadata } from "next";
import Link from "next/link";
import { DocsToc, type DocsSection } from "@/components/developers/DocsToc";
import { DocsCode, DocsHost } from "@/components/developers/DocsCode";
import * as S from "./samples";

export const metadata: Metadata = {
  title: "Documentation",
  description: "How to reach the Emirates Post PO Box sandbox agent over the A2A protocol: credentials, tasks, replies, citizen identity, payments, streaming and errors.",
};

const SECTIONS: DocsSection[] = [
  { id: "overview", title: "Overview" },
  { id: "quickstart", title: "Quickstart" },
  { id: "authentication", title: "Authentication" },
  { id: "discovery", title: "Discovery: the Agent Card" },
  { id: "tasks", title: "Tasks and conversations" },
  { id: "sending", title: "Sending messages" },
  { id: "reply", title: "Reading a reply" },
  { id: "identity", title: "Citizen identity" },
  { id: "payments", title: "Payments in the sandbox" },
  { id: "artifacts", title: "Artifacts" },
  { id: "streaming", title: "Streaming" },
  { id: "journeys", title: "Journeys" },
  { id: "rest", title: "REST binding" },
  { id: "errors", title: "Errors" },
  { id: "limits", title: "Limits and conduct" },
  { id: "changelog", title: "Changelog" },
];

const IDENTITY = S.IDENTITY_URI;
const REPLY = S.REPLY_URI;

/**
 * The documentation: one page, sixteen sections, a sticky table of contents.
 * Public. The samples are server-rendered with a host placeholder that the
 * browser replaces with the origin the reader is on.
 */
export default function DocsPage() {
  return (
    <div className="grid gap-8 lg:grid-cols-[232px_minmax(0,1fr)] lg:gap-12">
      <DocsToc sections={SECTIONS} />

      <article className="dev-prose min-w-0">
        <p className="mb-2 text-[13px] text-muted">Reference, last updated 15 October 2026</p>
        <h1>Emirates Post PO Box Agent over A2A</h1>
        <p className="text-[16.5px] text-ink-2">
          This is the reference for integrating with the sandbox of the Emirates Post PO Box agent through the Agent-to-Agent protocol (A2A, Linux Foundation, version 1.0). It covers what
          the doorway accepts, what it returns, and what is real behind it.
        </p>

        {/* 1 ───────────────────────────────────────────────────────────── */}
        <Section id="overview" title="Overview">
          <p>
            Dialog is 7X&rsquo;s platform for conversational government services. One of its agents, the Emirates Post PO Box agent, rents, renews and manages PO Boxes in a conversation. The
            sandbox described here exposes that agent to an external system over A2A: your application sends the customer&rsquo;s words as messages, the agent answers with text and
            structured blocks, and the service request moves through a task until it is done.
          </p>
          <p>
            The doorway does not run a separate model. Every message becomes a turn of the same engine the chat widget uses, with the same journeys, tools and guards. What you exercise
            is what a customer gets.
          </p>
          <h3>What is real and what is simulated</h3>
          <table>
            <thead>
              <tr>
                <th>Real (Emirates Post staging systems)</th>
                <th>Simulated</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Bundles and their prices</td>
                <td>The box reservation and the order</td>
              </tr>
              <tr>
                <td>Branches, locations and opening hours</td>
                <td>The payment confirmation; the checkout is ours</td>
              </tr>
              <tr>
                <td>The agent&rsquo;s reasoning, journeys and guards</td>
                <td>The customer: two test personas instead of UAE PASS</td>
              </tr>
            </tbody>
          </table>
          <p>
            No real box is rented, no money moves, and every reference the sandbox issues is prefixed <code>SBX</code>. Sandbox conversations are kept apart from Emirates Post&rsquo;s customer
            transcripts.
          </p>
          <h3>Access</h3>
          <p>
            Access is by invitation. An invited account signs in to this portal, creates an <Link href="/developers/apps">application</Link>, and receives that application&rsquo;s credentials
            once. The <Link href="/developers/console">Console</Link> lets you drive the same doorway from the browser, and <Link href="/developers/activity">Activity</Link> shows every request
            your applications made.
          </p>
          <h3>Base URL and endpoints</h3>
          <p>
            Every URL below is relative to this deployment&rsquo;s origin, <DocsHost />. The Agent Card gives the same URLs in full.
          </p>
          <table className="[&_td:first-child]:!whitespace-normal">
            <thead>
              <tr>
                <th>Path</th>
                <th>What it is</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>GET /.well-known/agent-card.json</code>
                </td>
                <td>The Agent Card of this host&rsquo;s default agent (the sandbox). Public.</td>
              </tr>
              <tr>
                <td>
                  <code>GET /a2a/po-box-sandbox/agent-card.json</code>
                </td>
                <td>The same card, by agent key. Public.</td>
              </tr>
              <tr>
                <td>
                  <code>POST /a2a/oauth/token</code>
                </td>
                <td>OAuth 2.0 token endpoint, client credentials.</td>
              </tr>
              <tr>
                <td>
                  <code>POST /a2a/po-box-sandbox</code>
                </td>
                <td>The JSON-RPC 2.0 binding. Streaming methods answer with <code>text/event-stream</code>.</td>
              </tr>
              <tr>
                <td>
                  <code>/a2a/po-box-sandbox/rest/…</code>
                </td>
                <td>
                  The HTTP+JSON binding (<a href="#rest">REST</a>).
                </td>
              </tr>
              <tr>
                <td>
                  <code>GET /a2a/po-box-sandbox/sandbox/personas</code>
                </td>
                <td>The sandbox personas. Public, outside the protocol.</td>
              </tr>
              <tr>
                <td>
                  <code>POST /a2a/po-box-sandbox/sandbox/payments/{"{reference}"}/settle</code>
                </td>
                <td>Settle a sandbox payment without a browser. Authenticated, outside the protocol.</td>
              </tr>
            </tbody>
          </table>
        </Section>

        {/* 2 ───────────────────────────────────────────────────────────── */}
        <Section id="quickstart" title="Quickstart">
          <p>Five steps take a renewal from nothing to a paid order. The whole flow in one script follows, in Node.js and in Python.</p>
          <h3>1. Get credentials</h3>
          <p>
            In <Link href="/developers/apps">Applications</Link>, create an application. You receive a <code>client_id</code> (<code>dlg_…</code>), a <code>client_secret</code> (<code>dlgs_…</code>) and
            an API key (<code>dlgk_sandbox_…</code>). They are shown once; store them in your secret manager. The application is enabled for the agent <code>po-box-sandbox</code>.
          </p>
          <h3>2. Get a token</h3>
          <DocsCode code={S.tokenCurl} title="bash" lang="bash" />
          <DocsCode code={S.tokenResponse} title="200 OK" lang="json" />
          <p>
            The token is valid for an hour. Send it as <code>Authorization: Bearer &lt;access_token&gt;</code>. Scripts may skip this step and send the API key instead (<a href="#authentication">Authentication</a>).
          </p>
          <h3>3. Send the first message</h3>
          <p>
            One JSON-RPC call to <code>SendMessage</code>. The message carries the customer&rsquo;s words and, in its metadata, the citizen identity: here the signed-in persona, who has box 50500 on file.
          </p>
          <DocsCode code={S.sendCurl} title="bash" lang="bash" />
          <p>
            The call blocks until the agent&rsquo;s turn ends, typically 5 to 40 seconds, and returns the task. For this persona the renewal is ready in one reply: a summary, the amount, a payment
            to make. The task rests in <code>TASK_STATE_INPUT_REQUIRED</code> with <code>metadata.awaiting = "payment"</code>.
          </p>
          <DocsCode code={S.sendResponse} title="200 OK (abridged)" lang="json" />
          <h3>4. Follow the task</h3>
          <p>
            Keep <code>contextId</code> (the conversation) and <code>task.id</code>. To answer the agent, send the next message with both ids. To read the task again, call <code>GetTask</code>.
          </p>
          <DocsCode code={S.followUpCurl} title="bash" lang="bash" />
          <DocsCode code={S.getTaskCurl} title="bash" lang="bash" />
          <h3>5. Settle the payment</h3>
          <p>
            The task&rsquo;s <code>payment-request</code> artifact carries the checkout URL and, in the sandbox, a <code>settleUrl</code>. Either open the URL in a browser and press &ldquo;Pay now&rdquo;,
            or POST to the settle URL with the same Authorization header.
          </p>
          <DocsCode code={S.settleCurl} title="bash" lang="bash" />
          <DocsCode code={S.settleResponse} title="200 OK" lang="json" />
          <p>
            After settlement the task continues by itself: <code>TASK_STATE_WORKING</code>, then <code>TASK_STATE_COMPLETED</code> with a <code>service-outcome</code> artifact. Poll <code>GetTask</code>{" "}
            every few seconds or hold a <code>SubscribeToTask</code> stream.
          </p>
          <h3>The whole flow</h3>
          <DocsCode code={S.nodeSample} title="Node.js" lang="js" />
          <DocsCode code={S.pythonSample} title="Python" lang="python" />
        </Section>

        {/* 3 ───────────────────────────────────────────────────────────── */}
        <Section id="authentication" title="Authentication">
          <p>
            A2A authenticates the <em>calling application</em>. The citizen the task is about is a second identity carried inside the message (<a href="#identity">Citizen identity</a>). The Agent
            Card advertises two schemes for the application; both identify the same application and have the same rights.
          </p>
          <h3>OAuth 2.0 client credentials</h3>
          <p>
            <code>POST /a2a/oauth/token</code> with the client id and secret as HTTP Basic, or in a form or JSON body; <code>grant_type=client_credentials</code>; <code>scope=tasks</code> (the only scope,
            and the default when omitted). The response follows RFC 6749: an <code>access_token</code> valid for 3600 seconds, to be sent as <code>Authorization: Bearer</code>.
          </p>
          <DocsCode code={S.tokenJsonCurl} title="bash" lang="bash" />
          <p>Errors follow RFC 6749 §5.2:</p>
          <DocsCode code={S.tokenErrors} title="token errors" lang="text" />
          <h3>API key</h3>
          <p>
            The header <code>X-API-Key: dlgk_sandbox_…</code>. The key is also accepted as <code>Authorization: Bearer dlgk_sandbox_…</code>. It does not expire; use it for scripts and tests, and the
            OAuth client for a system that runs unattended.
          </p>
          <DocsCode code={S.apiKeyCurl} title="bash" lang="bash" />
          <h3>Rotation and revocation</h3>
          <p>
            Rotating an application in the portal issues a new secret and a new key. The old ones stop working at once, and so does <strong>every access token issued before the rotation</strong>, even
            one that has not expired. Revoking an application ends it: its credentials and tokens are refused with <code>-32010</code>.
          </p>
          <h3>Headers on every request</h3>
          <table>
            <thead>
              <tr>
                <th>Header</th>
                <th>Value</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>Authorization</code>
                </td>
                <td>
                  <code>Bearer &lt;access_token&gt;</code>
                </td>
                <td>The application. Or <code>X-API-Key</code>.</td>
              </tr>
              <tr>
                <td>
                  <code>A2A-Version</code>
                </td>
                <td>
                  <code>1.0</code>
                </td>
                <td>Recommended. Another version is refused with <code>-32009</code> VersionNotSupported.</td>
              </tr>
              <tr>
                <td>
                  <code>Content-Type</code>
                </td>
                <td>
                  <code>application/json</code>
                </td>
                <td>The request body.</td>
              </tr>
              <tr>
                <td>
                  <code>Accept</code>
                </td>
                <td>
                  <code>text/event-stream</code>
                </td>
                <td>Optional on streaming methods; they answer with a stream regardless.</td>
              </tr>
            </tbody>
          </table>
          <p>
            A missing or invalid credential answers <code>-32010</code> Unauthenticated (HTTP 401 with <code>WWW-Authenticate</code>). A valid credential for an application not enabled for this agent answers{" "}
            <code>-32011</code> PermissionDenied (403).
          </p>
        </Section>

        {/* 4 ───────────────────────────────────────────────────────────── */}
        <Section id="discovery" title="Discovery: the Agent Card">
          <p>
            The Agent Card describes the agent for a client that has never met it: where to call, how to authenticate, what it can do, and which extensions it speaks. It is public and needs no
            credentials.
          </p>
          <DocsCode code={S.cardCurl} title="bash" lang="bash" />
          <DocsCode code={S.cardJson} title="agent-card.json (abridged)" lang="json" />
          <h3>Fields that matter</h3>
          <table>
            <thead>
              <tr>
                <th>Field</th>
                <th>Use</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>supportedInterfaces[]</code>
                </td>
                <td>
                  The endpoints by binding: <code>JSONRPC</code> first, <code>HTTP+JSON</code> second, both <code>protocolVersion: "1.0"</code>. URLs are on the origin the card was fetched from.
                </td>
              </tr>
              <tr>
                <td>
                  <code>capabilities</code>
                </td>
                <td>
                  <code>streaming: true</code>; <code>pushNotifications: false</code>; <code>extendedAgentCard: false</code> (the public card is the whole card).
                </td>
              </tr>
              <tr>
                <td>
                  <code>capabilities.extensions[]</code>
                </td>
                <td>
                  The citizen-identity extension (its <code>params.personas</code> lists the sandbox personas) and the dialog-reply extension. Neither is required to be declared by the client.
                </td>
              </tr>
              <tr>
                <td>
                  <code>securitySchemes</code>
                </td>
                <td>
                  <code>oauth2</code> with the token URL and the <code>tasks</code> scope; <code>apiKey</code> in the header <code>X-API-Key</code>.
                </td>
              </tr>
              <tr>
                <td>
                  <code>skills[]</code>
                </td>
                <td>Four skills with ids, tags and example utterances. Skills are descriptive: a message is routed by its content, not by skill id.</td>
              </tr>
              <tr>
                <td>
                  <code>version</code>
                </td>
                <td>The agent&rsquo;s release. The card&rsquo;s ETag changes with it.</td>
              </tr>
            </tbody>
          </table>
          <p>
            The card is served with <code>Cache-Control: public, max-age=300</code> and an ETag; cache it for five minutes and revalidate. The well-known card also allows cross-origin reads.
          </p>
        </Section>

        {/* 5 ───────────────────────────────────────────────────────────── */}
        <Section id="tasks" title="Tasks and conversations">
          <p>
            A <strong>contextId</strong> is a conversation: the agent&rsquo;s memory of everything said. A <strong>task</strong> is one service request inside it, from the first message to an outcome. A conversation
            can hold several tasks in turn, for example a renewal and then a question about delivery.
          </p>
          <ul>
            <li>A message with neither id opens a new conversation and a new task.</li>
            <li>
              A message with a <code>contextId</code> and no <code>taskId</code> continues the open task in that conversation if there is one, and otherwise opens a new task with the agent&rsquo;s memory
              of what came before.
            </li>
            <li>
              A message with a <code>taskId</code> continues that task. A <code>contextId</code> sent alongside must match the task&rsquo;s, or the call fails with <code>-32602</code>.
            </li>
            <li>
              A <code>contextId</code> your application did not create is refused with <code>-32602</code>.
            </li>
          </ul>
          <h3>States</h3>
          <table>
            <thead>
              <tr>
                <th>State</th>
                <th>Meaning here</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>TASK_STATE_SUBMITTED</code>
                </td>
                <td>Created, not yet running. Seen only in the first instant of a task.</td>
              </tr>
              <tr>
                <td>
                  <code>TASK_STATE_WORKING</code>
                </td>
                <td>
                  A turn is running. Only one turn runs at a time; a second message meanwhile is refused with <code>-32004</code>. A turn that has not finished after six minutes is presumed dead and
                  the lock is released.
                </td>
              </tr>
              <tr>
                <td>
                  <code>TASK_STATE_INPUT_REQUIRED</code>
                </td>
                <td>
                  The agent replied and waits. For the customer&rsquo;s next message (<code>awaiting: "input"</code>), or for a payment (<code>awaiting: "payment"</code>).
                </td>
              </tr>
              <tr>
                <td>
                  <code>TASK_STATE_AUTH_REQUIRED</code>
                </td>
                <td>
                  The agent needs the citizen signed in. Resend to the same task with the citizen-identity metadata (<a href="#identity">Citizen identity</a>).
                </td>
              </tr>
              <tr>
                <td>
                  <code>TASK_STATE_COMPLETED</code>
                </td>
                <td>The service outcome exists: the order is recorded and paid, or the request was handed to a person. Terminal.</td>
              </tr>
              <tr>
                <td>
                  <code>TASK_STATE_FAILED</code>
                </td>
                <td>The agent is not configured on this host. Nothing a retry would change. Terminal.</td>
              </tr>
              <tr>
                <td>
                  <code>TASK_STATE_CANCELED</code>
                </td>
                <td>
                  Canceled by <code>CancelTask</code>. The conversation stays open. Terminal.
                </td>
              </tr>
            </tbody>
          </table>
          <p>
            <code>TASK_STATE_REJECTED</code> is in the protocol but not produced by this agent.
          </p>
          <h3>What the task is waiting for</h3>
          <p>
            <code>task.metadata.awaiting</code> says it plainly: <code>"input"</code>, <code>"auth"</code>, <code>"payment"</code>, or <code>null</code> when the task is working or finished. The same value is in the
            data part of the agent&rsquo;s last message. <code>metadata</code> also carries <code>agent</code>, <code>locale</code>, and when known <code>persona</code>, <code>journey</code> and{" "}
            <code>paymentReference</code>.
          </p>
          <h3>Retries</h3>
          <p>
            A transient engine error (a model timeout, a backend that did not answer) does not fail the task. It stays <code>TASK_STATE_INPUT_REQUIRED</code> with an apology as its text and a{" "}
            <code>warning</code> field in the data part. Send the same message again.
          </p>
          <p>
            A message to a terminal task is refused with <code>-32004</code>. To continue the conversation, send the next message with the <code>contextId</code> and no <code>taskId</code>: a new task opens with
            the agent&rsquo;s memory of the first.
          </p>
        </Section>

        {/* 6 ───────────────────────────────────────────────────────────── */}
        <Section id="sending" title="Sending messages">
          <p>
            <code>SendMessage</code> runs one turn and returns the task as it stands when the turn ends. <code>SendStreamingMessage</code> does the same over a stream of events (<a href="#streaming">Streaming</a>).
            Both take the same <code>params</code>.
          </p>
          <table className="[&_td:first-child]:!whitespace-normal">
            <thead>
              <tr>
                <th>Field</th>
                <th>Type</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>message.messageId</code>
                </td>
                <td>string</td>
                <td>Your id for the message, a UUID. Generated if omitted.</td>
              </tr>
              <tr>
                <td>
                  <code>message.role</code>
                </td>
                <td>
                  <code>"ROLE_USER"</code>
                </td>
                <td>The only accepted role.</td>
              </tr>
              <tr>
                <td>
                  <code>message.parts[]</code>
                </td>
                <td>Part[]</td>
                <td>
                  At least one. Text parts (<code>{"{ text }"}</code>) and data parts (<code>{"{ data }"}</code>) are accepted. File parts (<code>url</code>, <code>raw</code>) are refused with <code>-32005</code>.
                </td>
              </tr>
              <tr>
                <td>
                  <code>message.contextId</code>
                </td>
                <td>string</td>
                <td>The conversation to continue. Omit to start one.</td>
              </tr>
              <tr>
                <td>
                  <code>message.taskId</code>
                </td>
                <td>string</td>
                <td>The task to continue. Omit to let the conversation decide (see above).</td>
              </tr>
              <tr>
                <td>
                  <code>message.metadata[{"<identity uri>"}]</code>
                </td>
                <td>object</td>
                <td>
                  <code>{"{ persona }"}</code> or <code>{"{ hostToken }"}</code>. Also accepted in <code>params.metadata</code>.
                </td>
              </tr>
              <tr>
                <td>
                  <code>message.metadata.locale</code>
                </td>
                <td>
                  <code>"en" | "ar"</code>
                </td>
                <td>The agent&rsquo;s language, fixed by the first message of a task. Defaults to Arabic when the text is Arabic, English otherwise.</td>
              </tr>
              <tr>
                <td>
                  <code>configuration.returnImmediately</code>
                </td>
                <td>boolean</td>
                <td>
                  Return as soon as the turn has started, with the task in <code>TASK_STATE_WORKING</code>. Follow with <code>SubscribeToTask</code> or <code>GetTask</code>.
                </td>
              </tr>
              <tr>
                <td>
                  <code>configuration.historyLength</code>
                </td>
                <td>number</td>
                <td>
                  How many recent messages to include in <code>task.history</code>. <code>0</code> omits it. Default: all.
                </td>
              </tr>
              <tr>
                <td>
                  <code>configuration.taskPushNotificationConfig</code>
                </td>
                <td className="text-muted">None</td>
                <td>Ignored; push notifications are not supported.</td>
              </tr>
            </tbody>
          </table>
          <h3>Response</h3>
          <p>
            <code>result</code> is <code>{"{ task }"}</code>: the Task with <code>id</code>, <code>contextId</code>, <code>status</code> (<code>state</code>, <code>message</code>, <code>timestamp</code>),{" "}
            <code>artifacts</code>, <code>history</code> and <code>metadata</code>. The agent&rsquo;s reply is <code>status.message</code>. This agent never answers with a bare <code>{"{ message }"}</code>; every
            exchange is a task.
          </p>
          <h3>Follow-ups</h3>
          <p>
            Send the customer&rsquo;s next words with the same <code>contextId</code> and <code>taskId</code>. When the reply offered blocks, send what the block&rsquo;s <code>reply</code> field says: the option&rsquo;s
            text for buttons, the card&rsquo;s title, the composed line for toggles (<a href="#reply">Reading a reply</a>).
          </p>
          <h3>Not waiting for the turn</h3>
          <DocsCode code={S.returnImmediately} title="returnImmediately" lang="js" />
          <p>
            A blocking call is held for up to 280 seconds. Turns rarely take more than 40; if one does, the task is left as it stands and <code>GetTask</code> shows it.
          </p>
        </Section>

        {/* 7 ───────────────────────────────────────────────────────────── */}
        <Section id="reply" title="Reading a reply">
          <p>
            Every agent message, in <code>status.message</code> and in <code>history</code>, has two parts and declares the extension <code>{REPLY}</code>:
          </p>
          <ol>
            <li>
              A <strong>text part</strong>: the reply in plain language. Each interactive block is replaced by a readable line (&ldquo;Options: Dubai · Abu Dhabi · …&rdquo;), so a text-only client still
              works.
            </li>
            <li>
              A <strong>data part</strong> (<code>mediaType: "application/json"</code>) with <code>blocks</code>, <code>case</code>, <code>awaiting</code>, and sometimes <code>warning</code>.
            </li>
          </ol>
          <DocsCode code={S.agentMessage} title="an agent message" lang="json" />
          <h3>Blocks and what to send back</h3>
          <p>
            <code>blocks</code> are the controls the chat widget would render. Each interactive block has a <code>reply</code> field that says what text to send as the next message.
          </p>
          <table>
            <thead>
              <tr>
                <th>type</th>
                <th>Fields</th>
                <th>Send back</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>pay</code>
                </td>
                <td>
                  <code>url</code>, <code>amount?</code>, <code>label?</code>
                </td>
                <td>Nothing. Pay at the URL or settle in the sandbox; the task continues by itself.</td>
              </tr>
              <tr>
                <td>
                  <code>buttons</code>
                </td>
                <td>
                  <code>options[]</code>
                </td>
                <td>The option&rsquo;s text.</td>
              </tr>
              <tr>
                <td>
                  <code>select</code>
                </td>
                <td>
                  <code>title?</code>, <code>options[{"{label, group?}"}]</code>, <code>confirm</code>
                </td>
                <td>The chosen option&rsquo;s label.</td>
              </tr>
              <tr>
                <td>
                  <code>toggles</code>
                </td>
                <td>
                  <code>title?</code>, <code>style</code>, <code>items[{"{key, label}"}]</code>, <code>confirm[]</code>
                </td>
                <td>
                  Each choice as <code>&lt;label&gt;: Yes</code> or <code>&lt;label&gt;: No</code>, then a confirm label. The block&rsquo;s <code>reply</code> gives the exact example.
                </td>
              </tr>
              <tr>
                <td>
                  <code>summary</code>
                </td>
                <td>
                  <code>title?</code>, <code>rows[{"{label, value}"}]</code>, <code>total?</code>
                </td>
                <td>Nothing; display it.</td>
              </tr>
              <tr>
                <td>
                  <code>cards</code>
                </td>
                <td>
                  <code>cards[{"{title, price?, priceNote?, desc?, badge?, disabled?, attrs[]}"}]</code>
                </td>
                <td>The card&rsquo;s title.</td>
              </tr>
              <tr>
                <td>
                  <code>map</code>
                </td>
                <td>
                  <code>emirate</code>, <code>bundle</code>
                </td>
                <td>A branch name; the branches are listed by name in the text.</td>
              </tr>
              <tr>
                <td>
                  <code>locate</code>
                </td>
                <td>
                  <code>label?</code>
                </td>
                <td>
                  An address, or <code>latitude, longitude</code>.
                </td>
              </tr>
              <tr>
                <td>
                  <code>upload</code>
                </td>
                <td>
                  <code>document</code>
                </td>
                <td>Files cannot be sent over the doorway. Say the document is not available, or continue without it.</td>
              </tr>
              <tr>
                <td>
                  <code>other</code>
                </td>
                <td>
                  <code>kind</code>, <code>body</code>
                </td>
                <td>A fenced block of a kind not listed here, verbatim.</td>
              </tr>
            </tbody>
          </table>
          <DocsCode code={S.blocksJson} title="block shapes" lang="json" />
          <h3>The case</h3>
          <p>
            <code>case</code> is the state of the service request as the agent holds it. <code>journey</code> is the journey in progress (<code>personal_po_box_rental</code>, <code>personal_po_box_renewal</code>,
            and so on) and <code>step</code> its current step. <code>status</code> is <code>draft</code>, <code>ready</code>, <code>submitted</code> or <code>escalated</code>. <code>collected</code> holds the fields gathered so
            far by their keys; <code>missing</code> lists what is still needed, each with <code>kind</code> <code>field</code> or <code>document</code>. <code>payment</code> gives <code>status</code> (<code>none</code>,{" "}
            <code>initiated</code>, <code>paid</code>, <code>failed</code>), <code>reference</code>, <code>amount</code> and <code>currency</code>. <code>case</code> is <code>null</code> before the first turn has run.
          </p>
          <p>
            <code>warning</code>, when present, is the engine error that interrupted the turn; the text already apologises for it. Send the same message again.
          </p>
        </Section>

        {/* 8 ───────────────────────────────────────────────────────────── */}
        <Section id="identity" title="Citizen identity">
          <p>
            A2A authenticates your application. The citizen is a second identity carried <em>inside</em> the message, under the extension <code>{IDENTITY}</code>, as a key of{" "}
            <code>message.metadata</code> (or of <code>params.metadata</code>). The agent never sees a UAE PASS token through this doorway; in production the front door that signed the citizen in asserts who
            they are, and in the sandbox the assertion is replaced by a test persona.
          </p>
          <DocsCode code={S.identityMeta} title="message.metadata" lang="js" />
          <h3>Sandbox personas</h3>
          <table>
            <thead>
              <tr>
                <th>persona</th>
                <th>Who</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>ahmed-al-mansoori</code>
                </td>
                <td>
                  Signed in via UAE PASS. Emirates ID on file. Two PO Boxes: <strong>50500</strong> in Dubai (MyHome, AED 695 a year, auto-renewal off) and <strong>33417</strong> in Abu Dhabi (MyBox, AED 300 a
                  year, expired, auto-renewal on, a saved card). Use for renewals, management and a new rental as an existing customer.
                </td>
              </tr>
              <tr>
                <td>
                  <code>guest</code>
                </td>
                <td>No sign-in. The agent answers questions and runs a renewal by box number and emirate. A new rental asks for sign-in: the task reports <code>TASK_STATE_AUTH_REQUIRED</code>.</td>
              </tr>
            </tbody>
          </table>
          <p>
            The list is also at <code>GET /a2a/po-box-sandbox/sandbox/personas</code> and in the Agent Card&rsquo;s extension <code>params</code>. An unknown persona is refused with <code>-32602</code>, naming
            the accepted ones.
          </p>
          <DocsCode code={S.personasCurl} title="bash" lang="bash" />
          <h3>When to send it</h3>
          <p>
            Send the identity on the first message of a conversation. It is applied to the conversation the way a UAE PASS sign-in is, and persists for that <code>contextId</code>; later messages
            may repeat it harmlessly or leave it out. A signed-in persona pre-fills the agent&rsquo;s knowledge of the customer (name, contact details, Emirates ID) so it never asks for what it was
            handed.
          </p>
          <h3>AUTH_REQUIRED</h3>
          <p>
            When the agent needs the customer signed in and no signed-in identity has been given, the task rests in <code>TASK_STATE_AUTH_REQUIRED</code> with <code>awaiting: "auth"</code>. Resend to the same task
            with the identity. The text may be empty on that message: the sign-in happens and the agent presents the account summary, the way it does after a UAE PASS popup closes. An empty text
            without a sign-in is refused with <code>-32602</code>.
          </p>
          <DocsCode code={S.authRequired} title="the AUTH_REQUIRED flow" lang="js" />
          <h3>hostToken</h3>
          <p>
            <code>{"{ hostToken }"}</code> carries an Emirates Post host session token, for Emirates Post&rsquo;s own channels embedding the agent. It is passed to the engine, which verifies it the way it verifies
            the widget&rsquo;s. It is not needed in the sandbox, and personas are accepted by sandbox agents only.
          </p>
        </Section>

        {/* 9 ───────────────────────────────────────────────────────────── */}
        <Section id="payments" title="Payments in the sandbox">
          <p>
            When a journey reaches its payment, the sandbox records the order with a simulated Emirates Post call and opens a payment on our mock checkout. The reply carries a <code>pay</code> block,
            the task gains a <code>payment-request</code> artifact, and <code>metadata.awaiting</code> becomes <code>"payment"</code>. The task stays <code>TASK_STATE_INPUT_REQUIRED</code>: there is nothing to
            say until the payment is made.
          </p>
          <DocsCode code={S.paymentRequestArtifact} title="payment-request artifact" lang="json" />
          <h3>Two ways to pay</h3>
          <ol>
            <li>
              Open <code>url</code> in a browser. The mock checkout shows the amount and a &ldquo;Pay now&rdquo; button (and a cancel). This is what a customer would see in the sandbox.
            </li>
            <li>
              <code>POST sandbox.settleUrl</code> with the same Authorization header and the body <code>{"{ \"outcome\": \"paid\" }"}</code>, or <code>"failed"</code> to rehearse a declined payment. Only{" "}
              <code>SBX-</code> references can be settled this way. Settling twice is idempotent.
            </li>
          </ol>
          <DocsCode code={S.settleCurl} title="bash" lang="bash" />
          <h3>After settlement</h3>
          <p>
            A <strong>paid</strong> outcome moves the task on by itself: it goes <code>TASK_STATE_WORKING</code> while the engine confirms the order, then <code>TASK_STATE_COMPLETED</code> with a{" "}
            <code>service-outcome</code> artifact and a receipt URL, or <code>TASK_STATE_INPUT_REQUIRED</code> if something is still missing. The settle response returns before that turn ends, so observe the task:{" "}
            <code>SubscribeToTask</code>, or <code>GetTask</code> every few seconds until the state is not <code>WORKING</code> and <code>awaiting</code> is not <code>"payment"</code>.
          </p>
          <p>
            A <strong>failed</strong> outcome marks the payment failed and leaves the task where it is, waiting for a payment. Send a message to carry on with the agent, or cancel the task.
          </p>
          <p>
            No money moves. The payment references are prefixed <code>SBX</code> and the order numbers <code>SBX</code> as well; neither exists at Emirates Post.
          </p>
        </Section>

        {/* 10 ──────────────────────────────────────────────────────────── */}
        <Section id="artifacts" title="Artifacts">
          <p>
            Artifacts are the durable outputs of a task, appended to <code>task.artifacts</code> and streamed as <code>artifactUpdate</code> events. Each has one data part. Three kinds exist.
          </p>
          <table>
            <thead>
              <tr>
                <th>name</th>
                <th>When</th>
                <th>Data</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>payment-request</code>
                </td>
                <td>A payment must be made</td>
                <td>
                  <code>reference</code>, <code>amount</code>, <code>currency</code>, <code>url</code>, <code>provider</code>, <code>method</code>, <code>sandbox.settleUrl</code>, <code>sandbox.note</code>
                </td>
              </tr>
              <tr>
                <td>
                  <code>service-outcome</code>
                </td>
                <td>The task completed with a result</td>
                <td>
                  <code>journey</code>, <code>reference</code>, <code>orderNo</code>, <code>receiptUrl</code>, <code>payment</code>, <code>collected</code>
                </td>
              </tr>
              <tr>
                <td>
                  <code>escalation</code>
                </td>
                <td>The request was handed to a person</td>
                <td>
                  <code>reference</code>, <code>journey</code>
                </td>
              </tr>
            </tbody>
          </table>
          <DocsCode code={S.serviceOutcomeArtifact} title="service-outcome artifact" lang="json" />
          <DocsCode code={S.escalationArtifact} title="escalation artifact" lang="json" />
          <p>
            <code>provider</code> and <code>method</code> on a payment request describe the route the payment took and may be <code>null</code>. <code>ListTasks</code> omits artifacts unless asked (<code>includeArtifacts: true</code>);{" "}
            <code>GetTask</code> always includes them.
          </p>
        </Section>

        {/* 11 ──────────────────────────────────────────────────────────── */}
        <Section id="streaming" title="Streaming">
          <p>
            <code>SendStreamingMessage</code> and <code>SubscribeToTask</code> answer with <code>text/event-stream</code>. In the JSON-RPC binding every <code>data:</code> line is a complete JSON-RPC response whose{" "}
            <code>result</code> is one of <code>{"{ task }"}</code>, <code>{"{ statusUpdate }"}</code> or <code>{"{ artifactUpdate }"}</code>. Comment lines (<code>: ping</code>) arrive every 15 seconds to keep the connection
            open; ignore them.
          </p>
          <DocsCode code={S.streamCurl} title="bash" lang="bash" />
          <h3>Event order</h3>
          <ol>
            <li>
              <code>{"{ task }"}</code>: the task as the turn starts, in <code>TASK_STATE_WORKING</code>.
            </li>
            <li>
              <code>{"{ statusUpdate }"}</code> with state <code>WORKING</code>, zero or more, each carrying the text so far in <code>status.message</code> with <code>metadata.partial = true</code>. Replace, do not
              append: each one is the whole text to that point, at most one every 700 ms.
            </li>
            <li>
              <code>{"{ artifactUpdate }"}</code>, zero or more, each a whole artifact (<code>lastChunk: true</code>).
            </li>
            <li>
              A final <code>{"{ statusUpdate }"}</code> with the resting state and the complete message, text and data part.
            </li>
          </ol>
          <DocsCode code={S.streamFrames} title="SSE frames (abridged)" lang="http" />
          <p>
            An error after the stream has opened is sent as a final frame: a JSON-RPC response with <code>error</code> instead of <code>result</code>. An error before it opens (authentication, version) is an ordinary
            JSON response with its HTTP status.
          </p>
          <h3>SubscribeToTask</h3>
          <p>
            Attach to a task that is working or waiting, for example after <code>returnImmediately</code> or after settling a payment. The stream opens with <code>{"{ task }"}</code> as it stands, then relays
            events. It closes when the task reaches a resting state (<code>INPUT_REQUIRED</code>, <code>AUTH_REQUIRED</code> or terminal), or after about 55 seconds of nothing happening; subscribe again. A
            subscription to a terminal task is refused with <code>-32004</code>.
          </p>
          <DocsCode code={S.subscribeCurl} title="bash" lang="bash" />
          <h3>REST framing</h3>
          <p>
            In the HTTP+JSON binding the <code>data:</code> payload is the bare StreamResponse, with no JSON-RPC envelope; an error frame is <code>{"{ error }"}</code>.
          </p>
          <DocsCode code={S.restStreamFrame} title="REST SSE frames" lang="http" />
        </Section>

        {/* 12 ──────────────────────────────────────────────────────────── */}
        <Section id="journeys" title="Journeys">
          <p>The agent does what the chat widget does, in the sandbox. The Agent Card lists it as four skills.</p>
          <table>
            <thead>
              <tr>
                <th>Skill</th>
                <th>What happens</th>
                <th>Needs sign-in</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>po-box-registration</code>
                </td>
                <td>
                  Rent a personal or corporate PO Box: bundle, emirate and branch, box number, term, optional authorised agent and key delivery, then the order and its payment. Journeys{" "}
                  <code>personal_po_box_rental</code>, <code>corporate_po_box_rental</code>.
                </td>
                <td>Yes</td>
              </tr>
              <tr>
                <td>
                  <code>po-box-renewal</code>
                </td>
                <td>
                  Renew an existing box for one or more years, on the current bundle or an upgrade, and pay. A signed-in customer&rsquo;s boxes are on file; a guest gives the box number and
                  emirate. Journeys <code>personal_po_box_renewal</code>, <code>corporate_po_box_renewal</code>.
                </td>
                <td>No</td>
              </tr>
              <tr>
                <td>
                  <code>po-box-management</code>
                </td>
                <td>
                  Status, expiry, auto-renewal, authorised agents, linking a trade licence. Journey <code>manage_po_box</code>.
                </td>
                <td>Yes</td>
              </tr>
              <tr>
                <td>
                  <code>po-box-enquiry</code>
                </td>
                <td>Prices and bundles, branches and hours, what a box includes, how delivery works, tracking a shipment. Questions can also be recorded for a call back.</td>
                <td>No</td>
              </tr>
            </tbody>
          </table>
          <p>
            Document uploads, needed only when adding an authorised agent, cannot be sent over the doorway. When an <code>upload</code> block appears, say the document is not available or continue
            without the agent.
          </p>
          <h3>Example: a renewal (signed in)</h3>
          <p>The agent&rsquo;s wording varies; the shape does not.</p>
          <Exchange
            rows={[
              ["ahmed-al-mansoori", "Renew my PO Box 50500 in Dubai for one more year, same bundle and options.", "A summary block (box, bundle, term, total AED 695), a pay block, and buttons: “Pay with Noqodi instead”, “Change the term”. State INPUT_REQUIRED, awaiting payment. Artifact payment-request."],
              ["(no message)", "(POST sandbox.settleUrl { outcome: \"paid\" })", "The task goes WORKING, then COMPLETED: “Your renewal is confirmed…” with the receipt link. Artifact service-outcome."],
              ["", "thanks", "Refused: -32004, the task is TASK_STATE_COMPLETED. Send with the contextId only to open a new task."],
            ]}
          />
          <h3>Example: a rental (guest, then signed in)</h3>
          <Exchange
            rows={[
              ["guest", "I want to rent a new PO Box", "“To rent a PO Box you need to sign in with UAE PASS…” State AUTH_REQUIRED, awaiting auth."],
              ["ahmed-al-mansoori", "(same task, empty text with the identity)", "The account: two boxes on file, and the offer to continue the rental. State INPUT_REQUIRED."],
              ["", "I want to rent a new PO Box in Dubai", "Cards: the bundles with prices (MyHome, MyBox, …). “Which bundle would you like?”"],
              ["", "MyHome", "A map block for Dubai and a select of branches by name."],
              ["", "Al Barsha", "Cards or buttons with available box numbers; then buttons for the term (1 year, 2 years)."],
              ["", "1 year", "Toggles: terms acceptance, auto-renewal; confirm “Continue to payment”."],
              ["", "I accept the Terms: Yes. Renew automatically each year: No. Continue to payment.", "Summary and pay block. Awaiting payment; artifact payment-request."],
              ["(no message)", "(settle paid)", "COMPLETED with service-outcome: reference, order number, receipt."],
            ]}
          />
        </Section>

        {/* 13 ──────────────────────────────────────────────────────────── */}
        <Section id="rest" title="REST binding">
          <p>
            The HTTP+JSON binding (specification §11) at <code>/a2a/po-box-sandbox/rest</code>. Bodies and results are the same objects as the JSON-RPC <code>params</code> and <code>result</code>, without the envelope.
          </p>
          <table>
            <thead>
              <tr>
                <th>Operation</th>
                <th>Method and path</th>
                <th>Body / query</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>SendMessage</td>
                <td>
                  <code>POST /rest/message:send</code>
                </td>
                <td>
                  <code>{"{ message, configuration? }"}</code> → <code>{"{ task }"}</code>
                </td>
              </tr>
              <tr>
                <td>SendStreamingMessage</td>
                <td>
                  <code>POST /rest/message:stream</code>
                </td>
                <td>Same body; SSE.</td>
              </tr>
              <tr>
                <td>ListTasks</td>
                <td>
                  <code>GET /rest/tasks</code>
                </td>
                <td>
                  <code>contextId</code>, <code>status</code>, <code>pageSize</code>, <code>pageToken</code>, <code>historyLength</code>, <code>statusTimestampAfter</code>, <code>includeArtifacts</code>
                </td>
              </tr>
              <tr>
                <td>GetTask</td>
                <td>
                  <code>GET /rest/tasks/{"{id}"}</code>
                </td>
                <td>
                  <code>historyLength</code>
                </td>
              </tr>
              <tr>
                <td>CancelTask</td>
                <td>
                  <code>POST /rest/tasks/{"{id}"}:cancel</code>
                </td>
                <td>→ the Task</td>
              </tr>
              <tr>
                <td>SubscribeToTask</td>
                <td>
                  <code>POST /rest/tasks/{"{id}"}:subscribe</code>
                </td>
                <td>SSE.</td>
              </tr>
              <tr>
                <td>Agent Card</td>
                <td>
                  <code>GET /a2a/po-box-sandbox/agent-card.json</code>
                </td>
                <td>Public.</td>
              </tr>
            </tbody>
          </table>
          <DocsCode code={S.restSendCurl} title="bash" lang="bash" />
          <p>
            Errors carry their HTTP status and a body <code>{"{ error: { code, status, message, details } }"}</code>, where <code>code</code> is the A2A code and <code>status</code> its name.
          </p>
          <DocsCode code={S.restError} title="REST error" lang="http" />
          <p>
            <code>GET /rest/extendedAgentCard</code> answers <code>-32004</code>; the push-notification paths answer <code>-32003</code>.
          </p>
        </Section>

        {/* 14 ──────────────────────────────────────────────────────────── */}
        <Section id="errors" title="Errors">
          <p>
            A JSON-RPC error has <code>code</code>, <code>message</code> and <code>data</code>: an array with one <code>google.rpc.ErrorInfo</code> object (<code>reason</code>, <code>domain</code>, <code>metadata</code>). The REST
            binding sends the same under <code>error</code> with the HTTP status below.
          </p>
          <DocsCode code={S.rpcError} title="a JSON-RPC error" lang="json" />
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>HTTP</th>
                <th>Name</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {ERRORS.map(([code, http, name, when]) => (
                <tr key={code}>
                  <td>
                    <code>{code}</code>
                  </td>
                  <td>{http}</td>
                  <td>{name}</td>
                  <td>{when}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            Batch requests (a JSON array) are refused with <code>-32600</code>. Push-notification methods answer <code>-32003</code>; <code>GetExtendedAgentCard</code> answers <code>-32004</code>.
          </p>
        </Section>

        {/* 15 ──────────────────────────────────────────────────────────── */}
        <Section id="limits" title="Limits and conduct">
          <ul>
            <li>
              <strong>Sandbox only.</strong> Nothing here reaches Emirates Post&rsquo;s production systems. The agent, the checkout and the personas are for integration work.
            </li>
            <li>
              <strong>No real data of real people.</strong> Use the personas. Do not send the names, Emirates IDs, contact details or box numbers of real customers.
            </li>
            <li>
              <strong>No money moves.</strong> Payments are simulated; references and order numbers are prefixed <code>SBX</code>.
            </li>
            <li>
              <strong>Data may be reset.</strong> Sandbox tasks, conversations and payments can be cleared without notice. Do not rely on them persisting.
            </li>
            <li>
              <strong>One turn at a time per task.</strong> Wait for a turn to end before sending the next message; a concurrent message is refused with <code>-32004</code>.
            </li>
            <li>
              <strong>Text and data parts only.</strong> File parts are refused with <code>-32005</code>.
            </li>
            <li>
              <strong>Rate limiting is reserved.</strong> <code>-32012</code> RateLimited (HTTP 429) is defined and not yet applied. Treat it as retryable with backoff when it appears.
            </li>
            <li>
              <strong>Credentials.</strong> Keep the client secret and the API key server-side. Rotate them from the portal if they leak; rotation revokes every token issued before it.
            </li>
          </ul>
        </Section>

        {/* 16 ──────────────────────────────────────────────────────────── */}
        <Section id="changelog" title="Changelog">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>2026-10-15</td>
                <td>
                  First release of the sandbox doorway: A2A 1.0, JSON-RPC and HTTP+JSON bindings, OAuth 2.0 client credentials and API keys, the citizen-identity and dialog-reply extensions,
                  sandbox personas, payable mock checkout with a settle endpoint, streaming. Agent version 2026.10.14.
                </td>
              </tr>
            </tbody>
          </table>
        </Section>
      </article>
    </div>
  );
}

const ERRORS: [string, string, string, string][] = [
  ["-32700", "400", "JSONParseError", "The body is not valid JSON."],
  ["-32600", "400", "InvalidRequestError", "Not a JSON-RPC 2.0 request: wrong jsonrpc, no method, a batch array, or a streaming method on a unary route."],
  ["-32601", "404", "MethodNotFoundError", "Unknown method, or unknown agent key in the URL."],
  ["-32602", "400", "InvalidParamsError", "Malformed message, unknown contextId or persona, contextId that does not match the task, empty text without a sign-in, bad pageToken."],
  ["-32603", "500", "InternalError", "Something failed on our side. Retry; if it persists, tell us the timestamp from error.data."],
  ["-32001", "404", "TaskNotFoundError", "No task with that id for your application."],
  ["-32002", "400", "TaskNotCancelableError", "CancelTask on a task that is already terminal."],
  ["-32003", "400", "PushNotificationNotSupportedError", "Any push-notification method. Use streaming or polling."],
  ["-32004", "400", "UnsupportedOperationError", "A message to a terminal task, a second message while a turn runs, a subscription to a terminal task, GetExtendedAgentCard."],
  ["-32005", "400", "ContentTypeNotSupportedError", "A file part (url or raw). Send text and data parts."],
  ["-32009", "400", "VersionNotSupportedError", "A2A-Version other than 1.0."],
  ["-32010", "401", "UnauthenticatedError", "Missing, invalid, expired or rotated-away credential."],
  ["-32011", "403", "PermissionDeniedError", "The application is not enabled for this agent."],
  ["-32012", "429", "RateLimitedError", "Reserved; not yet applied."],
];

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20">
      <h2>
        <a href={`#${id}`} className="!text-ink no-underline hover:!text-brand">
          {title}
        </a>
      </h2>
      {children}
    </section>
  );
}

/** A conversation sketched as rows: who spoke, what was sent, what came back. */
function Exchange({ rows }: { rows: [string, string, string][] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Identity</th>
          <th>Message sent</th>
          <th>Reply and task</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([who, sent, back], i) => (
          <tr key={i}>
            <td>{who ? <code>{who}</code> : <span className="text-muted">same</span>}</td>
            <td className="!whitespace-normal">{sent}</td>
            <td>{back}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
