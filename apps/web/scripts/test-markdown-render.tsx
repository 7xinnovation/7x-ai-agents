/**
 * Server-render test for the in-chat blocks the feedback rounds rely on:
 *   ```upload (FB-1425), ```locate (FB-1432), ```buttons (FB-1434), ```toggles
 *   with a markdown link in the label (FB-1431/FB-1450), ```cards, ```map.
 * Renders the Markdown component with react-dom/server and asserts the widget
 * markup appears. Run from apps/web: npx tsx scripts/test-markdown-render.tsx
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown, type UploadCtx } from "../app/embed/[agent]/Markdown";

const ctx = {
  locale: "en",
  docs: {
    trade_license: { label: { en: "Trade License" }, requirement: "mandatory", acceptedFormats: ["pdf"], maxSizeMb: 10 },
    agent_eid_front: { label: { en: "Agent EID (front)" }, requirement: "mandatory", acceptedFormats: ["jpg"], maxSizeMb: 10 },
  },
  statuses: {},
  uploadingKey: null,
  pendingDocs: ["trade_license"],
  onUpload: () => {},
  onQr: () => {},
  strings: {
    upload: "Upload", uploading: "Uploading", replace: "Replace", optional: "optional",
    upTo: "up to", takePhoto: "Take photo", fromPhone: "From phone", uploaded: "Uploaded",
  },
} as unknown as UploadCtx;

const onSelect = () => {};
const render = (text: string) => renderToStaticMarkup(<Markdown text={text} onSelect={onSelect} uploadCtx={ctx} />);

const cases: [string, string, string[]][] = [
  ["upload block renders widget", "```upload\nkey: trade_license\n```", ["dlg-chat-upload", "Trade License"]],
  ["upload block: two keys → two widgets", "```upload\nkey: agent_eid_front\nkey: trade_license\n```", ["Agent EID (front)", "Trade License"]],
  ["upload block: unknown key falls back to pending doc", "```upload\nkey: nonsense_key\n```", ["dlg-chat-upload", "Trade License"]],
  ["locate block renders map CTA", "```locate\n```", ["dlg-map-cta", "Pin the location on a map"]],
  ["locate block custom label", "```locate\nlabel: Share company location\n```", ["Share company location"]],
  ["buttons block renders actions", "```buttons\n- Apply for a new courier license\n- Renew an existing license\n```", ["dlg-chat-btn", "Apply for a new courier license"]],
  ["toggles checkbox with markdown link label", "```toggles\nstyle: checkbox\n- terms_accepted: I agree to the [Terms](https://example.com/tc)\nconfirm: Agree\n```", ["dlg-toggles", "href=\"https://example.com/tc\"", "dlg-checkbox-box"]],
  ["cards block renders options", "```cards\n- title: MyHome\n  price: AED 695 / year\n```", ["dlg-card-opt", "MyHome", "AED 695 / year"]],
  ["map block renders browse CTA", "```map\nemirate: DXB\nbundle: MYHOME3\n```", ["dlg-map"]],
];

let fail = 0;
for (const [name, text, expects] of cases) {
  const html = render(text);
  const missing = expects.filter((e) => !html.includes(e));
  const ok = missing.length === 0;
  console.log(` ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (missing: ${missing.join(", ")})`}`);
  if (!ok) fail++;
}

// FB-1565: an agent declaring uploadsPerMessage shows at most that many upload
// controls per message, however many blocks the model emitted. Counted rather
// than string-matched, and checked against the uncapped default so the cap is
// shown to be what makes the difference.
const TWO_BLOCKS = "```upload\nkey: trade_license\n```\n\nand also\n\n```upload\nkey: agent_eid_front\n```";
// Count widget ROOTS — the widget's inner elements share the class prefix.
const countWidgets = (html: string) => (html.match(/class="dlg-chat-upload"/g) ?? []).length;
const capped = { ...(ctx as object), maxUploads: 1 } as unknown as UploadCtx;
const extra: [string, number, number][] = [
  ["no cap → both upload blocks render", countWidgets(render(TWO_BLOCKS)), 2],
  [
    "uploadsPerMessage=1 → only the first renders",
    countWidgets(renderToStaticMarkup(<Markdown text={TWO_BLOCKS} onSelect={onSelect} uploadCtx={capped} />)),
    1,
  ],
  [
    "cap does not suppress a single block",
    countWidgets(
      renderToStaticMarkup(
        <Markdown text={"```upload\nkey: trade_license\n```"} onSelect={onSelect} uploadCtx={capped} />
      )
    ),
    1,
  ],
];
for (const [name, got, want] of extra) {
  const ok = got === want;
  console.log(` ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (got ${got}, want ${want})`}`);
  if (!ok) fail++;
}

const total = cases.length + extra.length;
console.log(fail ? `\n${fail}/${total} FAILED` : `\nAll ${total} render checks passed.`);
process.exit(fail ? 1 : 0);
