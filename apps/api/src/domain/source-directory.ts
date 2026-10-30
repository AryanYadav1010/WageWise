// Original topic summaries written for this prototype; these are NOT extracted GOV.UK passages.
export type SourceLink = {
  title: string;
  url: string;
  description: string;
  topic: string;
  jurisdiction: "uk" | "england-and-wales";
};

export const directory: readonly SourceLink[] = [
  {
    title: "What your tax code means",
    url: "https://www.gov.uk/tax-codes/what-your-tax-code-means",
    description: "Understand tax codes, PAYE payroll deductions and tax code letters.",
    topic: "tax_codes", jurisdiction: "uk"
  },
  {
    title: "Income Tax rates and allowances",
    url: "https://www.gov.uk/income-tax-rates",
    description: "Explore UK income tax, allowances, rates and tax-year rules.",
    topic: "income_tax", jurisdiction: "uk"
  },
  {
    title: "Joining a workplace pension",
    url: "https://www.gov.uk/workplace-pensions/joining-a-workplace-pension",
    description: "Learn about workplace pensions, automatic enrolment and pension contributions.",
    topic: "pensions", jurisdiction: "uk"
  },
  {
    title: "Statutory Sick Pay",
    url: "https://www.gov.uk/statutory-sick-pay",
    description: "Find official guidance on statutory sick pay eligibility and payments.",
    topic: "sick_pay", jurisdiction: "uk"
  },
  {
    title: "UK bank holidays",
    url: "https://www.gov.uk/bank-holidays",
    description: "Check bank holidays and regional dates that can affect payroll schedules.",
    topic: "bank_holidays", jurisdiction: "uk"
  }
];

const stopWords = new Set(["the", "in", "a", "an", "is", "my", "can", "i", "what", "how", "does", "do", "me", "of", "for", "on", "about", "and", "to", "uk"]);
function terms(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g)?.filter(term => term.length > 1 && !stopWords.has(term)) ?? [];
}

export function findSourceLinks(question: string, limit = 5): SourceLink[] {
  const tokens = [...new Set(terms(question))];
  if (tokens.length === 0) return [];
  return directory.map(source => {
    const titleTerms = new Set(terms(source.title));
    const descriptionTerms = new Set(terms(source.description));
    const topicTerms = new Set(terms(source.topic.replaceAll("_", " ")));
    const score = tokens.reduce((sum, token) => sum +
      (titleTerms.has(token) ? 3 : 0) +
      (topicTerms.has(token) ? 2 : 0) +
      (descriptionTerms.has(token) ? 1 : 0), 0);
    return { source, score };
  }).filter(result => result.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(result => result.source);
}
