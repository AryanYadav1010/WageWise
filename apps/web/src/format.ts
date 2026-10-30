const MAX_PENCE = 100_000_000;

/**
 * Converts a pounds string the user typed ("12", "12.5", "12.50") to integer pence
 * using string handling only, so no floating-point rounding is involved.
 * Returns null for anything that is not a non-negative amount with at most two decimals.
 */
export function poundsToPence(pounds: string): number | null {
  const trimmed = pounds.trim().replaceAll(",", "");
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole = "0", fraction = ""] = trimmed.split(".");
  const pence = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(pence) || pence > MAX_PENCE) return null;
  return pence;
}

const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });

export function formatPence(pence: number): string {
  return gbp.format(pence / 100);
}

// Calendar dates from the API have no time zone. Formatting them in UTC stops the
// browser's own time zone from shifting the displayed day.
const ukDate = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function formatIsoDate(date: string): string {
  return ukDate.format(new Date(`${date}T00:00:00Z`));
}

export type CitedText = { text: string; sourceIds: string[] };

/** Joins neighbouring sentences that cite the same sources, so one marker closes the run instead of repeating. */
export function groupCitations(sentences: readonly CitedText[]): CitedText[] {
  const key = (ids: readonly string[]) => [...ids].sort().join(",");
  const runs: CitedText[] = [];
  for (const sentence of sentences) {
    const last = runs.at(-1);
    if (last !== undefined && key(last.sourceIds) === key(sentence.sourceIds)) last.text = `${last.text} ${sentence.text}`;
    else runs.push({ text: sentence.text, sourceIds: [...sentence.sourceIds] });
  }
  return runs;
}

/** "S3" → "3": the number shown to people for a source id. */
export function sourceNumber(id: string): string {
  return id.replace(/^S/, "");
}
