/**
 * The customer's files, into Salesforce's New Regulation composite.
 *
 * The composite is composed BY THE MODEL, and a model cannot hold a file. It
 * emits the EPG_Document__c items — one per slot, with the Document_Type the
 * catalogue named — and the bytes have to be put in underneath it. That is what
 * this does, in the same place and for the same reason as the rental's
 * attachment patcher next door.
 *
 * TWO WAYS IN, AND THE FILE'S SIZE DECIDES WHICH.
 *
 * Under about 4 MB a document travels as base64 inside the composite. Over it,
 * Salesforce refuse the whole request — so the file goes up first on its own,
 * through ContentVersion, and the composite item carries EPG_File_Id__c and no
 * content. Confirmed against their NewLaw sandbox on 21 October: a 6.27 MB PDF
 * uploaded and attached to its slot that way.
 *
 * The threshold is on the RAW bytes, at 3 MB rather than 4: base64 is a third
 * bigger than what it encodes, so a 3.1 MB file is already a 4.1 MB field, and
 * the limit Salesforce describe as "around 4 MB" is on the request they
 * receive, not on the file we read.
 */

/** Raw bytes above which a document cannot go inside the composite. */
export const INLINE_LIMIT_BYTES = 3_000_000;

export interface EpglCaseFile {
  /** Our slot key, e.g. copy_of_passport. */
  key: string;
  fileName: string;
  bytes: Uint8Array;
  contentType?: string;
  /** EPGL's name for the slot. Absent on our own slots, which are never sent. */
  salesforceType?: string;
  /** The expiry printed on this file, ISO YYYY-MM-DD, when it has one. */
  validTo?: string;
  /** EPGL refuse this slot without a Valid_To__c. */
  validityRequired?: boolean;
}

export interface CompositeItem {
  method?: string;
  url?: string;
  referenceId?: string;
  body?: Record<string, unknown>;
}

/** Only the New Regulation composite; the 1.x submit is a different tool entirely. */
export function isEpglCompositeTool(toolName: string): boolean {
  return /post_services_apexrest_compositehandler$/i.test(toolName);
}

/** Over this, the file cannot ride inside the request. */
export function needsTwoStep(byteLength: number): boolean {
  return byteLength > INLINE_LIMIT_BYTES;
}

/**
 * The journey's slot keys are slugged from the catalogue's documentType, so the
 * same slug run over what the model emitted finds the file again without a
 * lookup table that could drift from the catalogue.
 */
export function slugOfDocumentType(documentType: string): string {
  return String(documentType ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export function documentItemsOf(body: Record<string, unknown> | undefined): CompositeItem[] {
  const items = Array.isArray(body?.compositeRequest) ? (body!.compositeRequest as CompositeItem[]) : [];
  return items.filter((i) => /sobjects\/EPG_Document__c$/i.test(String(i?.url ?? "")));
}

export interface FillResult {
  input: Record<string, unknown> | undefined;
  /** Slots given base64 inline. */
  inlined: string[];
  /** Slots uploaded first and referenced by file id. */
  uploaded: string[];
  /** Slots the model asked for that we hold no file for. */
  unmatched: string[];
  /** Slots whose upload failed — dropped rather than sent empty. */
  failed: string[];
}

/**
 * Put the bytes in. `upload` is injected so the HTTP half stays in
 * integrations.ts, where the integration's token and the API-call log live.
 *
 * A document item we cannot fill is REMOVED, not sent hollow: an EPG_Document__c
 * with neither content nor a file id is the empty-panel failure of 2 September
 * again — a row in their documents list with nothing behind it, which reads to
 * a reviewer as a document that was supplied.
 */
export async function withEpglDocumentFiles(
  input: Record<string, unknown> | undefined,
  files: EpglCaseFile[],
  upload: (f: EpglCaseFile) => Promise<string | null>
): Promise<FillResult> {
  const body = { ...((input?.body ?? {}) as Record<string, unknown>) };
  const items = Array.isArray(body.compositeRequest) ? ([...body.compositeRequest] as CompositeItem[]) : [];
  const res: FillResult = { input, inlined: [], uploaded: [], unmatched: [], failed: [] };
  if (!items.length) return res;

  const byKey = new Map(files.map((f) => [f.key, f]));
  const next: CompositeItem[] = [];
  let changed = false;

  for (const item of items) {
    if (!/sobjects\/EPG_Document__c$/i.test(String(item?.url ?? ""))) {
      next.push(item);
      continue;
    }
    const b = { ...((item.body ?? {}) as Record<string, unknown>) };
    const type = String(b.Document_Type ?? "");
    const file = byKey.get(slugOfDocumentType(type));

    // The model already supplied a file id (a re-upload of something it just
    // put up). Leave it alone — it is not ours to second-guess.
    if (!file && typeof b.EPG_File_Id__c === "string" && b.EPG_File_Id__c) {
      next.push(item);
      continue;
    }
    if (!file) {
      res.unmatched.push(type || "(no Document_Type)");
      changed = true;
      continue;
    }

    if (needsTwoStep(file.bytes.byteLength)) {
      const id = await upload(file).catch(() => null);
      if (!id) {
        res.failed.push(file.key);
        changed = true;
        continue;
      }
      delete b.content;
      b.EPG_File_Id__c = id;
      b.fileName = file.fileName;
      res.uploaded.push(file.key);
    } else {
      delete b.EPG_File_Id__c;
      b.content = Buffer.from(file.bytes).toString("base64");
      b.fileName = file.fileName;
      res.inlined.push(file.key);
    }
    next.push({ ...item, body: b });
    changed = true;
  }

  if (!changed) return res;
  body.compositeRequest = next;
  res.input = { ...input, body };
  return res;
}

/**
 * The documents INTO the create call, against the application being created.
 *
 * Hussein, 26 October: "If you want the documents on the same application as
 * the create, include the document items after the application item in the
 * one-call body, referencing it with EPG_License_Request__c:
 * \"@{NewLicenseRequest.id}\"."
 *
 * Worth doing even though the follow-up call works, because of what happened
 * to LR-54056: by the time its documents were asked for, the application had
 * already moved on and they went to a later one. A document that travels with
 * the create cannot miss its application.
 *
 * The model has never emitted a document item in two weeks of runs, so they
 * are put in here rather than asked for. If it ever does emit one, this leaves
 * the composite alone — it is not ours to second-guess.
 *
 * Only slots EPGL's checklist knows, by the same rule as the follow-up call:
 * `salesforceType` is set on a catalogue-generated slot and on no other. The
 * bytes are not put in here; `withEpglDocumentFiles` does that next, to the
 * items added here and the model's alike.
 */
export function withEpglDocumentItems(
  input: Record<string, unknown> | undefined,
  files: EpglCaseFile[]
): { input: Record<string, unknown> | undefined; added: string[] } {
  const none = { input, added: [] as string[] };
  const body = { ...((input?.body ?? {}) as Record<string, unknown>) };
  const items = Array.isArray(body.compositeRequest) ? ([...body.compositeRequest] as CompositeItem[]) : [];
  if (!items.length) return none;
  // Already carries documents: the model composed them, so leave it be.
  if (items.some((i) => /sobjects\/EPG_Document__c$/i.test(String(i?.url ?? "")))) return none;

  const request = items.find((i) => /sobjects\/EPG_License_Request__c$/i.test(String(i?.url ?? "")));
  if (!request?.referenceId) return none;
  const ref = request.referenceId;

  /**
   * A DOCUMENT MAY NOT COST THE APPLICATION.
   *
   * This body runs allOrNone=true -- it has to, since the Account, the owners,
   * the Contact and the licence request must stand or fall together. A document
   * item inside it is therefore not free: on 26 October an insurance
   * certificate and a lease contract whose PDFs printed no readable expiry came
   * back "Valid_To__c is required for this document" and rolled back the whole
   * submission, Account and all. The applicant had answered every question and
   * uploaded sixteen files to be told nothing was created.
   *
   * So a slot that EPGL will refuse for want of a date we do not have stays out
   * of the create and goes on the follow-up call instead, where allOrNone is
   * false and a refusal costs only that slot. Everything that can pass still
   * travels with the application, which is the point of the one-call shape.
   */
  const sendable = files.filter((f) => !!f.salesforceType && !(f.validityRequired && !f.validTo));
  if (!sendable.length) return none;

  const docs: CompositeItem[] = sendable.map((f, i) => ({
    method: "POST",
    url: "/services/data/v60.0/sobjects/EPG_Document__c",
    referenceId: `Doc${i + 1}`,
    body: {
      // Their reference syntax, resolved by Salesforce inside the one call.
      EPG_License_Request__c: `@{${ref}.id}`,
      Document_Type: f.salesforceType!,
      ...(f.validTo ? { Valid_To__c: f.validTo } : {}),
    },
  }));

  // After the application item, as their example has it.
  const at = items.indexOf(request) + 1;
  body.compositeRequest = [...items.slice(0, at), ...docs, ...items.slice(at)];
  return { input: { ...input, body }, added: sendable.map((f) => f.key) };
}

/**
 * Salesforce's ContentVersion multipart, built by hand.
 *
 * A FormData/Blob metadata part is rejected with "Cannot include more than one
 * binary part" (tested, 21 October): the JSON part must carry NO filename, and
 * every runtime that appends a Blob gives it one. So the body is assembled
 * here, where the Content-Disposition can be written without a filename on the
 * part that must not have one.
 */
export function contentVersionMultipart(
  file: EpglCaseFile,
  title?: string
): { body: Buffer; contentType: string } {
  const boundary = `----dialog${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  const meta = JSON.stringify({ Title: title ?? file.fileName, PathOnClient: file.fileName });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="entity_content"\r\nContent-Type: application/json\r\n\r\n${meta}\r\n`),
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="VersionData"; filename="${file.fileName.replace(/"/g, "")}"\r\n` +
        `Content-Type: ${file.contentType || "application/octet-stream"}\r\n\r\n`
    ),
    Buffer.from(file.bytes),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

/**
 * The application id Salesforce minted, out of the composite's answer.
 *
 * Salesforce issue it on create and return it as `applicationId` on the
 * NewLicenseRequest item, in the form LR-xxxxx. It has to be kept, for two
 * reasons that are easy to miss until they bite:
 *
 *   - their STATUS PUSH is keyed on it. The receiver finds the conversation by
 *     matching the pushed applicationId against the case, so an id that was
 *     never written down means every push arrives unmatched and the applicant
 *     is never told their licence was approved;
 *   - every later call needs it, and a later turn cannot read it off a tool
 *     result that scrolled out of the context window.
 *
 * Deliberately not fussy about WHICH item carries it — their referenceId is a
 * convention in an example, not a contract, so the first LR- shaped id in the
 * response wins over hunting for a name they are free to change.
 */
export function applicationIdFrom(raw: string | undefined): string | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A result line like `HTTP 200\n{...}` — take the JSON off the end.
    const brace = raw.indexOf("{");
    if (brace === -1) return null;
    try {
      parsed = JSON.parse(raw.slice(brace));
    } catch {
      return null;
    }
  }
  const items = (parsed as { compositeResponse?: { referenceId?: string; body?: { applicationId?: unknown } }[] })?.compositeResponse;
  if (!Array.isArray(items)) return null;
  const named = items.find((i) => i?.referenceId === "NewLicenseRequest");
  const ids = [named, ...items]
    .map((i) => i?.body?.applicationId)
    .filter((v): v is string => typeof v === "string" && /^LR-\w+$/i.test(v));
  return ids[0] ?? null;
}

/**
 * Which slot each document item in a composite is for, by its referenceId.
 *
 * Read off the REQUEST, so it works whoever composed it. That matters: on
 * 26 October the model emitted the document items itself — `Doc_TradeLicence`,
 * `Doc_MOA`, names of its own choosing — all ten passed with the create, and
 * the follow-up push then sent the same ten again because nothing had recorded
 * that they had gone. Two of them went the second time WITHOUT the expiry the
 * model had supplied the first time, and EPGL duly marked two documents that
 * had just passed as failed.
 *
 * A re-send is only safe when it carries at least what the first send did.
 * Knowing what already went is what makes that moot.
 */
export function documentKeysByReference(input: Record<string, unknown> | undefined): Map<string, string> {
  const out = new Map<string, string>();
  const body = (input?.body ?? {}) as Record<string, unknown>;
  const items = Array.isArray(body.compositeRequest) ? (body.compositeRequest as CompositeItem[]) : [];
  for (const i of items) {
    if (!/sobjects\/EPG_Document__c$/i.test(String(i?.url ?? ""))) continue;
    const ref = i.referenceId;
    const type = (i.body as { Document_Type?: unknown } | undefined)?.Document_Type;
    if (typeof ref === "string" && typeof type === "string" && type) out.set(ref, slugOfDocumentType(type));
  }
  return out;
}

/** The same reading as documentOutcomes, against a referenceId -> slot map. */
export function documentOutcomesByReference(
  raw: string | undefined,
  byRef: Map<string, string>
): { sent: string[]; refused: { key: string; reason: string }[] } {
  const refs = [...byRef.keys()];
  const ordered = refs.map((r) => byRef.get(r)!);
  const asIndexed = documentOutcomes(raw, ordered);
  // documentOutcomes keys off Doc<n>; when the names are not ours, map directly.
  if (asIndexed.sent.length || asIndexed.refused.length) {
    if (refs.every((r) => /^Doc\d+$/.test(r))) return asIndexed;
  }
  const out = { sent: [] as string[], refused: [] as { key: string; reason: string }[] };
  if (!raw) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const brace = raw.indexOf("{");
    if (brace === -1) return out;
    try {
      parsed = JSON.parse(raw.slice(brace));
    } catch {
      return out;
    }
  }
  const items = (parsed as {
    compositeResponse?: { referenceId?: string; httpStatusCode?: number; body?: { success?: boolean; errors?: unknown[] } }[];
  })?.compositeResponse;
  if (!Array.isArray(items)) return out;
  for (const item of items) {
    const key = byRef.get(String(item?.referenceId ?? ""));
    if (!key) continue;
    const good = item?.body?.success === true || (item?.httpStatusCode ?? 0) < 300;
    if (good) out.sent.push(key);
    else out.refused.push({ key, reason: String(item?.body?.errors?.[0] ?? `HTTP ${item?.httpStatusCode ?? "?"}`) });
  }
  return out;
}

/**
 * The documents, as their own composite, after the application exists.
 *
 * THE MODEL NEVER EMITS THESE. The 2.0 composite is composed by the model and
 * every one it has sent carries exactly Account, the owners, the Contact and
 * the licence request — so `withEpglDocumentFiles` has had nothing to fill, and
 * on 26 October their getApplicationStatus for LR-54066 reported all ten slots
 * `uploaded: false`. Their reviewers have been reading empty applications.
 *
 * So the files go in a SECOND call that we compose, once the application has an
 * id. That is their documented re-upload shape: EPG_Document__c keyed on
 * `applicationId__c` — the LR- reference, NOT the Salesforce record id — and
 * `allOrNone: false`, so one bad slot cannot roll back the rest.
 *
 * ONLY SLOTS THEIR CHECKLIST KNOWS. `salesforceType` is set on a slot generated
 * from their catalogue and on no other, which makes its absence the test. Our
 * own slots — `moa`, `trade_license`, `partner_1_passport` — are there to read
 * fields off a document, each has a catalogue twin holding the same file, and
 * their API refuses them by name: `Document_Type "Partner 1 - Emirates ID" is
 * not required for this application`.
 *
 * The bytes are not put in here. This returns the skeleton and the exec layer
 * fills each item exactly as it would one the model wrote, which is what keeps
 * the >3 MB ContentVersion path working for both.
 */
export interface EpglDocumentSlot {
  key: string;
  /** EPGL's name for the slot. Absent on our own slots, which are not sent. */
  salesforceType?: string;
  /** Their Valid_To__c, where the case knows it. */
  validTo?: string;
  /** Their catalogue refuses this slot outright without a Valid_To__c. */
  validityRequired?: boolean;
}

export function documentCompositeBody(
  applicationId: string,
  slots: EpglDocumentSlot[]
): Record<string, unknown> | null {
  if (!applicationId) return null;
  // Same filter as sendableDocumentKeys, and it must stay the same filter: the
  // outcome of this call is recorded against the keys that function returns, so
  // the two disagreeing would attribute one slot's refusal to another.
  const sendable = slots.filter((s) => !!s.salesforceType && !(s.validityRequired && !s.validTo));
  if (!sendable.length) return null;
  return {
    allOrNone: false,
    compositeRequest: sendable.map((s, i) => ({
      method: "POST",
      url: "/services/data/v60.0/sobjects/EPG_Document__c",
      referenceId: `Doc${i + 1}`,
      body: {
        applicationId__c: applicationId,
        Document_Type: s.salesforceType,
        ...(s.validTo ? { Valid_To__c: s.validTo } : {}),
      },
    })),
  };
}

/** The slots `documentCompositeBody` will send, in the order it sends them. */
/**
 * The slots worth sending, which is not the same as the slots we hold.
 *
 * A slot their catalogue marks `validityRequired` and whose expiry we could not
 * read is REFUSED, every time, with "Valid_To__c is required for this
 * document". Sending it anyway posts a megabyte of base64 to a known rejection
 * and leaves a failure on the applicant's record for a document they uploaded
 * correctly.
 *
 * The create path has filtered on this since 26 October; this one never did,
 * which is why LR-54066 ended at seven of ten and LR-54086's lease contract and
 * insurance certificate were refused twice on one turn — once by the deferred
 * push here and once by a composite the model wrote itself.
 */
export function sendableDocumentKeys(slots: EpglDocumentSlot[]): string[] {
  return slots.filter((s) => !!s.salesforceType && !(s.validityRequired && !s.validTo)).map((s) => s.key);
}

/**
 * What their composite did with each slot.
 *
 * Refusals are returned as well as successes, and both are recorded, because
 * `allOrNone: false` means a refusal is final for that slot and retrying it
 * next turn re-posts the same base64 to the same rejection. Six slots on
 * CEP30-UAE-SME-DOM are marked `validityRequired` in their catalogue and we
 * collect an expiry date for exactly one of them, so without this the push
 * would hammer their API once per turn for the rest of the conversation.
 */
export function documentOutcomes(
  raw: string | undefined,
  keysInOrder: string[]
): { sent: string[]; refused: { key: string; reason: string }[] } {
  const out = { sent: [] as string[], refused: [] as { key: string; reason: string }[] };
  if (!raw) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const brace = raw.indexOf("{");
    if (brace === -1) return out;
    try {
      parsed = JSON.parse(raw.slice(brace));
    } catch {
      return out;
    }
  }
  const items = (parsed as {
    compositeResponse?: { referenceId?: string; httpStatusCode?: number; body?: { success?: boolean; errors?: unknown[] } }[];
  })?.compositeResponse;
  if (!Array.isArray(items)) return out;
  for (const item of items) {
    const n = Number(String(item?.referenceId ?? "").replace(/^Doc/, ""));
    if (!Number.isInteger(n) || n < 1 || n > keysInOrder.length) continue;
    const key = keysInOrder[n - 1]!;
    const good = item?.body?.success === true || (item?.httpStatusCode ?? 0) < 300;
    if (good) out.sent.push(key);
    else out.refused.push({ key, reason: String(item?.body?.errors?.[0] ?? `HTTP ${item?.httpStatusCode ?? "?"}`) });
  }
  return out;
}
