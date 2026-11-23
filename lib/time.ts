import { TZ_OFFSET_HOURS } from "./config.ts";

// Business-day arithmetic on the demo's calendar (Lagos time, no daylight saving).
// Business days and hours come from the rules table; these helpers take them as arguments.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface BusinessHours {
  /** ISO weekdays that are working days, 1 = Monday ... 7 = Sunday. */
  days: number[];
  /** Opening and closing time in minutes after midnight, local time. */
  open: number;
  close: number;
}

export const DEFAULT_HOURS: BusinessHours = { days: [1, 2, 3, 4, 5], open: 9 * 60, close: 17 * 60 };

/** Local wall-clock parts for a UTC instant. */
export function local(d: Date) {
  const l = new Date(d.getTime() + TZ_OFFSET_HOURS * HOUR);
  const dow = l.getUTCDay() === 0 ? 7 : l.getUTCDay();
  return {
    y: l.getUTCFullYear(),
    m: l.getUTCMonth(),
    d: l.getUTCDate(),
    dow,
    minutes: l.getUTCHours() * 60 + l.getUTCMinutes(),
  };
}

/** UTC instant for a local date and minute of day. */
export function fromLocal(y: number, m: number, d: number, minutes = 0): Date {
  return new Date(Date.UTC(y, m, d) + minutes * 60_000 - TZ_OFFSET_HOURS * HOUR);
}

function isWorkday(d: Date, h: BusinessHours) {
  return h.days.includes(local(d).dow);
}

/** Start of the local day containing d. */
function dayStart(d: Date): Date {
  const p = local(d);
  return fromLocal(p.y, p.m, p.d);
}

/** Business days between two instants, fractional: each working day counts 1 for its whole 24 hours. */
export function businessDaysBetween(from: Date, to: Date, h: BusinessHours = DEFAULT_HOURS): number {
  if (to <= from) return 0;
  let total = 0;
  let cursor = from;
  while (cursor < to) {
    const next = new Date(dayStart(cursor).getTime() + DAY);
    const end = next < to ? next : to;
    if (isWorkday(cursor, h)) total += (end.getTime() - cursor.getTime()) / DAY;
    cursor = end;
  }
  return total;
}

/** The instant `days` whole business days after `from` (same local time of day, skipping non-working days). */
export function addBusinessDays(from: Date, days: number, h: BusinessHours = DEFAULT_HOURS): Date {
  let d = new Date(from);
  let left = days;
  while (left > 0) {
    d = new Date(d.getTime() + DAY);
    if (isWorkday(d, h)) left--;
  }
  return d;
}

/** The instant `days` business days before `to` (fractional days allowed, e.g. 2.5). */
export function subtractBusinessDays(to: Date, days: number, h: BusinessHours = DEFAULT_HOURS): Date {
  let left = days;
  let cursor = to;
  // Walk back day by day, spending only working time.
  while (left > 1e-9) {
    const start = dayStart(new Date(cursor.getTime() - 1));
    const span = (cursor.getTime() - start.getTime()) / DAY;
    if (isWorkday(start, h)) {
      if (span >= left) return new Date(cursor.getTime() - left * DAY);
      left -= span;
    }
    cursor = start;
  }
  return cursor;
}

/** The most recent date (before today) falling on ISO weekday `dow`, at a given local minute. */
export function lastWeekday(now: Date, dow: number, minutes: number): Date {
  const p = local(now);
  let back = (p.dow - dow + 7) % 7;
  if (back === 0) back = 7;
  return fromLocal(p.y, p.m, p.d - back, minutes);
}

/** Add working time (in hours) during business hours, e.g. a 4-business-hour response target. */
export function addBusinessHours(from: Date, hours: number, h: BusinessHours = DEFAULT_HOURS): Date {
  let left = hours * 60;
  let t = from;
  for (let guard = 0; guard < 400; guard++) {
    const p = local(t);
    if (h.days.includes(p.dow) && p.minutes < h.close) {
      const startMin = Math.max(p.minutes, h.open);
      const avail = h.close - startMin;
      if (avail >= left) return fromLocal(p.y, p.m, p.d, startMin + left);
      left -= avail;
    }
    t = fromLocal(p.y, p.m, p.d + 1, 0);
  }
  return t;
}

/** Is `t` inside business hours? */
export function inBusinessHours(t: Date, h: BusinessHours = DEFAULT_HOURS): boolean {
  const p = local(t);
  return h.days.includes(p.dow) && p.minutes >= h.open && p.minutes < h.close;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** "Monday 23 November 2026" */
export function longDate(d: Date): string {
  const p = local(d);
  return `${DAYS[p.dow]} ${p.d} ${MONTHS[p.m]} ${p.y}`;
}

/** "23 November 2026, 14:05" (Lagos time) */
export function dateTime(d: Date): string {
  const p = local(d);
  const hh = String(Math.floor(p.minutes / 60)).padStart(2, "0");
  const mm = String(p.minutes % 60).padStart(2, "0");
  return `${p.d} ${MONTHS[p.m]} ${p.y}, ${hh}:${mm}`;
}

/** "23 November 2026" */
export function dayMonthYear(d: Date): string {
  const p = local(d);
  return `${p.d} ${MONTHS[p.m]} ${p.y}`;
}

/** Parse "Monday to Friday" (or a comma list) into ISO weekdays. */
export function parseDays(s: string): number[] {
  const names = DAYS.map((n) => n.toLowerCase());
  const t = s.toLowerCase();
  const range = t.match(/(\w+day)\s+to\s+(\w+day)/);
  if (range) {
    const a = names.indexOf(range[1]);
    const b = names.indexOf(range[2]);
    if (a > 0 && b > 0) {
      const out: number[] = [];
      for (let i = a; ; i = (i % 7) + 1) {
        out.push(i);
        if (i === b) break;
      }
      return out;
    }
  }
  const list = names.map((n, i) => (n && t.includes(n) ? i : 0)).filter(Boolean);
  return list.length ? list : DEFAULT_HOURS.days;
}

/** Parse "09:00" into minutes after midnight. */
export function parseClock(s: string, fallback: number): number {
  const m = s.match(/(\d{1,2})[:.](\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : fallback;
}
