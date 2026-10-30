// Calendar dates ("2026-10-28") are treated as dates, not instants in Europe/London or UTC.
// They are only converted to UTC-midnight day numbers for deterministic day arithmetic,
// which is why BST/GMT transitions can never add or lose a day here.

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;
const UK_TIME_ZONE = "Europe/London";

export function isValidIsoDate(date: string): boolean {
  if (!ISO_DATE_PATTERN.test(date)) return false;
  const [year, month, day] = date.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) return false;
  const reconstructed = new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
  return reconstructed === date;
}

export function dateToUtcDay(date: string): number {
  if (!isValidIsoDate(date)) {
    throw new RangeError(`Invalid calendar date: ${date}`);
  }
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day) / MS_PER_DAY;
}

export function utcDayToDate(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

export function makeDate(year: number, month: number, day: number): string {
  const date = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (!isValidIsoDate(date)) {
    throw new RangeError(`Invalid calendar date: ${date}`);
  }
  return date;
}

export function addDays(date: string, days: number): string {
  return utcDayToDate(dateToUtcDay(date) + days);
}

export function calendarDaysBetween(from: string, to: string): number {
  return dateToUtcDay(to) - dateToUtcDay(from);
}

/** 0 = Sunday … 6 = Saturday */
export function dayOfWeek(date: string): number {
  return new Date(dateToUtcDay(date) * MS_PER_DAY).getUTCDay();
}

/** month is 1–12. Day 0 of the following month is the last day of this one. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function yearAndMonth(date: string): { year: number; month: number } {
  dateToUtcDay(date);
  const [year, month] = date.split("-").map(Number) as [number, number];
  return { year, month };
}

/** Shift a (year, month) pair by whole months, e.g. (2026, 12) + 1 = (2027, 1). */
export function addMonths(year: number, month: number, offset: number): { year: number; month: number } {
  const zeroBasedIndex = year * 12 + (month - 1) + offset;
  return { year: Math.floor(zeroBasedIndex / 12), month: (zeroBasedIndex % 12) + 1 };
}

/**
 * The calendar date in the UK at a given instant. Between late March and late October
 * the UK is on BST (UTC+1), so 23:30 UTC is already the next day in London.
 */
export function londonDateFromInstant(instant: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: UK_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(instant);
  const part = (type: "year" | "month" | "day") => parts.find(item => item.type === type)?.value;
  return makeDate(Number(part("year")), Number(part("month")), Number(part("day")));
}
