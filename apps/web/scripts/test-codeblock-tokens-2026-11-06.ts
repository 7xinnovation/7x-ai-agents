/**
 * The developer docs' code colouring renders tokens, not HTML (6 November
 * 2026, security audit). Every sample must come back character for character,
 * and markup in a sample must stay text.
 *
 * Run from apps/web:  npx tsx scripts/test-codeblock-tokens-2026-11-06.ts
 */
import { readFileSync } from "node:fs";
import { highlight } from "../components/developers/CodeBlock";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => {
  console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : JSON.stringify(extra ?? ""));
  ok ? pass++ : fail++;
};
const join = (code: string, lang: string) => highlight(code, lang).map((t) => t.text).join("");
const cls = (code: string, lang: string, text: string) => highlight(code, lang).find((t) => t.text === text)?.cls;

const samples: [string, string][] = [
  ["bash", 'curl -X POST https://h/a2a/oauth/token \\\n  -u "CLIENT_ID:CLIENT_SECRET" \\\n  -d grant_type=client_credentials\n# a comment with "quotes"\nexport TOKEN=\'x\''],
  ["json", '{\n  "id": "abc",\n  "count": 3,\n  "ok": true,\n  "nested": { "k": null, "v": -1.5 },\n  "list": ["a", "b"]\n}'],
  ["js", '// call it\nconst res = await fetch(`${host}/x`, { method: "POST" });\nconsole.log(\'done\');'],
  ["python", '# call it\nimport requests\nr = requests.post("https://h", data={"a": 1})\nprint(r.json())'],
  ["http", 'POST /a2a/tasks HTTP/1.1\nAuthorization: Bearer "tok"'],
  ["text", "plain <b>text</b>"],
];
for (const [lang, code] of samples) check(`${lang}: the sample comes back exactly`, join(code, lang) === code, join(code, lang));

const evil = '<img src=x onerror=alert(1)> "</span><script>alert(1)</script>"';
for (const lang of ["bash", "json", "js", "python", "http", "text"])
  check(`${lang}: markup stays text — no token is HTML`, join(evil, lang) === evil);

check("bash: curl is a keyword", cls(samples[0]![1], "bash", "curl") === "tok-k");
check("bash: a flag is marked", cls(samples[0]![1], "bash", "-u") === "tok-n");
check("bash: a quoted value is a string", cls(samples[0]![1], "bash", '"CLIENT_ID:CLIENT_SECRET"') === "tok-s");
check("bash: a comment line is one comment", cls(samples[0]![1], "bash", '# a comment with "quotes"') === "tok-c");
check("json: a key", cls(samples[1]![1], "json", '"id"') === "tok-k");
check("json: a value string", cls(samples[1]![1], "json", '"abc"') === "tok-s");
check("json: a number and a literal", cls(samples[1]![1], "json", "3") === "tok-n" && cls(samples[1]![1], "json", "true") === "tok-n");
check("js: a comment", cls(samples[2]![1], "js", "// call it") === "tok-c");
check("js: keywords", cls(samples[2]![1], "js", "const") === "tok-k" && cls(samples[2]![1], "js", "await") === "tok-k");
check("js: a template string", cls(samples[2]![1], "js", "`${host}/x`") === "tok-s");
check("python: a comment and a keyword", cls(samples[3]![1], "python", "# call it") === "tok-c" && cls(samples[3]![1], "python", "import") === "tok-k");

const src = readFileSync(new URL("../components/developers/CodeBlock.tsx", import.meta.url), "utf8");
check("the component no longer sets inner HTML", !/dangerouslySetInnerHTML/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
