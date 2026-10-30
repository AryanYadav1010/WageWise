import { describe, expect, it } from "vitest";
import {
  addMonths, calendarDaysBetween, dateToUtcDay, dayOfWeek, daysInMonth, isValidIsoDate, londonDateFromInstant
} from "../src/domain/dates.ts";

describe("calendar date validation", () => {
  it("accepts real dates including leap days", () => {
    expect(isValidIsoDate("2028-02-29")).toBe(true);
    expect(isValidIsoDate("2000-02-29")).toBe(true);
  });

  it("rejects impossible or malformed dates", () => {
    expect(isValidIsoDate("2026-02-29")).toBe(false);
    expect(isValidIsoDate("2100-02-29")).toBe(false);
    expect(isValidIsoDate("2026-04-31")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("26-10-28")).toBe(false);
    expect(isValidIsoDate("2026-10-28T00:00:00Z")).toBe(false);
    expect(() => dateToUtcDay("2026-02-30")).toThrow(RangeError);
  });
});

describe("leap years and month lengths", () => {
  it("knows February's length in leap and non-leap years", () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2100, 2)).toBe(28); // divisible by 100 but not 400
    expect(daysInMonth(2000, 2)).toBe(29); // divisible by 400
  });

  it("knows 30- and 31-day months", () => {
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it("counts across a leap day", () => {
    expect(calendarDaysBetween("2028-02-28", "2028-03-01")).toBe(2);
    expect(calendarDaysBetween("2027-02-28", "2027-03-01")).toBe(1);
  });

  it("moves between months across year boundaries", () => {
    expect(addMonths(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(addMonths(2026, 11, 2)).toEqual({ year: 2027, month: 1 });
  });
});

describe("BST/GMT transitions", () => {
  // 2026: clocks go forward 29 March at 01:00 UTC, back 25 October at 01:00 UTC.
  it("counts a calendar day as one day even when the clock changes", () => {
    expect(calendarDaysBetween("2026-03-28", "2026-03-30")).toBe(2);
    expect(calendarDaysBetween("2026-10-24", "2026-10-26")).toBe(2);
  });

  it("uses the same date as UTC late in the evening during GMT", () => {
    expect(londonDateFromInstant(new Date("2026-01-31T23:30:00Z"))).toBe("2026-01-31");
    expect(londonDateFromInstant(new Date("2026-03-28T23:30:00Z"))).toBe("2026-03-28");
    expect(londonDateFromInstant(new Date("2026-10-25T23:30:00Z"))).toBe("2026-10-25");
  });

  it("is already the next day in London late in the evening UTC during BST", () => {
    expect(londonDateFromInstant(new Date("2026-03-29T23:30:00Z"))).toBe("2026-03-30");
    expect(londonDateFromInstant(new Date("2026-06-30T23:30:00Z"))).toBe("2026-07-01");
    expect(londonDateFromInstant(new Date("2026-10-24T23:30:00Z"))).toBe("2026-10-25");
  });

  it("handles the instants either side of each clock change", () => {
    expect(londonDateFromInstant(new Date("2026-03-29T00:59:59Z"))).toBe("2026-03-29");
    expect(londonDateFromInstant(new Date("2026-10-25T00:59:59Z"))).toBe("2026-10-25");
    expect(londonDateFromInstant(new Date("2026-10-25T01:00:00Z"))).toBe("2026-10-25");
  });
});

describe("day of week", () => {
  it("matches known dates", () => {
    expect(dayOfWeek("2026-10-28")).toBe(3); // Wednesday
    expect(dayOfWeek("2026-01-31")).toBe(6); // Saturday
    expect(dayOfWeek("2026-02-01")).toBe(0); // Sunday
  });
});
