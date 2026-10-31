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
const ANY_NATION = NATION_NAMES.map(([, names]) => names).join("|");
const NATION_PAIR = new RegExp(`\\b(?:${ANY_NATION})\\b(?:['’]s)?,?\\s+(?:and|or|vs\\.?|versus)\\s+(?:(?:in|for)\\s+)?\\b(?:${ANY_NATION})\\b`, "i");
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

/** "Scotland and Wales" is a pair. "I live in Scotland and work in Wales" isn't. */
export function namesPairOfNations(question: string): boolean {
  return NATION_PAIR.test(question);
}

const TAX_YEAR = /\b(20\d{2}) *(?:to|\/|-|–|—) *(?:20)?(\d{2})\b/i;
const EVERY_TAX_YEAR = new RegExp(TAX_YEAR.source, "gi");
const isNextYear = (start: string, end: string) => (Number(start) + 1) % 100 === Number(end);
const RELATIVE_YEAR = /\b(?:the +)?(?:(last|previous|this|current|next)(?: +tax)? +year|(past) +tax +year)(?:['’]s)?\b/gi;
const YEAR_OFFSETS: Record<string, number> = { last: -1, previous: -1, past: -1, next: 1 };

/** The first day of the tax year containing a date: tax years start on 6 April. */
export function currentTaxYearStart(date: string): string {
  const year = Number(date.slice(0, 4));
  return `${date >= `${year}-04-06` ? year : year - 1}-04-06`;
}

/** Years counted from the one under discussion, not from today. */
const YEAR_BEFORE = /\b(?:the +)?(?:(?:tax +)?year +before(?: +that)?|(?:previous|prior)(?: +tax)? +year)\b/gi;
const YEAR_AFTER = /\b(?:the +)?(?:(?:tax +)?year +after(?: +that)?|following(?: +tax)? +year)\b/gi;

/**
 * Puts "last tax year" into words the rest of the app understands, so a year is only ever worked out once.
 * "Last tax year" counts from today. In a conversation, "the year before" counts from the year just discussed.
 */
export function pinTaxYear(question: string, today: string, discussed?: string): string {
  const year = Number(currentTaxYearStart(today).slice(0, 4));
  const inContext = (start: number) => `the ${start} to ${start + 1} tax year`;
  const base = discussed === undefined ? null : Number(taxYearStart(discussed)?.slice(0, 4) ?? year);
  const anchored = base === null ? question : question.replace(YEAR_BEFORE, inContext(base - 1)).replace(YEAR_AFTER, inContext(base + 1));
  return anchored.replace(RELATIVE_YEAR, (_, near?: string, past?: string) => {
    const start = year + (YEAR_OFFSETS[(near ?? past ?? "").toLowerCase()] ?? 0);
    return `the ${start} to ${start + 1} tax year`;
  });
}

/** The tax year a question names, in GOV.UK's wording ("2025 to 2026"), or null. */
export function taxYearIn(question: string): string | null {
  const start = taxYearStart(question)?.slice(0, 4);
  return start === undefined ? null : `${start} to ${Number(start) + 1}`;
}

/** Every different tax year a question names, in GOV.UK's wording. */
export function taxYearsIn(question: string): string[] {
  const years = [...question.matchAll(EVERY_TAX_YEAR)].flatMap(([, start, end]) => start !== undefined && end !== undefined && isNextYear(start, end) ? [`${start} to ${Number(start) + 1}`] : []);
  return [...new Set(years)];
}

/** The question with a different tax year: swapped if it names one, added if it doesn't. */
export function withTaxYear(question: string, year: string): string {
  return taxYearIn(question) === null ? `${question.replace(/[?.!\s]*$/, "")} in ${year}?` : question.replace(TAX_YEAR, year);
}

// How people ask, not what they're asking about. Left in, these words dilute the search and count as evidence the guidance can't supply.
const FRAMING = /^(?:(?:can|could|would|will) +you +)?(?:please +)?(?:tell|give|show) +me(?: +about)?\b|^i(?: +(?:want|need|would +like)|['’]d +like) +to +(?:know|find +out|check)(?: +about)?\b|\bplease\b/gi;

/** What the search should look for. A named nation and year are filters, so neither is evidence. */
export function searchSubject(text: string): string {
  const subject = withoutTaxYear(text).replace(FRAMING, " ").replace(/\s+/g, " ").replace(/\s+([?.!,])/g, "$1").trim();
  return subject.length >= 3 ? subject : text;
}

/** The question itself, after any background. "I earn £40,000. What is the higher rate?" must be covered for its question, not for the salary. */
export function finalQuestion(text: string): string {
  return text.endsWith("?") ? text.split(/(?<=[.!])\s+/).at(-1) ?? text : text;
}

/** The question with any tax year removed, for reading what else it asks. */
export function withoutTaxYear(question: string): string {
  return question.replace(new RegExp(`(?:the +)?${TAX_YEAR.source}(?: +tax +year)?`, "gi"), " ");
}

export function readJurisdiction(question: string, selected: Nation | null): Jurisdiction {
  // In the order the question names them, so a comparison reads the way it was asked.
  const named = NATION_PATTERNS.map(([nation, pattern]) => [nation, question.search(pattern)] as const).filter(([, at]) => at >= 0).sort(([, a], [, b]) => a - b).map(([nation]) => nation);
  const stripped = NATION_PATTERNS.reduce((text, [, pattern]) => text.replace(pattern, " "), question);
  const text = (stripped.replace(/\s+/g, " ").replace(/\s+([?.!,])/g, "$1").trim() || question).replace(EVERY_TAX_YEAR, (year, start: string, end: string) => isNextYear(start, end) ? `${start} to ${Number(start) + 1}` : year);
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
