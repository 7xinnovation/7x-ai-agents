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
