import { readFileSync } from "node:fs";

export type FixtureName = "tax-codes" | "income-tax-rates" | "welsh-income-tax" | "scottish-income-tax" | "national-insurance" | "redundant-your-rights" | "plan-for-retirement";

/** Raw JSON text of a trimmed real Content API response (see fixtures/govuk/README.md). */
export function fixtureBody(name: FixtureName): string {
  return readFileSync(new URL(`./fixtures/govuk/${name}.json`, import.meta.url), "utf8");
}

export function fixtureJson(name: FixtureName): Record<string, unknown> {
  return JSON.parse(fixtureBody(name)) as Record<string, unknown>;
}
