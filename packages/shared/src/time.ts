/** Calendar helpers. Every "day" in Wildcat Games is a date in the configured timezone. */

export const DEFAULT_TIMEZONE = "America/New_York";

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export interface ZonedParts {
  day: string; // YYYY-MM-DD
  minutes: number; // minutes since local midnight
  weekday: number; // 0 = Sunday
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function zonedParts(date: Date, timeZone = DEFAULT_TIMEZONE): ZonedParts {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(date).map((p) => [p.type, p.value]));
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    weekday: WEEKDAYS[parts.weekday] ?? 0,
  };
}

/** YYYY-MM-DD for `date` in `timeZone`. */
export function dayKey(date: Date = new Date(), timeZone = DEFAULT_TIMEZONE): string {
  return zonedParts(date, timeZone).day;
}

/** Inclusive YYYY-MM-DD range check (string compare works for ISO dates). */
export function dayInRange(day: string, start: string, end: string): boolean {
  return day >= start && day <= end;
}

export function isIsoDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/** "HH:MM" → minutes since midnight. */
export function parseClock(value: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!m) throw new Error(`Invalid time "${value}"`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new Error(`Invalid time "${value}"`);
  return h * 60 + min;
}

export interface QuietWindow {
  days: number[]; // weekdays the window *starts* on, 0 = Sunday
  start: string; // HH:MM
  end: string; // HH:MM; may be earlier than start for overnight windows
}

/** True when `date` falls inside any quiet window. Overnight windows roll into the next day. */
export function inQuietWindow(windows: QuietWindow[], date: Date, timeZone = DEFAULT_TIMEZONE): boolean {
  const now = zonedParts(date, timeZone);
  return windows.some((w) => {
    const start = parseClock(w.start);
    const end = parseClock(w.end);
    if (start === end) return false;
    if (start < end) return w.days.includes(now.weekday) && now.minutes >= start && now.minutes < end;
    // Overnight: the evening part belongs to the start day, the morning part to the next day.
    const yesterday = (now.weekday + 6) % 7;
    return (w.days.includes(now.weekday) && now.minutes >= start) || (w.days.includes(yesterday) && now.minutes < end);
  });
}
