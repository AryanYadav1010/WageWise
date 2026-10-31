import type { Nation } from "./search.ts";

// People name a nation in their question as often as they pick one in the app, and both must mean
// the same thing. So a nation in the text becomes the nation filter and leaves the search text.
// Left in, it counts as evidence the guidance can't supply: no approved chunk says "England".

// "in English" is a language and "Bank of England" isn't a place someone pays tax. "NI" stays out:
// here it nearly always means National Insurance.
const NATION_NAMES: readonly (readonly [Nation, string])[] = [
  ["england", String.raw`(?<!\bnew |\bbank of )england|(?<!\b(?:in|plain|simple) )english`],
  ["scotland", String.raw`(?<!\bbank of )scotland(?! yard)|scottish|scots`],
  ["wales", String.raw`(?<!\bnew south )wales|welsh`],
  ["northern-ireland", String.raw`northern ireland|northern irish`]
];
const NATION_PATTERNS = NATION_NAMES.map(([nation, names]) => [nation, new RegExp(`(?:\\b(?:in|for|across|within) +)?\\b(?:${names})\\b(?:['’]s)?`, "gi")] as const);

export type Jurisdiction = {
  /** The nation to filter on: the one selected, or else the only one the question names. */
  nation: Nation | null;
  /** Every nation the question names. */
  named: Nation[];
  /** The question names a nation, but a different one is selected: ask, don't choose. */
  conflict: boolean;
  /** The question without nation names, and with any tax year in GOV.UK's wording: what is searched for. */
  text: string;
};

const TAX_YEAR = /\b(20\d{2}) *(?:to|\/|-|–|—) *(?:20)?(\d{2})\b/i;
const isNextYear = (start: string, end: string) => (Number(start) + 1) % 100 === Number(end);

export function readJurisdiction(question: string, selected: Nation | null): Jurisdiction {
  const named = NATION_PATTERNS.filter(([, pattern]) => question.match(pattern) !== null).map(([nation]) => nation);
  const stripped = NATION_PATTERNS.reduce((text, [, pattern]) => text.replace(pattern, " "), question);
  const text = (stripped.replace(/\s+/g, " ").replace(/\s+([?.!,])/g, "$1").trim() || question).replace(TAX_YEAR, (year, start: string, end: string) => isNextYear(start, end) ? `${start} to ${Number(start) + 1}` : year);
  return {
    nation: selected ?? (named.length === 1 ? named[0] ?? null : null),
    named,
    conflict: selected !== null && named.length > 0 && !named.includes(selected),
    text
  };
}

/** The first day of a tax year named in the question ("2025 to 2026", "2025/26"), or null. Rules are filtered by date, so a named year must set it. */
export function taxYearStart(question: string): string | null {
  const [, start, end] = TAX_YEAR.exec(question) ?? [];
  return start !== undefined && end !== undefined && isNextYear(start, end) ? `${start}-04-06` : null;
}
