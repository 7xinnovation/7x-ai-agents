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
