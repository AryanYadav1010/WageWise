import { loadConfig, type AppConfig } from "../src/config.ts";
import { bankHolidayLookup, loadHolidaySnapshot, type Jurisdiction } from "../src/domain/bank-holidays.ts";

// A frozen copy of the GOV.UK feed (2019–2028), so refreshing the live snapshot
// can never change what these tests expect.
export const fixtureSnapshot = loadHolidaySnapshot(new URL("./fixtures/bank-holidays-2019-2028.json", import.meta.url));

export function holidaysFor(jurisdiction: Jurisdiction) {
  return bankHolidayLookup(fixtureSnapshot, jurisdiction);
}

export const noBankHolidays = () => null;

export function testConfig(overrides: Partial<Record<keyof AppConfig, string>> = {}): AppConfig {
  return loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", ...overrides });
}
