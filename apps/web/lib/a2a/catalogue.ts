/**
 * The agents this deployment exposes over A2A, and the Agent Card each one
 * publishes.
 *
 * An A2A agent is a Dialog agent seen from outside: the same engine, journeys,
 * tools and governance, reached through the protocol's task doorway instead of
 * the chat widget. The entry says which Dialog agent does the work and whether
 * the doorway runs it in sandbox mode (simulated Emirates Post session, payable
 * mock checkout, test personas).
 */
import type { AgentCard, AgentSkill } from "@dialog/core";
import { A2A_PROTOCOL_VERSION } from "@dialog/core";
import { uaePassMockAllowed } from "@/lib/uaepass";

/**
 * The citizen's identity travelling INSIDE the task — the position the AGSP
 * brief takes. A front-door agent that signed the citizen in asserts who they
 * are and what they agreed to; the receiving agent never sees their UAE PASS
 * token. In the sandbox the assertion is replaced by a test persona.
 */
export const CITIZEN_IDENTITY_EXTENSION = "https://agent.7x.ae/a2a/extensions/citizen-identity/v1";

/**
 * The structured companion to every reply: the interactive blocks the agent
 * offered (buttons, a payment, a summary), the state of the case (what has
 * been collected, what is still missing), and what the task is waiting for.
 */
export const DIALOG_REPLY_EXTENSION = "https://agent.7x.ae/a2a/extensions/dialog-reply/v1";

export interface SandboxPersona {
  id: string;
  label: string;
  description: string;
  signedIn: boolean;
}

export interface A2AAgentEntry {
  /** The key in URLs: /a2a/{key}. */
  key: string;
  /** The Dialog agent slug behind it. */
  dialogSlug: string;
  /** Run the engine in sandbox mode: simulated Emirates Post session and payable mock checkout. */
  sandbox: boolean;
  name: string;
  description: string;
  version: string;
  skills: AgentSkill[];
  personas: SandboxPersona[];
}

export const SANDBOX_PERSONAS: SandboxPersona[] = [
  {
    id: "ahmed-al-mansoori",
    label: "Ahmed Al Mansoori",
    description:
      "A signed-in customer (UAE PASS) with two PO Boxes on file: 50500 in Dubai (MyHome, AED 695 a year, auto-renewal off) and 33417 in Abu Dhabi (MyBox, AED 300 a year, expired, auto-renewal on, a saved card). Use this persona to renew, to manage a box, or to rent a new one as an existing customer.",
    signedIn: true,
  },
  {
    id: "guest",
    label: "Guest",
    description:
      "No sign-in. The agent answers questions and runs the guest renewal by box number; a new rental asks for sign-in, which the task reports as TASK_STATE_AUTH_REQUIRED until an identity is supplied.",
    signedIn: false,
  },
];

const PO_BOX_SKILLS: AgentSkill[] = [
  {
    id: "po-box-registration",
    name: "Rent a new PO Box",
    description:
      "Rents a personal or corporate PO Box with Emirates Post: bundle, emirate and branch, box number, term, optional authorised agent and key delivery, then the order and its payment. Needs a signed-in citizen.",
    tags: ["po-box", "rental", "registration", "emirates-post"],
    examples: ["I want to rent a PO Box in Dubai", "Rent a MyHome box for two years in Sharjah"],
    inputModes: ["text/plain", "application/json"],
    outputModes: ["text/plain", "application/json"],
  },
  {
    id: "po-box-renewal",
    name: "Renew a PO Box",
    description:
      "Renews an existing PO Box for one or more years, on the current bundle or an upgrade, and takes the payment. Works for a signed-in customer's boxes on file and for a guest who gives the box number and emirate.",
    tags: ["po-box", "renewal", "emirates-post"],
    examples: ["Renew my PO Box 50500 in Dubai for one more year, same bundle and options", "I need to renew box 33417 in Abu Dhabi"],
    inputModes: ["text/plain", "application/json"],
    outputModes: ["text/plain", "application/json"],
  },
  {
    id: "po-box-management",
    name: "Manage an existing PO Box",
    description: "Status, expiry, auto-renewal, authorised agents and linking a trade licence for a box the signed-in customer holds.",
    tags: ["po-box", "account", "auto-renewal"],
    examples: ["Switch on auto-renewal for my Dubai box", "When does my PO Box expire?"],
    inputModes: ["text/plain", "application/json"],
    outputModes: ["text/plain", "application/json"],
  },
  {
    id: "po-box-enquiry",
    name: "PO Box questions",
    description: "Prices and bundles, branches and their hours, what a PO Box includes, how delivery works, and tracking a shipment.",
    tags: ["po-box", "faq", "branches", "pricing", "tracking"],
    examples: ["How much is a PO Box in Abu Dhabi?", "Which branches are near Al Barsha?"],
    inputModes: ["text/plain", "application/json"],
    outputModes: ["text/plain", "application/json"],
  },
];

export const A2A_AGENTS: Record<string, A2AAgentEntry> = {
  "po-box-sandbox": {
    key: "po-box-sandbox",
    dialogSlug: "po-box-sandbox",
    sandbox: true,
    name: "Emirates Post PO Box Agent (Sandbox)",
    description:
      "Rents, renews and manages Emirates Post PO Boxes, end to end, in a sandbox: Emirates Post's own staging data for bundles, branches and prices, a simulated reservation and order, and a payable mock checkout. Built on Dialog by 7X Innovation Studio. No real box is rented and no money moves.",
    version: "2026.10.14",
    skills: PO_BOX_SKILLS,
    personas: SANDBOX_PERSONAS,
  },
};

export const DEFAULT_AGENT_KEY = "po-box-sandbox";

/**
 * Sandbox agents exist only where the deployment allows simulation
 * (UAEPASS_MOCK / UAEPASS_MOCK_ALLOWED). Elsewhere — production — the
 * simulation is off, so a "sandbox" task would reach Emirates Post's live
 * systems; the agent is therefore not served at all there (2026-10-16).
 */
export function agentEntry(key: string | undefined | null): A2AAgentEntry | null {
  if (!key) return null;
  const entry = A2A_AGENTS[key] ?? null;
  if (entry?.sandbox && !uaePassMockAllowed()) return null;
  return entry;
}

export function restBase(origin: string, entry: A2AAgentEntry): string {
  return `${origin}/a2a/${entry.key}/rest`;
}

/** The Agent Card, with every URL on the origin the card was fetched from. */
export function buildAgentCard(entry: A2AAgentEntry, origin: string): AgentCard {
  return {
    name: entry.name,
    description: entry.description,
    supportedInterfaces: [
      { url: `${origin}/a2a/${entry.key}`, protocolBinding: "JSONRPC", protocolVersion: A2A_PROTOCOL_VERSION },
      { url: restBase(origin, entry), protocolBinding: "HTTP+JSON", protocolVersion: A2A_PROTOCOL_VERSION },
    ],
    provider: { organization: "7X Innovation Studio · Emirates Post Group", url: "https://7x.ae" },
    version: entry.version,
    documentationUrl: `${origin}/developers/docs`,
    capabilities: {
      streaming: true,
      pushNotifications: false,
      extendedAgentCard: false,
      extensions: [
        {
          uri: CITIZEN_IDENTITY_EXTENSION,
          description:
            "The citizen's identity and consent travel inside the task. Send message.metadata[uri] = { persona } in the sandbox, or { hostToken } with an Emirates Post host session token. Required by the rental and management skills; without it the task reports TASK_STATE_AUTH_REQUIRED.",
          required: false,
          params: entry.sandbox ? { personas: entry.personas.map((p) => ({ id: p.id, signedIn: p.signedIn })) } : {},
        },
        {
          uri: DIALOG_REPLY_EXTENSION,
          description:
            "Every agent message carries, after its text part, a data part with the interactive blocks offered (buttons, payment, summary, cards), the case so far (collected fields, what is missing, payment) and what the task is waiting for.",
          required: false,
        },
      ],
    },
    securitySchemes: {
      oauth2: {
        oauth2SecurityScheme: {
          description: "OAuth 2.0 client credentials. Create an application in the developer portal to get a client_id and client_secret.",
          flows: {
            clientCredentials: {
              tokenUrl: `${origin}/a2a/oauth/token`,
              scopes: { tasks: "Send messages to the agent and read the tasks your application created" },
            },
          },
        },
      },
      apiKey: {
        apiKeySecurityScheme: {
          description: "The application's API key, from the developer portal.",
          location: "header",
          name: "X-API-Key",
        },
      },
    },
    securityRequirements: [{ schemes: { oauth2: { list: ["tasks"] } } }, { schemes: { apiKey: { list: [] } } }],
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain", "application/json"],
    skills: entry.skills,
  };
}
