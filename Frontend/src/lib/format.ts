// Date/time helpers. Every time on screen is shown in Africa/Johannesburg (SAST),
// whatever timezone the viewer's laptop is set to.

export const TIMEZONE = process.env.NEXT_PUBLIC_TIMEZONE || "Africa/Johannesburg"; // display timezone
const LOCALE = "en-ZA"; // South African English
export const AT_RISK_THRESHOLD = 75; // attendance % below this gets an "At risk" badge (spec §7)

function parts(iso: string | Date, options: Intl.DateTimeFormatOptions): Record<string, string> { // split a date into named pieces
  const date = typeof iso === "string" ? new Date(iso) : iso; // accept ISO strings or Date objects
  const fmt = new Intl.DateTimeFormat(LOCALE, { timeZone: TIMEZONE, hourCycle: "h23", ...options }); // 24-hour clock in SAST
  const out: Record<string, string> = {}; // type → value
  for (const p of fmt.formatToParts(date)) out[p.type] = p.value; // e.g. { day: "20", month: "Oct", … }
  return out; // pieces we can assemble in a fixed order
}

export function fmtDateTime(iso: string | null | undefined): string { // "20 Oct 2026, 09:05"
  if (!iso) return "—"; // missing value
  const p = parts(iso, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); // pieces
  return `${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute}`; // fixed format, independent of browser locale quirks
}

export function fmtTime(iso: string | null | undefined): string { // "09:05:12"
  if (!iso) return "—"; // missing value
  const p = parts(iso, { hour: "2-digit", minute: "2-digit", second: "2-digit" }); // pieces
  return `${p.hour}:${p.minute}:${p.second}`; // hh:mm:ss
}

export function fmtClock(date: Date): string { // "09:05" for the top-bar clock
  const p = parts(date, { hour: "2-digit", minute: "2-digit" }); // pieces
  return `${p.hour}:${p.minute}`; // hh:mm
}

export function fmtDate(iso: string | null | undefined): string { // "Mon 20 Oct 2026"
  if (!iso) return "—"; // missing value
  const p = parts(iso, { weekday: "short", day: "numeric", month: "short", year: "numeric" }); // pieces
  return `${p.weekday} ${p.day} ${p.month} ${p.year}`; // fixed format
}

export function fmtDateKey(iso: string | Date): string { // "2026-10-20" (for file names)
  const p = parts(iso, { day: "2-digit", month: "2-digit", year: "numeric" }); // numeric pieces
  return `${p.year}-${p.month}-${p.day}`; // ISO-style date in SAST
}

export function fmtRelative(iso: string | null | undefined, now: number = Date.now()): string { // "just now" | "2 min ago" | "1 h ago"
  if (!iso) return "never"; // e.g. a terminal that never called in
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000)); // age in seconds (never negative)
  if (seconds < 45) return "just now"; // fresh
  const minutes = Math.round(seconds / 60); // age in minutes
  if (minutes < 60) return `${minutes} min ago`; // non-breaking space before the unit
  const hours = Math.round(minutes / 60); // age in hours
  if (hours < 24) return `${hours} h ago`; // same day
  const days = Math.round(hours / 24); // age in days
  return `${days} d ago`; // older
}

export function fmtSecondsAgo(timestamp: number, now: number = Date.now()): string { // "Updated 2 s ago" helper for the live badge
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000)); // whole seconds since the last poll
  return seconds < 60 ? `${seconds} s ago` : fmtRelative(new Date(timestamp).toISOString(), now); // seconds, then minutes
}

export function fmtDuration(fromIso: string, toIso: string | null, now: number = Date.now()): string { // "1 h 12 min"
  const end = toIso ? new Date(toIso).getTime() : now; // still running → use now
  const minutes = Math.max(0, Math.floor((end - new Date(fromIso).getTime()) / 60000)); // whole minutes
  if (minutes < 1) return "< 1 min"; // just opened
  const h = Math.floor(minutes / 60); // hours part
  const m = minutes % 60; // minutes part
  if (h === 0) return `${m} min`; // under an hour
  return m === 0 ? `${h} h` : `${h} h ${m} min`; // hours (+ minutes)
}

export function greeting(now: Date = new Date()): string { // "Good morning" by Johannesburg time
  const hour = Number(parts(now, { hour: "2-digit" }).hour); // 0–23 in SAST
  if (hour < 12) return "Good morning"; // before noon
  if (hour < 18) return "Good afternoon"; // before 6 pm
  return "Good evening"; // evening
}

export function percent(part: number, whole: number): number { // 0–100 with one decimal, 0 when whole is 0
  if (whole <= 0) return 0; // avoid dividing by zero
  return Math.round((part / whole) * 1000) / 10; // e.g. 66.7
}

export function fmtPercent(value: number): string { // "66.7%"
  return `${value.toFixed(1)}%`; // always one decimal
}

export function firstName(fullName: string): string { // "Lee Lecturer" → "Lee"
  return fullName.trim().split(/\s+/)[0] ?? fullName; // first word
}

export function initials(fullName: string): string { // "Lee Lecturer" → "LL"
  return fullName.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join(""); // up to two letters
}
