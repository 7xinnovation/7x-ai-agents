import { epglAuth } from "./epglRead";
import type { EnvKey } from "./integrations";

/**
 * A callback request, as a Case in EPGL's own Salesforce.
 *
 * Until now an EPGL applicant who asked to speak to someone got a sentence.
 * `opsCrm.createCallback` raises a case on emiratespost.ae's contact form and
 * falls back to a PO Box ops mailbox — both of which are the POSTAL side of the
 * business. Whoever answers there cannot help with a postal activity licence,
 * and the mailbox is unset in every environment anyway, so the callback failed
 * and the assistant told the applicant to contact Emirates Post "through their
 * usual channel" without naming one, because inventing a number for a
 * government service is worse than admitting we do not have one.
 *
 * Emirates Post Group Licensing supplied the route on 19 September: a Case on
 * the Callback record type, through the standard Salesforce REST API. It lands
 * in the queue their licensing team already works and gives the applicant a
 * reference they can quote.
 *
 * NOTHING NEW IS PROVISIONED. It is the same org, the same connected app and the
 * same run-as user as the licence submission — verified against PreProd2 today:
 * the integration's token resolves to ai.agent@epg.ae.preprod, which is the user
 * the Callback_Case_API permission set was assigned to, and Case describes as
 * createable for it.
 */

/**
 * WHICH RECORD TYPE, ASKED OF THE ORG RATHER THAN CONFIGURED.
 *
 * The collection names `012FW001nRU85B6YQJ`, and that id is PreProd2's. A
 * sandbox id compiled into the product is a production outage waiting for the
 * day someone points us at the live org, and there is no reason to hold one:
 * the Case describe lists every record type this user may use, by name, in
 * whatever org the token belongs to.
 *
 * Read from `describe`, NOT from `SELECT ... FROM RecordType` — which the
 * collection implies would work and which, checked today, does not: the query
 * returns five record types for this user and Callback is not among them, while
 * the describe returns it with `available: true`. Access to the RecordType
 * object is not the same permission as access to the record type.
 */
const CALLBACK_RECORD_TYPE = "Callback";

/**
 * The one thing worth saying when this fails, because the fix is not here.
 *
 * Whether Case is invisible altogether (404) or visible without the Callback
 * record type, the cause is the same and it is an assignment in Salesforce.
 * Naming it saves whoever reads this log from looking in the product first.
 */
const permissionSetMissing = () =>
  `The "${CALLBACK_RECORD_TYPE}" Case record type is not available to the EPGL integration user in this org — ` +
  `the Callback_Case_API permission set has not been assigned to it there`;
const rtCache = new Map<string, { id: string; at: number }>();
const RT_TTL_MS = 60 * 60_000;

async function callbackRecordTypeId(agentId: string, env: EnvKey): Promise<string> {
  const key = `${agentId}:${env}`;
  const hit = rtCache.get(key);
  if (hit && Date.now() - hit.at < RT_TTL_MS) return hit.id;

  const auth = await epglAuth(agentId, env);
  const url = `${auth.baseUrl}/services/data/v62.0/sobjects/Case/describe`;
  const call = (bearer: string) => fetch(url, { headers: { Authorization: `Bearer ${bearer}`, Accept: "application/json" } });
  let res = await call(auth.bearer);
  if (res.status === 401) res = await call(await auth.retry());
  /**
   * 404 ON A DESCRIBE IS A PERMISSION, NOT A MISSING OBJECT.
   *
   * Checked against the LIVE org on 19 September, and this is the answer it
   * gives: `[{"errorCode":"NOT_FOUND","message":"The requested resource does not
   * exist"}]`. The collection says so itself — "a NOT_FOUND answer means the
   * token user has no access to the Case object" — and production's integration
   * user is `sf.integration@7x.ae.agentai`, a different user from PreProd2's
   * `ai.agent@epg.ae.preprod`, which is the one Callback_Case_API was assigned
   * to. So this is the failure production will actually hit, and it deserves the
   * message that names the fix rather than the one that reads as an outage.
   */
  if (res.status === 404 || res.status === 403) throw new Error(permissionSetMissing());
  if (!res.ok) throw new Error(`Could not read the Case object (HTTP ${res.status})`);

  const described = (await res.json()) as {
    recordTypeInfos?: { name?: string; recordTypeId?: string; available?: boolean }[];
  };
  const found = (described.recordTypeInfos ?? []).find(
    (r) => r.available && String(r.name ?? "").trim().toLowerCase() === CALLBACK_RECORD_TYPE.toLowerCase()
  );
  if (!found?.recordTypeId) throw new Error(permissionSetMissing());
  rtCache.set(key, { id: found.recordTypeId, at: Date.now() });
  return found.recordTypeId;
}

/**
 * What the licensing team should see this case as.
 *
 * Type is how their queue routes and reports, so a callback about a renewal
 * should not arrive as a generic question. Every value below was read off the
 * org's own picklist today; the field is unrestricted, which means a wrong value
 * would be ACCEPTED rather than rejected — so it is mapped from the journey here
 * rather than left to the model to phrase.
 */
export function caseTypeFor(journeyKey?: string | null): string {
  switch (journeyKey) {
    case "license_renewal":
      return "Renew Postal Activity License";
    case "license_new":
      return "Licensing";
    default:
      return "Question";
  }
}

export interface EpglCallbackInput {
  name: string;
  phone: string;
  email?: string;
  /** The customer's own words, with the handover context already appended. */
  description: string;
  journeyKey?: string | null;
}

export async function createEpglCallback(
  agentId: string,
  env: EnvKey,
  input: EpglCallbackInput
): Promise<{ reference: string }> {
  const recordTypeId = await callbackRecordTypeId(agentId, env);
  const auth = await epglAuth(agentId, env);

  /**
   * Only fields this user may actually create.
   *
   * The collection offers `AccountId` and `EPG_Postal_Licence_No__c` as optional
   * extras. Neither is available here: the describe lists AccountId as not
   * createable for this permission set, and there is no postal-licence field on
   * Case in the org at all. Salesforce rejects an unknown field outright, so
   * sending them on the strength of the documentation would fail every callback.
   * What the officer needs about the company travels in the description, which
   * is the part a person reads.
   */
  const body = {
    RecordTypeId: recordTypeId,
    Subject: `Callback request — ${caseTypeFor(input.journeyKey)}`,
    Description: input.description.slice(0, 30000),
    // The request reached us in a chat, and Origin is where it came FROM — not
    // how the customer would like to be reached.
    Origin: "Live Chat",
    Priority: "High",
    Type: caseTypeFor(input.journeyKey),
    SuppliedName: input.name,
    SuppliedPhone: input.phone,
    ...(input.email ? { SuppliedEmail: input.email } : {}),
  };

  const url = `${auth.baseUrl}/services/data/v62.0/sobjects/Case`;
  const call = (bearer: string) =>
    fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
  let res = await call(auth.bearer);
  if (res.status === 401) res = await call(await auth.retry());

  const json = (await res.json().catch(() => null)) as
    | { id?: string; success?: boolean }
    | { errorCode?: string; message?: string }[]
    | null;

  if (!res.ok || !json) {
    // Salesforce answers an array of {errorCode, message}. Keep their words:
    // "this ID value isn't valid for the user" is the whole diagnosis, and a
    // generic failure here would send someone looking in the wrong place.
    const detail = Array.isArray(json)
      ? json.map((e) => `${e.errorCode}: ${e.message}`).join(" | ")
      : `HTTP ${res.status}`;
    throw new Error(`Salesforce refused the callback case — ${detail}`.slice(0, 300));
  }
  const created = json as { id?: string; success?: boolean };
  if (!created.success || !created.id) throw new Error("Salesforce accepted the callback case but returned no id");
  return { reference: created.id };
}
