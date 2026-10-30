import { describe, expect, it } from "vitest";
import {
  bankHolidayLookup, holidayCoverage, loadHolidaySnapshot, MissingHolidayDataError, parseHolidaySnapshot
} from "../src/domain/bank-holidays.ts";
import { fixtureSnapshot } from "./helpers.ts";

describe("bank holiday snapshot", () => {
  it("loads and validates the bundled snapshot the API uses", () => {
    const snapshot = loadHolidaySnapshot();
    expect(snapshot.source).toBe("https://www.gov.uk/bank-holidays.json");
    expect(snapshot.licence).toMatch(/Open Government Licence/);
  });

  it("reports the years the data covers", () => {
    expect(holidayCoverage(fixtureSnapshot, "scotland")).toEqual({ coversFrom: "2019-01-01", coversTo: "2028-12-31" });
  });

  it("returns holiday titles and null for working days", () => {
    const lookup = bankHolidayLookup(fixtureSnapshot, "england-and-wales");
    expect(lookup("2026-12-25")).toBe("Christmas Day");
    expect(lookup("2026-12-24")).toBeNull();
  });

  it("fails closed for dates outside the published data instead of guessing", () => {
    const lookup = bankHolidayLookup(fixtureSnapshot, "england-and-wales");
    expect(() => lookup("2029-01-01")).toThrow(MissingHolidayDataError);
    expect(() => lookup("2018-12-25")).toThrow(MissingHolidayDataError);
  });

  it("rejects a snapshot from an unexpected source", () => {
    expect(() => parseHolidaySnapshot({ ...fixtureSnapshot, source: "https://example.com/holidays.json" })).toThrow();
  });

  it("rejects a feed with an impossible date", () => {
    const tampered = structuredClone(fixtureSnapshot);
    tampered.data.scotland.events[0] = { title: "Bad", date: "2026-02-30", notes: "", bunting: false };
    expect(() => parseHolidaySnapshot(tampered)).toThrow();
  });

  it("rejects a feed missing a jurisdiction", () => {
    const { "northern-ireland": _omitted, ...partialData } = fixtureSnapshot.data;
    expect(() => parseHolidaySnapshot({ ...fixtureSnapshot, data: partialData })).toThrow();
  });
});
