/**
 * The branch a progress line names must be the branch the customer picked.
 *
 * Reported by Emirates Post on 10 September, in an Arabic conversation. The
 * customer pressed "NXN - Al Barsha Branch" and the reply opened:
 *
 *   سأجلب الأرقام المتاحة في فرع الرشيدية.
 *   إليك الأرقام المتاحة في NXN - Al Barsha Branch (3 أرقام متبقية فقط):
 *
 * The list underneath was Al Barsha's and was correct. Only the sentence
 * announcing it was wrong, and it was wrong in the way that costs the most
 * trust: it named a real branch, in the customer's own language, twelve
 * kilometres from the one they chose. They asked three times whether the two
 * were the same place before they believed the boxes were Al Barsha's.
 *
 * TWO SEPARATE FAULTS MET HERE, and only one of them is this file.
 *
 * The other is that «الرشيدية» is not how Emirates Post spell it. Their own
 * nameAr is «مكتب بريد الراشدية» — with the alif — and the model never saw it:
 * the branch list note handed it nameEn and told it to use that exactly, so in
 * an Arabic sentence it had nothing to copy and transliterated its way there.
 * Fixed where the note is written, not here; a guard cannot supply a name that
 * was never sent. What this file does is notice the wrong one.
 *
 * WHY A GUARD AND NOT A RULE. "Name the branch they chose" is already implied by
 * every line of the journey, and the model followed it perfectly on the card in
 * the same reply. The failure is not one of instruction, it is the model
 * reaching into the branch list it just read and coming out with a neighbour.
 * The card is built from data and stayed right; the sentence was written from
 * memory and drifted. Only the sentence needs holding.
 *
 * WHAT IS DELIBERATELY LEFT ALONE. A reply may name another branch for good
 * reasons, and in this very conversation it did: asked whether Al Barsha and
 * Al Rashidiyah were the same, it correctly described both. Our own branch-list
 * note also *requires* naming a second branch when the chosen one is closed. So
 * the test is not "does this sentence mention another branch" — it is "is this
 * sentence announcing what we are about to fetch, and does it announce it for
 * the wrong branch". Everything else passes through untouched.
 */

/** Arabic diacritics and the tatweel, which carry no identity. */
const MARKS = /[ً-ْٰـ]/g;
const ARABIC = /[؀-ۿ]/;

/**
 * A branch name word reduced to what identifies it.
 *
 * For Arabic that means the consonant skeleton: alif, waw, ya and ta marbuta
 * are dropped after the usual hamza and alif-maqsura folding. This is heavier
 * than it looks and it is the point — «الراشدية» and «الرشيدية» differ by an
 * alif and the position of a ya, and both reduce to لرشد. A guard that only
 * matched the correct spelling would have let the reported sentence through,
 * because the whole complaint was that the spelling was wrong.
 *
 * Latin words keep their letters and lose everything else, so "NXN -", commas
 * and the "(3 numbers)" a model writes inline cannot join a word to its
 * neighbour.
 */
export function normaliseWord(word: string): string {
  const w = word.toLowerCase().replace(MARKS, "");
  if (!ARABIC.test(w)) return w.replace(/[^a-z0-9]/g, "");
  return w
    .replace(/[أإآٱ]/g, "ا") // أ إ آ ٱ -> ا
    .replace(/ة/g, "ه") // ة -> ه
    .replace(/[ىی]/g, "ي") // ى ی -> ي
    .replace(/[اويه]/g, "") // and then the long vowels go
    .replace(/[^ء-ي]/g, "");
}

/** A name split into its identifying words, plus each adjacent pair. */
function keysFor(name: string): string[] {
  const words = name
    .split(/[\s\-/,()·،]+/)
    .map(normaliseWord)
    .filter((w) => w.length >= 2);
  const pairs = words.slice(0, -1).map((w, i) => `${w} ${words[i + 1]}`);
  // Pairs matter for the seven branches whose only distinguishing word is
  // shared with a neighbour: "Al Ain Central" and "Al Ain Industrial Area" have
  // no unique word between them, and "ain central" is unique to one.
  return [...words, ...pairs];
}

export interface BranchRef {
  officeId: string;
  name: string;
}

/**
 * Which words name exactly one of these branches.
 *
 * Built from the branches THIS CONVERSATION was shown, so the discriminating
 * set is decided by the list in front of the customer rather than by a table
 * written here. "Post", "Office", «مكتب» and «بريد» fall out on their own by
 * belonging to all of them; nothing has to know they are noise.
 *
 * A word claimed by two branches identifies neither and is dropped, which is
 * the safe direction: the guard's job is to catch a name that is provably the
 * wrong one, and an ambiguous word proves nothing.
 */
export function branchIndex(rows: BranchRef[]): Map<string, string> {
  const seen = new Map<string, Set<string>>();
  for (const r of rows) {
    const id = String(r.officeId ?? "").trim();
    const name = String(r.name ?? "").trim();
    if (!id || !name) continue;
    for (const k of keysFor(name)) {
      const at = seen.get(k) ?? new Set<string>();
      at.add(id);
      seen.set(k, at);
    }
  }
  const out = new Map<string, string>();
  for (const [k, ids] of seen) if (ids.size === 1) out.set(k, [...ids][0]!);
  return out;
}

/**
 * The branch a piece of text names, if it names exactly one.
 *
 * Two different branches in one sentence is a comparison, not a claim about
 * where we are looking, so it returns null rather than picking the first.
 */
export function branchNamedIn(text: string, index: Map<string, string>): string | null {
  if (!text || !index.size) return null;
  const words = text
    .split(/[\s\-/,()·،.:؛!؟?]+/)
    .map(normaliseWord)
    .filter(Boolean);
  const found = new Set<string>();
  for (let i = 0; i < words.length; i++) {
    const one = index.get(words[i]!);
    if (one) found.add(one);
    if (i + 1 < words.length) {
      const two = index.get(`${words[i]} ${words[i + 1]}`);
      if (two) found.add(two);
    }
  }
  return found.size === 1 ? [...found][0]! : null;
}

/**
 * Is this sentence announcing a lookup we are about to make?
 *
 * Kept narrow on purpose. These are the verbs a progress line uses about its
 * own next step — not the verbs of an answer, a comparison or an apology. The
 * Arabic list is the future/continuous forms the model actually writes: سـ on a
 * present verb, دعني, and «جارٍ ...».
 */
const ANNOUNCING =
  /\b(let me|i'?ll|i will|i'?m going to|i am going to|fetching|getting|pulling up|looking up|checking|retrieving|one moment while i)\b/i;
const ANNOUNCING_AR = /(^|\s)(س[أنيت]\S+|دعني|دعيني|جار[ٍيی]|سوف\s+\S+)/u;

export function isAnnouncingLookup(sentence: string): boolean {
  const s = sentence.trim();
  if (!s) return false;
  return ANNOUNCING.test(s) || ANNOUNCING_AR.test(s);
}

/**
 * Drop an announcement that names the wrong branch, while the reply streams.
 *
 * Dropping and not correcting. The sentence is a courtesy — the card that
 * follows names the branch properly, in Emirates Post's own words, and is the
 * thing the customer acts on. Rewriting the name inside someone else's Arabic
 * sentence means agreeing with its grammar, and «في فرع مكتب بريد البرشاء» is
 * its own kind of wrong. Saying nothing is not.
 *
 * `selected` is the branch we believe is in play, as an officeId. When it is
 * unknown the guard is inert: a wrong name can only be proved wrong against a
 * right one.
 *
 * Sentence-buffered like narrationGuard, for the same reason — a sentence
 * removed after it has been streamed is a sentence the customer has read.
 * Fenced blocks pass through whole and unheld: the ```cards block is where the
 * branch name is correct, and holding it back would stall the cards.
 */
export function branchNarrationGuard(opts: {
  branches: () => BranchRef[];
  selected: () => string | null;
}) {
  let buf = "";
  let inFence = false;
  let index: Map<string, string> | null = null;

  const wrongBranch = (sentence: string): boolean => {
    const want = opts.selected();
    if (!want) return false;
    if (!isAnnouncingLookup(sentence)) return false;
    if (!index) index = branchIndex(opts.branches());
    const named = branchNamedIn(sentence, index);
    return named !== null && named !== want;
  };

  const drain = (final: boolean): string => {
    let out = "";
    for (;;) {
      if (inFence) {
        const end = buf.indexOf("```");
        if (end === -1) { out += buf; buf = ""; return out; }
        out += buf.slice(0, end + 3);
        buf = buf.slice(end + 3);
        inFence = false;
        continue;
      }
      const start = buf.indexOf("```");
      const upto = start === -1 ? buf : buf.slice(0, start);
      const m = /^([\s\S]*?[.!?۔؟])(\s+)/.exec(upto);
      if (m) {
        const sentence = m[1]!;
        out += wrongBranch(sentence) ? "" : sentence + m[2];
        buf = buf.slice(m[0].length);
        continue;
      }
      const nl = upto.indexOf("\n");
      if (nl !== -1) {
        const line = upto.slice(0, nl + 1);
        const bare = line.trim();
        out += bare && wrongBranch(bare) ? "" : line;
        buf = buf.slice(nl + 1);
        continue;
      }
      if (start !== -1) {
        out += upto;
        buf = buf.slice(start);
        inFence = true;
        continue;
      }
      if (final && buf) {
        out += wrongBranch(buf) ? "" : buf;
        buf = "";
      }
      return out;
    }
  };

  return {
    push(delta: string): string {
      buf += delta;
      return drain(false);
    },
    flush(): string {
      return drain(true);
    },
  };
}
