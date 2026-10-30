import { readFileSync } from "node:fs";
import { z } from "zod";
import { isValidIsoDate } from "./dates.ts";
import type { BankHolidayLookup } from "./payday.ts";

export const BANK_HOLIDAYS_SOURCE_URL = "https://www.gov.uk/bank-holidays.json";
export const JURISDICTIONS = ["england-and-wales", "scotland", "northern-ireland"] as const;
export type Jurisdiction = (typeof JURISDICTIONS)[number];

const DEFAULT_SNAPSHOT_URL = new URL("../../data/bank-holidays.json", import.meta.url);

const isoDate = z.string().refine(isValidIsoDate, "Invalid calendar date");

const divisionSchema = z.object({
  division: z.enum(JURISDICTIONS),
  events: z.array(z.object({
    title: z.string().min(1),
    date: isoDate,
    notes: z.string(),
    bunting: z.boolean()
  })).min(1)
});

/** Shape of the official GOV.UK bank holidays feed. */
export const govukBankHolidaysSchema = z.object({
  "england-and-wales": divisionSchema,
  "scotland": divisionSchema,
  "northern-ireland": divisionSchema
});

const snapshotSchema = z.object({
  source: z.literal(BANK_HOLIDAYS_SOURCE_URL),
  licence: z.string().min(1),
  fetchedAt: z.string().datetime(),
  contentSha256: z.string().length(64),
  data: govukBankHolidaysSchema
});
export type BankHolidaySnapshot = z.infer<typeof snapshotSchema>;

export class MissingHolidayDataError extends Error {
  constructor(date: string, coversFrom: string, coversTo: string) {
    super(`Bank holiday data covers ${coversFrom} to ${coversTo}; ${date} is outside that range`);
    this.name = "MissingHolidayDataError";
  }
}

export function parseHolidaySnapshot(raw: unknown): BankHolidaySnapshot {
  return snapshotSchema.parse(raw);
}

export function loadHolidaySnapshot(fileUrl: URL = DEFAULT_SNAPSHOT_URL): BankHolidaySnapshot {
  return parseHolidaySnapshot(JSON.parse(readFileSync(fileUrl, "utf8")));
}

export type HolidayCoverage = { coversFrom: string; coversTo: string };

// GOV.UK publishes whole calendar years, so coverage runs from 1 January of the
// earliest year to 31 December of the latest year listed for that division.
export function holidayCoverage(snapshot: BankHolidaySnapshot, jurisdiction: Jurisdiction): HolidayCoverage {
  const years = snapshot.data[jurisdiction].events.map(event => Number(event.date.slice(0, 4)));
  return { coversFrom: `${Math.min(...years)}-01-01`, coversTo: `${Math.max(...years)}-12-31` };
}

/**
 * Builds a lookup that refuses to answer for dates outside the published data. Silently
 * treating an unknown date as a working day would be guessing, so we fail closed instead.
 */
export function bankHolidayLookup(snapshot: BankHolidaySnapshot, jurisdiction: Jurisdiction): BankHolidayLookup {
  const titlesByDate = new Map(snapshot.data[jurisdiction].events.map(event => [event.date, event.title]));
  const { coversFrom, coversTo } = holidayCoverage(snapshot, jurisdiction);
  return (date: string) => {
    if (date < coversFrom || date > coversTo) {
      throw new MissingHolidayDataError(date, coversFrom, coversTo);
    }
    return titlesByDate.get(date) ?? null;
  };
}
