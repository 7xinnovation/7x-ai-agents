/**
 * The citizen's identity, arriving inside the task.
 *
 * A2A authenticates the CALLING AGENT (the application's credentials). The
 * citizen the task is about is a separate identity, carried in the message
 * under the citizen-identity extension. In production that is an assertion
 * from the agent that signed them in; in the sandbox it is a test persona,
 * applied to the conversation the way the UAE PASS callback applies a real one:
 * the conversation is marked signed in, the verified Emirates ID is written on
 * the case, and the profile's name and contact details are seeded so the agent
 * never asks for what it was handed.
 */
import { A2AError } from "@dialog/core";
import { markAuthenticated, rememberVerifiedEmiratesId, mutateCase } from "@/lib/conversation";
import { contactSeed } from "@/lib/knownContact";
import { MOCK_PERSONA_SUB, MOCK_PERSONA_NAME, MOCK_PERSONA_EID, MOCK_PERSONA_CONTACT } from "@/lib/mockPersona";
import { CITIZEN_IDENTITY_EXTENSION, type A2AAgentEntry } from "./catalogue";

export interface CitizenIdentity {
  persona?: string;
  /** An Emirates Post host session token, as their app passes it to the widget. */
  hostToken?: string;
}

/** The identity object in a message's metadata, under the extension URI or the short key `citizen`. */
export function citizenIdentityIn(metadata: Record<string, unknown> | undefined): CitizenIdentity | null {
  if (!metadata) return null;
  const raw = (metadata[CITIZEN_IDENTITY_EXTENSION] ?? metadata.citizen) as unknown;
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const out: CitizenIdentity = {};
  if (typeof o.persona === "string" && o.persona.trim()) out.persona = o.persona.trim().toLowerCase();
  if (typeof o.hostToken === "string" && o.hostToken.trim()) out.hostToken = o.hostToken.trim();
  return out.persona || out.hostToken ? out : null;
}

export interface AppliedIdentity {
  kind: "persona" | "host_token" | "none";
  persona?: string;
  /** Passed to the engine, which verifies it the way it verifies the widget's. */
  uaePassToken?: string;
  /** True when a sign-in happened on this message. */
  signedIn: boolean;
}

export async function applyCitizenIdentity(input: {
  entry: A2AAgentEntry;
  conversationId: string;
  caseId: string;
  alreadyAuthenticated: boolean;
  identity: CitizenIdentity | null;
}): Promise<AppliedIdentity> {
  const { entry, identity } = input;
  if (!identity) return { kind: "none", signedIn: false };

  if (identity.hostToken) return { kind: "host_token", uaePassToken: identity.hostToken, signedIn: false };

  const persona = entry.personas.find((p) => p.id === identity.persona);
  if (!persona) {
    throw new A2AError("InvalidParamsError", `unknown persona "${identity.persona}"; the Agent Card lists the personas this agent accepts`, {
      personas: entry.personas.map((p) => p.id),
    });
  }
  if (!entry.sandbox) throw new A2AError("InvalidParamsError", "personas are accepted by sandbox agents only");
  if (!persona.signedIn) return { kind: "persona", persona: persona.id, signedIn: false };
  if (input.alreadyAuthenticated) return { kind: "persona", persona: persona.id, signedIn: false };

  // The same three writes the mock UAE PASS callback makes.
  await markAuthenticated(input.conversationId, MOCK_PERSONA_SUB);
  await rememberVerifiedEmiratesId(input.caseId, MOCK_PERSONA_EID);
  try {
    await mutateCase(input.caseId, (st) => {
      const seed = contactSeed(st, { mobile: MOCK_PERSONA_CONTACT.mobile, email: MOCK_PERSONA_CONTACT.email, name: MOCK_PERSONA_NAME });
      return Object.keys(seed).length ? { ...st, data: { ...st.data, ...seed } } : st;
    });
  } catch {
    /* the sign-in has happened; the seed is a convenience */
  }
  return { kind: "persona", persona: persona.id, signedIn: true };
}
