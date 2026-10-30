// Refreshes the bundled bank holiday snapshot from the official GOV.UK feed.
// Usage: npm run holidays:refresh
// The scheduled freshness worker (milestone 5) will run the same logic on a timer.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { BANK_HOLIDAYS_SOURCE_URL, govukBankHolidaysSchema, parseHolidaySnapshot } from "../domain/bank-holidays.ts";

const SNAPSHOT_URL = new URL("../../data/bank-holidays.json", import.meta.url);

const response = await fetch(BANK_HOLIDAYS_SOURCE_URL, {
  headers: { Accept: "application/json", "User-Agent": "WageWiseUK-portfolio/0.1" },
  signal: AbortSignal.timeout(10_000),
  redirect: "error"
});
if (!response.ok) {
  throw new Error(`GOV.UK bank holidays request failed (${response.status})`);
}

const body = await response.text();
// Validate before writing so a malformed or changed feed never replaces good data.
const data = govukBankHolidaysSchema.parse(JSON.parse(body));
const snapshot = parseHolidaySnapshot({
  source: BANK_HOLIDAYS_SOURCE_URL,
  licence: "Contains public sector information licensed under the Open Government Licence v3.0",
  fetchedAt: new Date().toISOString(),
  contentSha256: createHash("sha256").update(body).digest("hex"),
  data
});

writeFileSync(SNAPSHOT_URL, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(JSON.stringify({ written: SNAPSHOT_URL.pathname, fetchedAt: snapshot.fetchedAt, contentSha256: snapshot.contentSha256 }));
