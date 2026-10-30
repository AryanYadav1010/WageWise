import { addDays, addMonths, dayOfWeek, daysInMonth, makeDate, yearAndMonth } from "./dates.ts";

export type PaySchedule =
  | { kind: "fixed_day_of_month"; dayOfMonth: number }
  | { kind: "last_day_of_month" }
  | { kind: "last_working_day_of_month" };

// What an employer does when the scheduled payday is a weekend or bank holiday.
// This is set by each employer's payroll arrangement, so the caller must choose it.
// There is no single UK legal rule, so we never assume one.
export type NonWorkingDayRule = "unchanged" | "previous_working_day" | "next_working_day";

/** Returns the bank holiday's title, or null if the date is not a bank holiday. */
export type BankHolidayLookup = (date: string) => string | null;

export type SkippedDate = { date: string; reason: string };

export type Payday = {
  scheduledDate: string;
  effectiveDate: string;
  skippedDates: SkippedDate[];
};

// The longest UK run of non-working days is four (e.g. Christmas falling on a Friday).
const MAX_DAYS_TO_SHIFT = 10;

function nonWorkingDayReason(date: string, isBankHoliday: BankHolidayLookup): string | null {
  const holidayTitle = isBankHoliday(date);
  if (holidayTitle !== null) return holidayTitle;
  const weekday = dayOfWeek(date);
  if (weekday === 6) return "Saturday";
  if (weekday === 0) return "Sunday";
  return null;
}

function shiftToWorkingDay(date: string, direction: -1 | 1, isBankHoliday: BankHolidayLookup) {
  const skippedDates: SkippedDate[] = [];
  let candidate = date;
  for (let attempt = 0; attempt <= MAX_DAYS_TO_SHIFT; attempt += 1) {
    const reason = nonWorkingDayReason(candidate, isBankHoliday);
    if (reason === null) return { date: candidate, skippedDates };
    skippedDates.push({ date: candidate, reason });
    candidate = addDays(candidate, direction);
  }
  throw new RangeError(`No working day within ${MAX_DAYS_TO_SHIFT} days of ${date}`);
}

/**
 * A fixed day that does not exist in a month (e.g. the 31st in February) is moved to
 * the last day of that month. Some employers pay on the 1st of the next month instead.
 * That variant is not modelled and is documented as a limitation.
 */
export function paydayForMonth(
  year: number,
  month: number,
  schedule: PaySchedule,
  rule: NonWorkingDayRule,
  isBankHoliday: BankHolidayLookup
): Payday {
  const lastDayOfMonth = makeDate(year, month, daysInMonth(year, month));

  if (schedule.kind === "last_working_day_of_month") {
    // The schedule itself names a working day, so nothing was "moved" or skipped.
    const lastWorkingDay = shiftToWorkingDay(lastDayOfMonth, -1, isBankHoliday).date;
    return { scheduledDate: lastWorkingDay, effectiveDate: lastWorkingDay, skippedDates: [] };
  }

  const scheduledDate = schedule.kind === "fixed_day_of_month"
    ? makeDate(year, month, Math.min(schedule.dayOfMonth, daysInMonth(year, month)))
    : lastDayOfMonth;

  if (rule === "unchanged") {
    return { scheduledDate, effectiveDate: scheduledDate, skippedDates: [] };
  }
  const direction = rule === "previous_working_day" ? -1 : 1;
  const shifted = shiftToWorkingDay(scheduledDate, direction, isBankHoliday);
  return { scheduledDate, effectiveDate: shifted.date, skippedDates: shifted.skippedDates };
}

/**
 * The first payday on or after `today`. An adjusted payday can cross a month boundary:
 * e.g. pay due on the 1st but moved to the previous Friday in the prior month, or pay due
 * on the 28th moved forward into the next month. So we check the surrounding months and
 * take the earliest effective date that has not already passed.
 */
export function nextPayday(
  today: string,
  schedule: PaySchedule,
  rule: NonWorkingDayRule,
  isBankHoliday: BankHolidayLookup
): Payday {
  const { year, month } = yearAndMonth(today);
  const candidates = [-1, 0, 1, 2].map(offset => {
    const target = addMonths(year, month, offset);
    return paydayForMonth(target.year, target.month, schedule, rule, isBankHoliday);
  });
  // ISO dates compare correctly as strings.
  const upcoming = candidates
    .filter(payday => payday.effectiveDate >= today)
    .sort((first, second) => first.effectiveDate.localeCompare(second.effectiveDate));
  const earliest = upcoming[0];
  if (earliest === undefined) {
    throw new RangeError(`Could not find a payday on or after ${today}`);
  }
  return earliest;
}
