// Original summaries written for this project, NOT extracted passages. MoneyHelper, FCA and FSCS are
// links only: their content is never fetched, stored, embedded or sent to the model, because reuse
// rights for it haven't been checked. Linking implies no endorsement or relationship.
export type SourceLink = {
  title: string;
  url: string;
  description: string;
  topic: string;
  jurisdiction: "uk" | "england-and-wales";
  publisher: string;
};

export const directory: readonly SourceLink[] = [
  {
    title: "What your tax code means",
    url: "https://www.gov.uk/tax-codes/what-your-tax-code-means",
    description: "Understand tax codes, PAYE payroll deductions and tax code letters.",
    topic: "tax_codes", jurisdiction: "uk", publisher: "GOV.UK"
  },
  {
    title: "Income Tax rates and allowances",
    url: "https://www.gov.uk/income-tax-rates",
    description: "Explore UK income tax, allowances, rates and tax-year rules.",
    topic: "income_tax", jurisdiction: "uk", publisher: "GOV.UK"
  },
  {
    title: "Joining a workplace pension",
    url: "https://www.gov.uk/workplace-pensions/joining-a-workplace-pension",
    description: "Learn about workplace pensions, automatic enrolment and pension contributions.",
    topic: "pensions", jurisdiction: "uk", publisher: "GOV.UK"
  },
  {
    title: "Statutory Sick Pay",
    url: "https://www.gov.uk/statutory-sick-pay",
    description: "Find official guidance on statutory sick pay eligibility and payments.",
    topic: "sick_pay", jurisdiction: "uk", publisher: "GOV.UK"
  },
  {
    title: "UK bank holidays",
    url: "https://www.gov.uk/bank-holidays",
    description: "Check bank holidays and regional dates that can affect payroll schedules.",
    topic: "bank_holidays", jurisdiction: "uk", publisher: "GOV.UK"
  },
  {
    title: "Understanding your pay",
    url: "https://www.gov.uk/understanding-your-pay",
    description: "Understand payslips, deductions and what your employer must show you.",
    topic: "payslips", jurisdiction: "uk", publisher: "GOV.UK"
  },
  {
    title: "Spot and avoid investment scams",
    url: "https://www.fca.org.uk/scamsmart",
    description: "Check an investment or pension offer and learn how to avoid financial scams.",
    topic: "scams", jurisdiction: "uk", publisher: "FCA"
  },
  {
    title: "Financial Services Compensation Scheme",
    url: "https://www.fscs.org.uk/",
    description: "Find out how your savings and financial products are protected if a firm fails.",
    topic: "consumer_protection", jurisdiction: "uk", publisher: "FSCS"
  },
  {
    title: "MoneyHelper",
    url: "https://www.moneyhelper.org.uk/en",
    description: "Free guidance on budgeting, saving, debt, borrowing, pensions and scams.",
    topic: "money_guidance", jurisdiction: "uk", publisher: "MoneyHelper"
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
