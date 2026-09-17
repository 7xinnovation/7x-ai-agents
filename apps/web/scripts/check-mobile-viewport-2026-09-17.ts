/**
 * The mobile layout, measured in a real engine at a real phone size.
 *
 * The static test beside this one (test-mobile-layout) reads the stylesheet.
 * That catches a field somebody forgets to lift, and it cannot catch what the
 * mobile bug list actually reported — a page wider than the screen. This drives
 * a headless Chrome at iPhone metrics against a DEPLOYED site and measures it.
 *
 * Read-only: it loads the widget, focuses the composer, and measures. It sends
 * no message, signs in as nobody, and buys nothing.
 *
 *   npx tsx scripts/check-mobile-viewport-2026-09-17.ts --host https://7xagents.7x-lab.com [--agent nxn-dialog]
 */
import puppeteer from "puppeteer-core";
import { readFileSync } from "node:fs";

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(n);
  return i !== -1 ? process.argv[i + 1]! : d;
};
const HOST = (arg("--host") ?? "").replace(/\/$/, "");
const AGENT = arg("--agent", "nxn-dialog")!;
const LOCALE = arg("--locale", "en")!;
const CHROME =
  arg("--chrome") ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
if (!HOST) throw new Error("--host <https://…> is required");

/** iPhone 15 Pro, which is the device in the screenshots. */
const PHONE = { width: 393, height: 852, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got === undefined ? "" : ` — ${JSON.stringify(got)}`}`); }
};

async function main() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport(PHONE);
  await page.setUserAgent(UA);
  // embedded=1 is how the app loads it, and it is what puts the expand control
  // on screen in the first place.
  const url = `${HOST}/embed/${AGENT}?locale=${LOCALE}&embedded=1`;
  console.log(`\n${url}  @ ${PHONE.width}x${PHONE.height}\n`);
  await page.goto(url, { waitUntil: "networkidle2", timeout: 60_000 });
  await page.waitForSelector(".dlg-input textarea", { timeout: 30_000 });
  /**
   * Try a stylesheet that is not deployed yet.
   *
   * `--css ../app/globals.css` appends the local file over the live one, so a
   * layout fix can be measured on a real page before it is pushed. Deployed
   * runs leave it off and measure what is actually live.
   */
  const cssFile = arg("--css");
  if (cssFile) {
    await page.addStyleTag({ content: readFileSync(cssFile, "utf8") });
    console.log(`(with local ${cssFile} layered over the deployed stylesheet)\n`);
  }

  // tsx compiles the functions below with esbuild's keepNames helper, which calls
  // `__name` — a helper that exists in this process and not in the page. One
  // shim, so a named arrow inside page.evaluate does not fail as "__name is not
  // defined" and get mistaken for a finding.
  await page.evaluate("window.__name = window.__name || function (f) { return f; }");

  console.log("Nothing is wider than the screen (issues 2 and 4)");
  const overflow = await page.evaluate(() => {
    const vw = window.innerWidth;
    const wide: { sel: string; right: number }[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(".dlg-root *"))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      if (r.right > vw + 1 || r.left < -1) {
        const sel = el.className && typeof el.className === "string" ? `.${el.className.split(" ")[0]}` : el.tagName;
        wide.push({ sel, right: Math.round(r.right) });
      }
    }
    return { vw, docWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth, wide: wide.slice(0, 8) };
  });
  check("the document is not wider than the viewport", overflow.docWidth <= overflow.vw, overflow);
  check("neither is the body", overflow.bodyWidth <= overflow.vw, overflow);
  check("and no element sticks out of it", overflow.wide.length === 0, overflow.wide);

  console.log("\nNo field will make iOS magnify the page");
  const fields = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("input, textarea, select")).map((el) => ({
      tag: el.tagName.toLowerCase(),
      cls: typeof el.className === "string" ? el.className : "",
      size: parseFloat(getComputedStyle(el).fontSize),
    }))
  );
  check("there are fields to measure", fields.length > 0, fields);
  for (const f of fields) check(`${f.tag}${f.cls ? `.${f.cls.split(" ")[0]}` : ""} is ${f.size}px`, f.size >= 16, f);

  console.log("\nThe composer, which is where the two white lines were (issue 6)");
  const composer = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(".dlg-input");
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { backdrop: cs.backdropFilter || (cs as any).webkitBackdropFilter, background: cs.backgroundColor, radius: cs.borderRadius };
  });
  check("the backdrop filter is off on a phone", composer?.backdrop === "none", composer);
  // Chrome reports this as `color(srgb 1 1 1 / 0.9)`, not rgba(), so read the
  // alpha out of whatever notation it used rather than pattern-matching one.
  const alpha = Number(/[/,]\s*(0?\.\d+|0|1)\s*\)?$/.exec((composer?.background ?? "").trim())?.[1] ?? "1");
  check("...and the panel is opaque instead", alpha === 1, { ...composer, alpha });

  /**
   * THE ACCOUNT PULSE'S TABLE, WHICH IS WHAT THE SECOND ROUND REPORTED.
   *
   * "The container gets cropped — make sure it gets adjusted based on the phone
   * size", 17 September, with a screenshot of a five-column table of PO Boxes
   * clipped at the right and the prose above it cut off mid-word.
   *
   * The greeting screen has nothing wide on it, so the checks above pass on a
   * build where this fails. The pulse is the first thing a signed-in customer
   * sees and it is the widest thing the assistant ever draws, so it is injected
   * here — same markup the renderer emits — rather than left untested because
   * reaching it needs a signed-in account.
   */
  console.log("\nA wide table in a bubble stays inside the phone");
  await page.evaluate(() => {
    // Straight off the 17 September screenshot, including the long ones.
    const rows = [
      ["450367", "MyHome Flex", "Al Barsha", "30-08-2027", "DXB"],
      ["902020", "MyHome 3", "Dubai Sorting Centre", "30-08-2027", "DXB"],
      ["450293", "Instant", "Al Barsha", "30-08-2027", "DXB"],
      ["417377", "Large Instant", "Al Badaa - Corporate", "30-08-2027", "DXB"],
      ["903444", "MyHome 3", "Dubai Sorting Centre", "03-09-2032", "DXB"],
    ];
    const msg = document.createElement("div");
    msg.className = "dlg-msg assistant";
    msg.id = "probe";
    msg.innerHTML =
      '<div class="dlg-bubble" dir="auto">' +
      "<p>You have <strong>41 PO Boxes</strong> across Dubai and Abu Dhabi. Here is the full picture:</p>" +
      '<div class="dlg-md-tablewrap"><table class="dlg-md-table"><thead><tr>' +
      ["BOX", "BUNDLE", "BRANCH", "EXPIRY", "EMIRATE"].map((h) => `<th>${h}</th>`).join("") +
      "</tr></thead><tbody>" +
      rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("") +
      "</tbody></table></div>" +
      '<div class="dlg-chat-buttons">' +
      ["450367 (MyHome Flex, Al Barsha)", "902020 (MyHome 3, Dubai Sorting Centre)", "417377 (Large Instant, Al Badaa - Corporate)"]
        .map((b) => `<button class="dlg-chat-btn">${b}</button>`)
        .join("") +
      "</div></div>";
    document.querySelector(".dlg-messages")!.appendChild(msg);
  });
  await new Promise((r) => setTimeout(r, 250));
  const wide = await page.evaluate(() => {
    const vw = window.innerWidth;
    const probe = document.getElementById("probe")!;
    const rect = (s: string) => {
      const el = probe.querySelector<HTMLElement>(s);
      return el ? { right: Math.round(el.getBoundingClientRect().right), width: Math.round(el.getBoundingClientRect().width) } : null;
    };
    const wrap = probe.querySelector<HTMLElement>(".dlg-md-tablewrap")!;
    return {
      vw,
      doc: document.documentElement.scrollWidth,
      bubble: rect(".dlg-bubble"),
      table: rect(".dlg-md-table"),
      buttons: rect(".dlg-chat-buttons"),
      /**
       * A table too wide for the phone must SCROLL inside its card.
       *
       * Asked of the computed style rather than of the current measurement,
       * because THIS ENGINE IS NOT THE ONE THAT BROKE. Chrome treats the
       * bubble's `word-break: break-word` as affecting intrinsic size and
       * shrinks the table to fit; WebKit does not, which is why the phone
       * showed a table with its last column cut away and Chrome showed a table
       * that fit. What has to be true in both is structural: the card is
       * allowed to scroll, and the bubble is allowed to be narrower than it.
       */
      wrapOverflowX: getComputedStyle(wrap).overflowX,
      wrapScrolls: wrap.scrollWidth > wrap.clientWidth,
      bubbleMinWidth: getComputedStyle(probe.querySelector<HTMLElement>(".dlg-bubble")!).minWidth,
      /**
       * CAN THE CONVERSATION ITSELF BE SCROLLED SIDEWAYS?
       *
       * This is the actual reported bug and the reason a bubble that measures
       * fine can still be seen cut off. `.dlg-messages` sets overflow-y: auto,
       * and CSS computes the other axis to auto with it — so one message wide
       * enough to overflow makes the WHOLE conversation horizontally
       * scrollable. Every message after it is then drawn at an offset the
       * customer never asked for, which is "the container gets cropped".
       */
      listScroll: (() => {
        const l = document.querySelector<HTMLElement>(".dlg-messages")!;
        return { scrollWidth: l.scrollWidth, clientWidth: l.clientWidth, overflowX: getComputedStyle(l).overflowX };
      })(),
      /**
       * "450367" RENDERED AS "45 / 03 / 67".
       *
       * Counted as LINE BOXES, not cell height: a table cell is as tall as its
       * row, so a neighbouring "Dubai Sorting Centre" wrapping to three lines
       * makes every cell in that row tall and says nothing about the number.
       * A Range over the text node gives one rectangle per line it occupies.
       */
      numberLines: (() => {
        const td = probe.querySelector<HTMLElement>("td")!;
        const r = document.createRange();
        r.selectNodeContents(td);
        return { text: td.textContent, lines: r.getClientRects().length };
      })(),
    };
  });
  check("the document is still the width of the phone", wide.doc <= wide.vw, wide);
  check("the bubble does not reach past the screen", (wide.bubble?.right ?? 0) <= wide.vw + 1, wide);
  check("nor does the table's own card", (wide.buttons?.right ?? 0) <= wide.vw + 1, wide);
  check("the table's card is allowed to scroll rather than clip", wide.wrapOverflowX === "auto" || wide.wrapOverflowX === "scroll", wide);
  check("...and the bubble is allowed to be narrower than the table", wide.bubbleMinWidth === "0px", wide);
  check("a box number is not broken across lines", wide.numberLines.lines <= 1, wide.numberLines);
  check(
    "the conversation cannot be scrolled sideways",
    wide.listScroll.scrollWidth <= wide.listScroll.clientWidth + 1 && wide.listScroll.overflowX === "hidden",
    wide.listScroll
  );
  await page.evaluate(() => document.getElementById("probe")?.remove());

  console.log("\nThe expand control (issue 12)");
  // Found by its label, not its class — the class is part of the fix, and a
  // selector that only matches the fixed build would pass on the broken one
  // for the wrong reason.
  const expand = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('[aria-label="Expand"], [aria-label="توسيع"]');
    return { present: Boolean(el), visible: Boolean(el?.offsetParent), classes: el?.className ?? null };
  });
  check("it is not offered with no host frame to expand into", !expand.visible, expand);

    /**
   * Headless Chrome does not do the iOS focus-zoom, so these three cannot fail
   * for the reason the customer's phone failed. They are here to catch the
   * OTHER way the widget can end up wider than the screen — a long word, a
   * table, a card that will not shrink — with the composer full of text. The
   * proof for the reported bug is the font size above, which is the cause.
   */
  console.log("\nFocusing the composer does not move the page");
  await page.focus(".dlg-input textarea");
  await page.type(".dlg-input textarea", "Personal PO Box Renewal");
  await new Promise((r) => setTimeout(r, 400));
  const after = await page.evaluate(() => ({
    scrollX: window.scrollX,
    docWidth: document.documentElement.scrollWidth,
    vw: window.innerWidth,
    // What the reported screenshot showed: the composer clipped at an edge.
    input: (() => {
      const r = document.querySelector(".dlg-input")!.getBoundingClientRect();
      return { left: Math.round(r.left), right: Math.round(r.right) };
    })(),
  }));
  check("the page has not scrolled sideways", after.scrollX === 0, after);
  check("the document is still the width of the screen", after.docWidth <= after.vw, after);
  check("the composer is fully on screen", after.input.left >= -1 && after.input.right <= after.vw + 1, after);

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
