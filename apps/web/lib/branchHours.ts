/**
 * Is this branch open right now?
 *
 * Emirates Post asked that a customer choosing a closed branch be told so, and
 * pointed at one that is open. The answer is in the branch list already, as two
 * loosely formatted strings — workingDays " Monday - Friday  " and workingTime
 * " 08:00 AM- 20:00 PM" — so it is parsed here rather than left to the model,
 * which cannot know the time in Dubai and would have to guess at "20:00 PM".
 */

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export interface BranchHours {
  /** Weekday indices the branch opens, 0 = Sunday, as JS getDay uses. */
  days: number[];
  /** Minutes from midnight. */
  openMin: number;
  closeMin: number;
}

function dayIndex(word: string): number {
  const w = word.trim().toLowerCase();
  return DAYS.findIndex((d) => d.startsWith(w.slice(0, 3)));
}

/** "Monday - Friday", "Saturday", "Monday, Wednesday" -> weekday indices. */
function parseDays(raw: string): number[] {
  const s = raw.replace(/\s+/g, " ").trim();
  if (!s) return [];
  const range = s.match(/^([A-Za-z]+)\s*[-–]\s*([A-Za-z]+)$/);
  if (range) {
    const a = dayIndex(range[1]!);
    const b = dayIndex(range[2]!);
    if (a < 0 || b < 0) return [];
    const out: number[] = [];
    // Ranges wrap: "Saturday - Wednesday" is five days, not minus three.
    for (let i = a; ; i = (i + 1) % 7) {
      out.push(i);
      if (i === b || out.length > 7) break;
    }
    return out;
  }
  return s
    .split(/[,/&]| and /i)
    .map((p) => dayIndex(p))
    .filter((i) => i >= 0);
}

/**
 * " 08:00 AM- 20:00 PM" -> 480, 1200.
 *
 * The AM/PM marker is unreliable — the data carries "18:30 PM" and "20:00 PM",
 * already in 24-hour form — so it only ever promotes an hour of 12 or less.
 */
function parseTimes(raw: string): { openMin: number; closeMin: number } | null {
  const hits = [...raw.matchAll(/(\d{1,2})[:.](\d{2})\s*(AM|PM)?/gi)];
  if (hits.length < 2) return null;
  const toMin = (m: RegExpMatchArray) => {
    let h = Number(m[1]);
    const min = Number(m[2]);
    const mark = (m[3] ?? "").toUpperCase();
    if (mark === "PM" && h < 12) h += 12;
    if (mark === "AM" && h === 12) h = 0;
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  };
  const openMin = toMin(hits[0]!);
  const closeMin = toMin(hits[hits.length - 1]!);
  if (openMin === null || closeMin === null || closeMin <= openMin) return null;
  return { openMin, closeMin };
}

export function parseHours(workingDays: string, workingTime: string): BranchHours | null {
  const days = parseDays(workingDays ?? "");
  const times = parseTimes(workingTime ?? "");
  if (!days.length || !times) return null;
  return { days, ...times };
}

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/**
 * Open or closed, in UAE time (UTC+4, no daylight saving).
 *
 * `opensAt` names the next opening in words a customer can act on — "08:00" when
 * that is later today, "Monday 08:00" when the branch is shut for the day.
 */
export function openNow(h: BranchHours, now: Date = new Date()): { open: boolean; opensAt: string } {
  const uae = new Date(now.getTime() + 4 * 3600_000);
  const day = uae.getUTCDay();
  const min = uae.getUTCHours() * 60 + uae.getUTCMinutes();
  const opens = new Set(h.days);

  if (opens.has(day) && min >= h.openMin && min < h.closeMin) return { open: true, opensAt: hhmm(h.openMin) };
  if (opens.has(day) && min < h.openMin) return { open: false, opensAt: hhmm(h.openMin) };
  for (let i = 1; i <= 7; i++) {
    const d = (day + i) % 7;
    if (opens.has(d)) {
      const name = DAYS[d]![0]!.toUpperCase() + DAYS[d]!.slice(1);
      return { open: false, opensAt: `${i === 1 ? "tomorrow" : name} ${hhmm(h.openMin)}` };
    }
  }
  return { open: false, opensAt: hhmm(h.openMin) };
}
