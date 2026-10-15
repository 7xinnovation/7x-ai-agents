/**
 * The code samples of the documentation. `{{HOST}}` is replaced in the browser
 * by the origin the page is read on (components/developers/DocsCode.tsx).
 * Field names follow the A2A 1.0 ProtoJSON: camelCase, ROLE_USER, TASK_STATE_*.
 */

export const IDENTITY_URI = "https://agent.7x.ae/a2a/extensions/citizen-identity/v1";
export const REPLY_URI = "https://agent.7x.ae/a2a/extensions/dialog-reply/v1";

export const tokenCurl = `# Client credentials, HTTP Basic (client_id:client_secret)
curl -s -X POST {{HOST}}/a2a/oauth/token \\
  -u "$CLIENT_ID:$CLIENT_SECRET" \\
  -d "grant_type=client_credentials" \\
  -d "scope=tasks"`;

export const tokenJsonCurl = `# The same, with the credentials in a JSON body
curl -s -X POST {{HOST}}/a2a/oauth/token \\
  -H "Content-Type: application/json" \\
  -d "{\\"grant_type\\":\\"client_credentials\\",\\"client_id\\":\\"$CLIENT_ID\\",\\"client_secret\\":\\"$CLIENT_SECRET\\",\\"scope\\":\\"tasks\\"}"`;

export const tokenResponse = `{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "tasks"
}`;

export const apiKeyCurl = `# The API key instead of a token: the same request, one header
curl -s -X POST {{HOST}}/a2a/po-box-sandbox \\
  -H "X-API-Key: $API_KEY" \\
  -H "A2A-Version: 1.0" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"ListTasks","params":{"pageSize":5}}'`;

export const cardCurl = `curl -s {{HOST}}/.well-known/agent-card.json
# or, for the agent by name:
curl -s {{HOST}}/a2a/po-box-sandbox/agent-card.json`;

export const cardJson = `{
  "name": "Emirates Post PO Box Agent (Sandbox)",
  "description": "Rents, renews and manages Emirates Post PO Boxes, end to end, in a sandbox: …",
  "version": "2026.10.14",
  "documentationUrl": "{{HOST}}/developers/docs",
  "supportedInterfaces": [
    { "url": "{{HOST}}/a2a/po-box-sandbox", "protocolBinding": "JSONRPC", "protocolVersion": "1.0" },
    { "url": "{{HOST}}/a2a/po-box-sandbox/rest", "protocolBinding": "HTTP+JSON", "protocolVersion": "1.0" }
  ],
  "provider": { "organization": "7X Innovation Studio · Emirates Post Group", "url": "https://7x.ae" },
  "capabilities": {
    "streaming": true,
    "pushNotifications": false,
    "extendedAgentCard": false,
    "extensions": [
      {
        "uri": "${IDENTITY_URI}",
        "required": false,
        "params": { "personas": [ { "id": "ahmed-al-mansoori", "signedIn": true }, { "id": "guest", "signedIn": false } ] }
      },
      { "uri": "${REPLY_URI}", "required": false }
    ]
  },
  "securitySchemes": {
    "oauth2": {
      "oauth2SecurityScheme": {
        "flows": { "clientCredentials": { "tokenUrl": "{{HOST}}/a2a/oauth/token", "scopes": { "tasks": "Send messages to the agent and read the tasks your application created" } } }
      }
    },
    "apiKey": { "apiKeySecurityScheme": { "location": "header", "name": "X-API-Key" } }
  },
  "securityRequirements": [ { "schemes": { "oauth2": { "list": ["tasks"] } } }, { "schemes": { "apiKey": { "list": [] } } } ],
  "defaultInputModes": ["text/plain", "application/json"],
  "defaultOutputModes": ["text/plain", "application/json"],
  "skills": [
    { "id": "po-box-registration", "name": "Rent a new PO Box", "tags": ["po-box", "rental", "registration", "emirates-post"], "…": "…" },
    { "id": "po-box-renewal", "name": "Renew a PO Box", "…": "…" },
    { "id": "po-box-management", "name": "Manage an existing PO Box", "…": "…" },
    { "id": "po-box-enquiry", "name": "PO Box questions", "…": "…" }
  ]
}`;

export const sendCurl = `curl -s -X POST {{HOST}}/a2a/po-box-sandbox \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "A2A-Version: 1.0" \\
  -H "Content-Type: application/json" \\
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "SendMessage",
    "params": {
      "message": {
        "messageId": "0f7a1c2e-5b3d-4e8f-9a6b-1c2d3e4f5a6b",
        "role": "ROLE_USER",
        "parts": [{ "text": "Renew my PO Box 50500 in Dubai for one more year, same bundle and options." }],
        "metadata": {
          "${IDENTITY_URI}": { "persona": "ahmed-al-mansoori" },
          "locale": "en"
        }
      }
    }
  }'`;

export const sendResponse = `{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "task": {
      "id": "7d2e9a40-3c1b-4f6e-8a2d-5b9c0e1f2a3b",
      "contextId": "c1a2b3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
      "status": {
        "state": "TASK_STATE_INPUT_REQUIRED",
        "timestamp": "2026-10-15T08:12:44.120Z",
        "message": {
          "messageId": "a9b8c7d6-e5f4-4a3b-9c2d-1e0f9a8b7c6d",
          "role": "ROLE_AGENT",
          "contextId": "c1a2b3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
          "taskId": "7d2e9a40-3c1b-4f6e-8a2d-5b9c0e1f2a3b",
          "extensions": ["${REPLY_URI}"],
          "parts": [
            { "text": "Here is your renewal.\\n\\nRenewal summary\\nBox: 50500, Dubai\\nBundle: MyHome\\nTerm: 1 year\\nTotal: AED 695.00\\n\\nPay AED 695 with Card: {{HOST}}/api/payments/mock-checkout?ref=SBX-MGQ3K2A1-7F2Q&…\\n\\nOptions: Pay with Noqodi instead · Change the term" },
            {
              "data": {
                "blocks": [
                  { "type": "summary", "title": "Renewal summary", "rows": [{ "label": "Box", "value": "50500, Dubai" }, { "label": "Bundle", "value": "MyHome" }, { "label": "Term", "value": "1 year" }], "total": { "label": "Total", "value": "AED 695.00" } },
                  { "type": "pay", "url": "{{HOST}}/api/payments/mock-checkout?ref=SBX-MGQ3K2A1-7F2Q&…", "amount": "AED 695.00", "label": "Pay AED 695 with Card" },
                  { "type": "buttons", "options": ["Pay with Noqodi instead", "Change the term"], "reply": "Send the option's text as the next message." }
                ],
                "case": {
                  "journey": "personal_po_box_renewal",
                  "step": "identify",
                  "status": "ready",
                  "reference": null,
                  "collected": { "po_box_number": "50500", "emirate": "DXB", "renewal_period": "1_YEAR", "payment_method": "gateway", "terms_accepted": true },
                  "missing": [],
                  "documents": [],
                  "payment": { "status": "initiated", "reference": "SBX-MGQ3K2A1-7F2Q", "amount": 695, "currency": "AED" }
                },
                "awaiting": "payment"
              },
              "mediaType": "application/json"
            }
          ]
        }
      },
      "artifacts": [
        { "artifactId": "3b1c…", "name": "payment-request", "description": "A payment the customer must make before the request completes. …", "parts": [{ "data": { "reference": "SBX-MGQ3K2A1-7F2Q", "amount": 695, "currency": "AED", "url": "{{HOST}}/api/payments/mock-checkout?ref=SBX-MGQ3K2A1-7F2Q&…", "provider": "emirates-post-gateway", "method": "card", "sandbox": { "settleUrl": "{{HOST}}/a2a/po-box-sandbox/sandbox/payments/SBX-MGQ3K2A1-7F2Q/settle", "note": "Sandbox only. No money moves; the order is marked paid and the task continues by itself." } }, "mediaType": "application/json" }] }
      ],
      "history": [ { "…": "the customer's message, then the agent's" } ],
      "metadata": {
        "awaiting": "payment",
        "agent": "po-box-sandbox",
        "persona": "ahmed-al-mansoori",
        "journey": "personal_po_box_renewal",
        "locale": "en",
        "paymentReference": "SBX-MGQ3K2A1-7F2Q"
      }
    }
  }
}`;

export const followUpCurl = `# The next message of the same task: contextId AND taskId
curl -s -X POST {{HOST}}/a2a/po-box-sandbox \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "A2A-Version: 1.0" \\
  -H "Content-Type: application/json" \\
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "SendMessage",
    "params": {
      "message": {
        "messageId": "4c5d6e7f-8a9b-4c0d-9e1f-2a3b4c5d6e7f",
        "role": "ROLE_USER",
        "contextId": "c1a2b3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
        "taskId": "7d2e9a40-3c1b-4f6e-8a2d-5b9c0e1f2a3b",
        "parts": [{ "text": "Change the term" }]
      }
    }
  }'`;

export const getTaskCurl = `curl -s -X POST {{HOST}}/a2a/po-box-sandbox \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "A2A-Version: 1.0" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":3,"method":"GetTask","params":{"id":"7d2e9a40-3c1b-4f6e-8a2d-5b9c0e1f2a3b","historyLength":0}}'`;

export const settleCurl = `# sandbox.settleUrl from the payment-request artifact, the same Authorization header
curl -s -X POST "{{HOST}}/a2a/po-box-sandbox/sandbox/payments/SBX-MGQ3K2A1-7F2Q/settle" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"outcome":"paid"}'`;

export const settleResponse = `{
  "ok": true,
  "reference": "SBX-MGQ3K2A1-7F2Q",
  "outcome": "paid",
  "idempotent": false,
  "note": "Any task waiting for this payment continues by itself; poll GetTask or subscribe."
}`;

export const returnImmediately = `{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "SendMessage",
  "params": {
    "message": { "messageId": "…", "role": "ROLE_USER", "parts": [{ "text": "Which branches are near Al Barsha?" }], "metadata": { "${IDENTITY_URI}": { "persona": "guest" } } },
    "configuration": { "returnImmediately": true, "historyLength": 0 }
  }
}
// → result.task.status.state is "TASK_STATE_WORKING"; follow with SubscribeToTask or GetTask.`;

export const nodeSample = `// Node.js 20+: fetch and crypto are built in.
const HOST = "{{HOST}}";
const AGENT = \`\${HOST}/a2a/po-box-sandbox\`;
const IDENTITY = "${IDENTITY_URI}";

// 1. A token (valid for one hour)
const basic = Buffer.from(\`\${process.env.CLIENT_ID}:\${process.env.CLIENT_SECRET}\`).toString("base64");
const tokenRes = await fetch(\`\${HOST}/a2a/oauth/token\`, {
  method: "POST",
  headers: { Authorization: \`Basic \${basic}\`, "Content-Type": "application/x-www-form-urlencoded" },
  body: "grant_type=client_credentials&scope=tasks",
});
const { access_token } = await tokenRes.json();
const headers = { Authorization: \`Bearer \${access_token}\`, "A2A-Version": "1.0", "Content-Type": "application/json" };

// 2. One JSON-RPC call
let n = 0;
async function rpc(method, params) {
  const res = await fetch(AGENT, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method, params }) });
  const body = await res.json();
  if (body.error) throw new Error(\`\${body.error.code} \${body.error.message}\`);
  return body.result;
}

// 3. Start a task. The first message carries the citizen identity.
const message = (text, ids = {}) => ({
  messageId: crypto.randomUUID(),
  role: "ROLE_USER",
  parts: [{ text }],
  metadata: { [IDENTITY]: { persona: "ahmed-al-mansoori" }, locale: "en" },
  ...ids,
});
let { task } = await rpc("SendMessage", { message: message("Renew my PO Box 50500 in Dubai for one more year, same bundle and options.") });
const ids = { contextId: task.contextId, taskId: task.id };
console.log(task.status.state, "\\n" + task.status.message.parts[0].text);

// 4. The reply has text and blocks. Show them to the customer and send their answer
//    with the same ids. Here the sample confirms once if the agent asked something.
if (task.metadata.awaiting === "input") {
  ({ task } = await rpc("SendMessage", { message: message("Yes, one year, same bundle, pay with card.", ids) }));
}

// 5. Settle the sandbox payment, then watch the task finish on its own.
const payment = task.artifacts.find((a) => a.name === "payment-request")?.parts[0].data;
if (payment?.sandbox) {
  await fetch(payment.sandbox.settleUrl, { method: "POST", headers, body: JSON.stringify({ outcome: "paid" }) });
  do {
    await new Promise((r) => setTimeout(r, 3000));
    task = await rpc("GetTask", { id: ids.taskId, historyLength: 0 });
  } while (task.status.state === "TASK_STATE_WORKING" || task.metadata.awaiting === "payment");
}
console.log(task.status.state, task.artifacts.find((a) => a.name === "service-outcome")?.parts[0].data);`;

export const pythonSample = `import os, time, uuid, requests

HOST = "{{HOST}}"
AGENT = f"{HOST}/a2a/po-box-sandbox"
IDENTITY = "${IDENTITY_URI}"

# 1. A token (valid for one hour)
token = requests.post(
    f"{HOST}/a2a/oauth/token",
    auth=(os.environ["CLIENT_ID"], os.environ["CLIENT_SECRET"]),
    data={"grant_type": "client_credentials", "scope": "tasks"},
).json()["access_token"]
headers = {"Authorization": f"Bearer {token}", "A2A-Version": "1.0", "Content-Type": "application/json"}

# 2. One JSON-RPC call
counter = iter(range(1, 10**6))
def rpc(method, params):
    body = requests.post(AGENT, headers=headers, json={"jsonrpc": "2.0", "id": next(counter), "method": method, "params": params}).json()
    if "error" in body:
        raise RuntimeError(f"{body['error']['code']} {body['error']['message']}")
    return body["result"]

# 3. Start a task. The first message carries the citizen identity.
def message(text, **ids):
    return {
        "messageId": str(uuid.uuid4()),
        "role": "ROLE_USER",
        "parts": [{"text": text}],
        "metadata": {IDENTITY: {"persona": "ahmed-al-mansoori"}, "locale": "en"},
        **ids,
    }

task = rpc("SendMessage", {"message": message("Renew my PO Box 50500 in Dubai for one more year, same bundle and options.")})["task"]
ids = {"contextId": task["contextId"], "taskId": task["id"]}
print(task["status"]["state"], task["status"]["message"]["parts"][0]["text"], sep="\\n")

# 4. Answer the agent with the same ids while it asks for input (one confirmation here).
if task["metadata"].get("awaiting") == "input":
    task = rpc("SendMessage", {"message": message("Yes, one year, same bundle, pay with card.", **ids)})["task"]

# 5. Settle the sandbox payment, then watch the task finish on its own.
payment = next((a for a in task.get("artifacts", []) if a["name"] == "payment-request"), None)
if payment:
    settle_url = payment["parts"][0]["data"]["sandbox"]["settleUrl"]
    requests.post(settle_url, headers=headers, json={"outcome": "paid"})
    while True:
        time.sleep(3)
        task = rpc("GetTask", {"id": ids["taskId"], "historyLength": 0})
        if task["status"]["state"] != "TASK_STATE_WORKING" and task["metadata"].get("awaiting") != "payment":
            break
print(task["status"]["state"])`;

export const agentMessage = `{
  "messageId": "a9b8c7d6-e5f4-4a3b-9c2d-1e0f9a8b7c6d",
  "role": "ROLE_AGENT",
  "contextId": "c1a2b3d4-…",
  "taskId": "7d2e9a40-…",
  "extensions": ["${REPLY_URI}"],
  "parts": [
    { "text": "Which emirate would you like the box in?\\n\\nOptions: Dubai · Abu Dhabi · Sharjah · Ajman · Umm Al Quwain · Ras Al Khaimah · Fujairah" },
    {
      "data": {
        "blocks": [
          { "type": "buttons", "options": ["Dubai", "Abu Dhabi", "Sharjah", "Ajman", "Umm Al Quwain", "Ras Al Khaimah", "Fujairah"], "reply": "Send the option's text as the next message." }
        ],
        "case": {
          "journey": "personal_po_box_rental",
          "step": "identify",
          "status": "draft",
          "reference": null,
          "collected": { "contact_name": "Ahmed Al Mansoori" },
          "missing": [ { "key": "emirate", "kind": "field" }, { "key": "po_box_number", "kind": "field" } ],
          "documents": [],
          "payment": { "status": "none", "reference": null, "amount": null, "currency": "AED" }
        },
        "awaiting": "input"
      },
      "mediaType": "application/json"
    }
  ]
}`;

export const blocksJson = `[
  { "type": "pay", "url": "https://…/api/payments/mock-checkout?ref=SBX-…", "amount": "AED 695.00", "label": "Pay AED 695 with Card" },
  { "type": "buttons", "options": ["Pay with Noqodi instead", "Change the term"], "reply": "Send the option's text as the next message." },
  { "type": "select", "title": "Choose a branch", "options": [{ "label": "Al Barsha", "group": "Dubai" }, { "label": "Deira", "group": "Dubai" }], "confirm": "Continue", "reply": "Send the chosen option's text as the next message." },
  { "type": "toggles", "title": "Before you pay", "style": "checkbox", "items": [{ "key": "terms", "label": "I accept the Terms" }, { "key": "autorenew", "label": "Renew automatically each year" }], "confirm": ["Continue to payment", "Cancel"],
    "reply": "Send each choice as \\"<label>: Yes\\" or \\"<label>: No\\", then the confirm label, for example: I accept the Terms: Yes. Renew automatically each year: Yes. Continue to payment." },
  { "type": "summary", "title": "Renewal summary", "rows": [{ "label": "Box", "value": "50500, Dubai" }], "total": { "label": "Total", "value": "AED 695.00" } },
  { "type": "cards", "cards": [{ "title": "MyHome", "price": "AED 695 / year", "priceNote": "incl. VAT", "desc": "Personal box with home delivery", "badge": "Popular", "disabled": false, "attrs": [{ "label": "Deliveries", "value": "2 a month" }] }], "reply": "Send the card's title as the next message." },
  { "type": "map", "emirate": "DUBAI", "bundle": "MyHome", "reply": "Branches are listed by name; send a branch name as the next message." },
  { "type": "locate", "label": "Share your location", "reply": "Send an address or 'latitude, longitude' as the next message." },
  { "type": "upload", "document": "Authorised agent's Emirates ID", "reply": "File parts are not accepted on this doorway; say the document is not available or continue without it." }
]`;

export const identityMeta = `"metadata": {
  "${IDENTITY_URI}": { "persona": "ahmed-al-mansoori" },
  "locale": "en"
}

// Emirates Post's own channels, outside the sandbox: a host session token instead of a persona
"metadata": {
  "${IDENTITY_URI}": { "hostToken": "<Emirates Post host session token>" }
}`;

export const authRequired = `// 1. A guest asks for something that needs the customer signed in
{ "message": { "messageId": "…", "role": "ROLE_USER", "parts": [{ "text": "I want to rent a new PO Box" }],
               "metadata": { "${IDENTITY_URI}": { "persona": "guest" } } } }

// → the task rests in TASK_STATE_AUTH_REQUIRED
{ "id": "e2f3…", "contextId": "9a8b…", "status": { "state": "TASK_STATE_AUTH_REQUIRED", "message": { "parts": [{ "text": "To rent a new PO Box, please sign in with UAE PASS…" }, { "data": { "awaiting": "auth", "…": "…" } }] } },
  "metadata": { "awaiting": "auth", "agent": "po-box-sandbox", "persona": "guest", "locale": "en" } }

// 2. Resend to the SAME task with a signed-in identity. An empty text is allowed here:
//    the sign-in happens and the agent shows the account instead of answering a message.
{ "message": { "messageId": "…", "role": "ROLE_USER", "contextId": "9a8b…", "taskId": "e2f3…", "parts": [{ "text": "" }],
               "metadata": { "${IDENTITY_URI}": { "persona": "ahmed-al-mansoori" } } } }

// 3. Or carry on in words; the identity is applied first, then the message is answered.
{ "message": { "messageId": "…", "role": "ROLE_USER", "contextId": "9a8b…", "taskId": "e2f3…", "parts": [{ "text": "I want to rent a new PO Box in Dubai" }],
               "metadata": { "${IDENTITY_URI}": { "persona": "ahmed-al-mansoori" } } } }`;

export const paymentRequestArtifact = `{
  "artifactId": "3b1c7e2d-9f4a-4b6c-8d0e-1f2a3b4c5d6e",
  "name": "payment-request",
  "description": "A payment the customer must make before the request completes. Open \`url\` to pay; in the sandbox, POST to \`sandbox.settleUrl\` to settle it without a browser.",
  "parts": [
    {
      "data": {
        "reference": "SBX-MGQ3K2A1-7F2Q",
        "amount": 695,
        "currency": "AED",
        "url": "{{HOST}}/api/payments/mock-checkout?ref=SBX-MGQ3K2A1-7F2Q&caseId=…&lang=en",
        "provider": "emirates-post-gateway",
        "method": "card",
        "sandbox": {
          "settleUrl": "{{HOST}}/a2a/po-box-sandbox/sandbox/payments/SBX-MGQ3K2A1-7F2Q/settle",
          "note": "Sandbox only. No money moves; the order is marked paid and the task continues by itself."
        }
      },
      "mediaType": "application/json"
    }
  ]
}`;

export const serviceOutcomeArtifact = `{
  "artifactId": "8e7d6c5b-4a39-4281-9f0e-1d2c3b4a5968",
  "name": "service-outcome",
  "description": "The result of the service request: its reference with Emirates Post, what was collected, and the payment.",
  "parts": [
    {
      "data": {
        "journey": "personal_po_box_renewal",
        "reference": "SBX-MGQ3K2A1-7F2Q",
        "orderNo": "SBX17604800",
        "receiptUrl": "{{HOST}}/api/receipt/SBX-MGQ3K2A1-7F2Q",
        "payment": { "status": "paid", "reference": "SBX-MGQ3K2A1-7F2Q", "amount": 695, "currency": "AED" },
        "collected": { "po_box_number": "50500", "emirate": "DXB", "renewal_period": "1_YEAR", "payment_method": "gateway", "terms_accepted": true }
      },
      "mediaType": "application/json"
    }
  ]
}`;

export const escalationArtifact = `{
  "artifactId": "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  "name": "escalation",
  "description": "The request was handed to a person at Emirates Post, who will call the customer back.",
  "parts": [
    { "data": { "reference": "ENQ-20261015-0042", "journey": "manage_po_box" }, "mediaType": "application/json" }
  ]
}`;

export const streamCurl = `curl -sN -X POST {{HOST}}/a2a/po-box-sandbox \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "A2A-Version: 1.0" \\
  -H "Content-Type: application/json" \\
  -H "Accept: text/event-stream" \\
  -d '{
    "jsonrpc": "2.0",
    "id": 7,
    "method": "SendStreamingMessage",
    "params": {
      "message": {
        "messageId": "b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e",
        "role": "ROLE_USER",
        "parts": [{ "text": "Which emirates can I rent a PO Box in?" }],
        "metadata": { "${IDENTITY_URI}": { "persona": "guest" } }
      }
    }
  }'`;

export const streamFrames = `data: {"jsonrpc":"2.0","id":7,"result":{"task":{"id":"5f6e…","contextId":"d4c3…","status":{"state":"TASK_STATE_WORKING","timestamp":"2026-10-15T08:20:01.004Z"},"history":[…],"artifacts":[],"metadata":{"awaiting":null,"agent":"po-box-sandbox","persona":"guest","locale":"en"}}}}

data: {"jsonrpc":"2.0","id":7,"result":{"statusUpdate":{"taskId":"5f6e…","contextId":"d4c3…","status":{"state":"TASK_STATE_WORKING","timestamp":"…","message":{"messageId":"…","role":"ROLE_AGENT","parts":[{"text":"You can rent a PO Box in all seven emirates"}],"metadata":{"partial":true}}}}}}

data: {"jsonrpc":"2.0","id":7,"result":{"statusUpdate":{"taskId":"5f6e…","contextId":"d4c3…","status":{"state":"TASK_STATE_WORKING","timestamp":"…","message":{"messageId":"…","role":"ROLE_AGENT","parts":[{"text":"You can rent a PO Box in all seven emirates: Dubai, Abu Dhabi, Sharjah, …"}],"metadata":{"partial":true}}}}}}

: ping

data: {"jsonrpc":"2.0","id":7,"result":{"artifactUpdate":{"taskId":"5f6e…","contextId":"d4c3…","artifact":{"artifactId":"…","name":"payment-request","parts":[…]},"lastChunk":true}}}

data: {"jsonrpc":"2.0","id":7,"result":{"statusUpdate":{"taskId":"5f6e…","contextId":"d4c3…","status":{"state":"TASK_STATE_INPUT_REQUIRED","timestamp":"…","message":{"messageId":"…","role":"ROLE_AGENT","extensions":["${REPLY_URI}"],"parts":[{"text":"…"},{"data":{"blocks":[…],"case":{…},"awaiting":"input"},"mediaType":"application/json"}]}}}}}`;

export const subscribeCurl = `curl -sN -X POST {{HOST}}/a2a/po-box-sandbox \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "A2A-Version: 1.0" \\
  -H "Content-Type: application/json" \\
  -H "Accept: text/event-stream" \\
  -d '{"jsonrpc":"2.0","id":8,"method":"SubscribeToTask","params":{"id":"7d2e9a40-3c1b-4f6e-8a2d-5b9c0e1f2a3b"}}'`;

export const restStreamFrame = `# REST binding: the bare StreamResponse, no JSON-RPC envelope
data: {"statusUpdate":{"taskId":"5f6e…","contextId":"d4c3…","status":{"state":"TASK_STATE_INPUT_REQUIRED","timestamp":"…","message":{…}}}}

# an error after the stream has opened
data: {"error":{"code":-32004,"message":"This operation is not supported: the task is TASK_STATE_COMPLETED; nothing more will happen on it","data":[…]}}`;

export const listTasksCurl = `curl -s -X POST {{HOST}}/a2a/po-box-sandbox \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "A2A-Version: 1.0" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":9,"method":"ListTasks","params":{"contextId":"c1a2b3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d","pageSize":20,"includeArtifacts":false}}'`;

export const listTasksResponse = `{
  "jsonrpc": "2.0",
  "id": 9,
  "result": {
    "tasks": [ { "id": "…", "contextId": "…", "status": { "state": "TASK_STATE_COMPLETED", "…": "…" }, "metadata": { "…": "…" } } ],
    "nextPageToken": "",
    "pageSize": 20,
    "totalSize": 1
  }
}`;

export const restSendCurl = `curl -s -X POST {{HOST}}/a2a/po-box-sandbox/rest/message:send \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "A2A-Version: 1.0" \\
  -H "Content-Type: application/json" \\
  -d '{
    "message": {
      "messageId": "c9d8e7f6-a5b4-4c3d-9e2f-1a0b9c8d7e6f",
      "role": "ROLE_USER",
      "parts": [{ "text": "How much is a PO Box in Abu Dhabi?" }],
      "metadata": { "${IDENTITY_URI}": { "persona": "guest" } }
    }
  }'
# → { "task": { … } }

curl -s "{{HOST}}/a2a/po-box-sandbox/rest/tasks/7d2e9a40-3c1b-4f6e-8a2d-5b9c0e1f2a3b?historyLength=2" \\
  -H "Authorization: Bearer $TOKEN" -H "A2A-Version: 1.0"
# → the Task object itself`;

export const restError = `HTTP/1.1 404 Not Found
Content-Type: application/json; charset=utf-8

{
  "error": {
    "code": -32001,
    "status": "TaskNotFound",
    "message": "Task not found",
    "details": [
      { "@type": "type.googleapis.com/google.rpc.ErrorInfo", "reason": "TASK_NOT_FOUND", "domain": "a2a-protocol.org", "metadata": { "taskId": "…", "timestamp": "2026-10-15T08:30:00.000Z" } }
    ]
  }
}`;

export const rpcError = `{
  "jsonrpc": "2.0",
  "id": 2,
  "error": {
    "code": -32004,
    "message": "This operation is not supported: the task is TASK_STATE_COMPLETED; start a new task in the same contextId instead",
    "data": [
      {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        "reason": "UNSUPPORTED_OPERATION",
        "domain": "a2a-protocol.org",
        "metadata": { "taskId": "7d2e9a40-…", "state": "TASK_STATE_COMPLETED", "timestamp": "2026-10-15T08:31:12.410Z" }
      }
    ]
  }
}`;

export const tokenErrors = `HTTP 401  { "error": "invalid_client",          "error_description": "Unknown client or wrong secret." }
HTTP 400  { "error": "unsupported_grant_type",  "error_description": "Only client_credentials is supported." }
HTTP 400  { "error": "invalid_scope",           "error_description": "Not granted to this client: admin" }
HTTP 400  { "error": "invalid_request",         "error_description": "The body could not be read." }`;

export const personasCurl = `curl -s {{HOST}}/a2a/po-box-sandbox/sandbox/personas
# → { "personas": [ { "id": "ahmed-al-mansoori", "label": "Ahmed Al Mansoori", "description": "…", "signedIn": true }, { "id": "guest", … } ] }`;
