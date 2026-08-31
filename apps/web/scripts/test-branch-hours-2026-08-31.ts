/** Branch opening hours, parsed from the two strings the API gives us. */
import { parseHours, openNow } from "@/lib/branchHours";
let pass = 0, fail = 0;
const check = (l: string, ok: boolean, extra?: unknown) => { console.log(ok ? `PASS ${l}` : `FAIL ${l}`, ok ? "" : extra ?? ""); ok ? pass++ : fail++; };

// The exact strings Rental/BoxLocations returns for Dubai.
const central = parseHours(" Monday - Friday  ", " 08:00 AM- 20:00 PM");
const barsha = parseHours(" Monday - Friday  ", " 08:00 AM - 18:30 PM");
check("Dubai Central parses", !!central && central.openMin === 480 && central.closeMin === 1200, central);
check("Al Barsha parses (18:30 PM is 18:30, not 06:30)", !!barsha && barsha.closeMin === 1110, barsha);
check("Mon-Fri is five weekdays", central?.days.join() === "1,2,3,4,5", central?.days);

// A UTC instant, so the assertions are about UAE time (+4).
const at = (iso: string) => new Date(iso);
check("Wednesday 12:00 UAE is open", openNow(central!, at("2026-09-02T08:00:00Z")).open);
check("Wednesday 07:00 UAE is closed, opens 08:00",
  !openNow(central!, at("2026-09-02T03:00:00Z")).open && openNow(central!, at("2026-09-02T03:00:00Z")).opensAt === "08:00");
check("Wednesday 21:00 UAE is closed, opens tomorrow",
  openNow(central!, at("2026-09-02T17:00:00Z")).opensAt === "tomorrow 08:00");
check("Saturday is closed, opens Monday",
  openNow(central!, at("2026-09-05T08:00:00Z")).opensAt === "Monday 08:00", openNow(central!, at("2026-09-05T08:00:00Z")));
check("19:00 UAE: Central open, Barsha shut",
  openNow(central!, at("2026-09-02T15:00:00Z")).open && !openNow(barsha!, at("2026-09-02T15:00:00Z")).open);
check("the boundary minute is closed", !openNow(central!, at("2026-09-02T16:00:00Z")).open);

// Shapes that must not produce a confident wrong answer.
check("empty input yields nothing", parseHours("", "") === null);
check("unparseable time yields nothing", parseHours("Monday - Friday", "always") === null);
check("a wrapping range keeps its length", parseHours("Saturday - Wednesday", "08:00 - 18:00")?.days.length === 5);
check("a single day works", parseHours("Sunday", "09:00 AM - 01:00 PM")?.days.join() === "0");
check("12-hour PM is promoted", parseHours("Monday", "09:00 AM - 05:00 PM")?.closeMin === 17 * 60);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
