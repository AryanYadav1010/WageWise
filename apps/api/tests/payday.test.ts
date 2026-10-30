import { describe, expect, it } from "vitest";
import { nextPayday, paydayForMonth } from "../src/domain/payday.ts";
import { holidaysFor, noBankHolidays } from "./helpers.ts";

const englandAndWales = holidaysFor("england-and-wales");
const scotland = holidaysFor("scotland");
const northernIreland = holidaysFor("northern-ireland");

describe("end-of-month schedules", () => {
  it("moves a fixed day that does not exist to the last day of the month", () => {
    const schedule = { kind: "fixed_day_of_month", dayOfMonth: 31 } as const;
    expect(paydayForMonth(2026, 4, schedule, "unchanged", noBankHolidays).effectiveDate).toBe("2026-04-30");
    expect(paydayForMonth(2027, 2, schedule, "unchanged", noBankHolidays).effectiveDate).toBe("2027-02-28");
  });

  it("uses 29 February in a leap year", () => {
    const schedule = { kind: "fixed_day_of_month", dayOfMonth: 30 } as const;
    expect(paydayForMonth(2028, 2, schedule, "unchanged", noBankHolidays).effectiveDate).toBe("2028-02-29");
    expect(paydayForMonth(2028, 2, { kind: "last_day_of_month" }, "unchanged", noBankHolidays).effectiveDate).toBe("2028-02-29");
  });

  it("finds the last working day when the month ends on a weekend", () => {
    // 31 January 2026 is a Saturday.
    const payday = paydayForMonth(2026, 1, { kind: "last_working_day_of_month" }, "unchanged", englandAndWales);
    expect(payday).toEqual({ scheduledDate: "2026-01-30", effectiveDate: "2026-01-30", skippedDates: [] });
  });

  it("applies the rule after clamping, e.g. 28 Feb 2027 is a Sunday", () => {
    const schedule = { kind: "fixed_day_of_month", dayOfMonth: 31 } as const;
    expect(paydayForMonth(2027, 2, schedule, "previous_working_day", englandAndWales).effectiveDate).toBe("2027-02-26");
    expect(paydayForMonth(2027, 2, schedule, "next_working_day", englandAndWales).effectiveDate).toBe("2027-03-01");
  });
});

describe("weekends and bank holidays", () => {
  it("leaves the date alone when the rule is unchanged, even on a holiday", () => {
    const payday = paydayForMonth(2026, 12, { kind: "fixed_day_of_month", dayOfMonth: 25 }, "unchanged", englandAndWales);
    expect(payday.effectiveDate).toBe("2026-12-25");
    expect(payday.skippedDates).toEqual([]);
  });

  it("skips Christmas, the weekend and the Boxing Day substitute day", () => {
    const payday = paydayForMonth(2026, 12, { kind: "fixed_day_of_month", dayOfMonth: 28 }, "previous_working_day", englandAndWales);
    expect(payday.scheduledDate).toBe("2026-12-28");
    expect(payday.effectiveDate).toBe("2026-12-24");
    expect(payday.skippedDates).toEqual([
      { date: "2026-12-28", reason: "Boxing Day" },
      { date: "2026-12-27", reason: "Sunday" },
      { date: "2026-12-26", reason: "Saturday" },
      { date: "2026-12-25", reason: "Christmas Day" }
    ]);
  });

  it("moves forward past the Easter weekend with next_working_day", () => {
    const payday = paydayForMonth(2026, 4, { kind: "fixed_day_of_month", dayOfMonth: 3 }, "next_working_day", englandAndWales);
    expect(payday.effectiveDate).toBe("2026-04-07"); // Good Friday, weekend, Easter Monday
  });

  it("gives up rather than looping forever if no working day is found", () => {
    const everyDayIsAHoliday = () => "Test holiday";
    expect(() => paydayForMonth(2026, 1, { kind: "fixed_day_of_month", dayOfMonth: 15 }, "previous_working_day", everyDayIsAHoliday))
      .toThrow(RangeError);
  });
});

describe("jurisdiction-specific bank holidays", () => {
  it("Easter Monday is a holiday in England and Wales but not Scotland", () => {
    const schedule = { kind: "fixed_day_of_month", dayOfMonth: 6 } as const;
    expect(paydayForMonth(2026, 4, schedule, "previous_working_day", englandAndWales).effectiveDate).toBe("2026-04-02");
    expect(paydayForMonth(2026, 4, schedule, "previous_working_day", scotland).effectiveDate).toBe("2026-04-06");
  });

  it("St Andrew's Day is a holiday in Scotland only", () => {
    const schedule = { kind: "fixed_day_of_month", dayOfMonth: 30 } as const;
    expect(paydayForMonth(2026, 11, schedule, "previous_working_day", scotland).effectiveDate).toBe("2026-11-27");
    expect(paydayForMonth(2026, 11, schedule, "previous_working_day", englandAndWales).effectiveDate).toBe("2026-11-30");
  });

  it("the Battle of the Boyne substitute day is a holiday in Northern Ireland only", () => {
    const schedule = { kind: "fixed_day_of_month", dayOfMonth: 13 } as const;
    expect(paydayForMonth(2026, 7, schedule, "next_working_day", northernIreland).effectiveDate).toBe("2026-07-14");
    expect(paydayForMonth(2026, 7, schedule, "next_working_day", englandAndWales).effectiveDate).toBe("2026-07-13");
  });

  it("the summer bank holiday falls on different dates in Scotland and England", () => {
    const schedule = { kind: "last_working_day_of_month" } as const;
    expect(paydayForMonth(2026, 8, schedule, "unchanged", englandAndWales).effectiveDate).toBe("2026-08-28");
    expect(paydayForMonth(2026, 8, schedule, "unchanged", scotland).effectiveDate).toBe("2026-08-31");
  });

  it("uses one-off holidays from the data, such as Scotland's 2026 World Cup bank holiday", () => {
    const payday = paydayForMonth(2026, 6, { kind: "fixed_day_of_month", dayOfMonth: 15 }, "previous_working_day", scotland);
    expect(payday.effectiveDate).toBe("2026-06-12");
    expect(payday.skippedDates[0]).toEqual({ date: "2026-06-15", reason: "World Cup bank holiday" });
  });
});

describe("next payday", () => {
  const fifteenth = { kind: "fixed_day_of_month", dayOfMonth: 15 } as const;

  it("returns today's payday when today is payday", () => {
    expect(nextPayday("2026-10-15", fifteenth, "unchanged", englandAndWales).effectiveDate).toBe("2026-10-15");
  });

  it("rolls into the next month once this month's payday has passed", () => {
    expect(nextPayday("2026-10-16", fifteenth, "unchanged", englandAndWales).effectiveDate).toBe("2026-11-15");
  });

  it("rolls into the next year", () => {
    expect(nextPayday("2026-12-29", { kind: "last_working_day_of_month" }, "unchanged", englandAndWales).effectiveDate)
      .toBe("2026-12-31");
    expect(nextPayday("2027-01-01", fifteenth, "unchanged", englandAndWales).effectiveDate).toBe("2027-01-15");
  });

  it("finds a payday that was moved back into the previous month", () => {
    // Pay due on the 1st. 1 Feb 2026 is a Sunday, so February's pay arrives Friday 30 Jan.
    const firstOfMonth = { kind: "fixed_day_of_month", dayOfMonth: 1 } as const;
    expect(nextPayday("2026-01-29", firstOfMonth, "previous_working_day", englandAndWales).effectiveDate).toBe("2026-01-30");
    // On Saturday 31 Jan that has passed, and 1 March 2026 is also a Sunday: next is Fri 27 Feb.
    expect(nextPayday("2026-01-31", firstOfMonth, "previous_working_day", englandAndWales).effectiveDate).toBe("2026-02-27");
  });

  it("finds a payday that was moved forward into the following month", () => {
    // Last day of February 2026 is a Saturday; with next_working_day it is paid Monday 2 March.
    const payday = nextPayday("2026-03-01", { kind: "last_day_of_month" }, "next_working_day", englandAndWales);
    expect(payday.scheduledDate).toBe("2026-02-28");
    expect(payday.effectiveDate).toBe("2026-03-02");
  });
});
