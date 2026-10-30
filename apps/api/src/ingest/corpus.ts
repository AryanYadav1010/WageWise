import { z } from "zod";
import { isValidIsoDate } from "../domain/dates.ts";
import { isSafeGovukPath } from "./govuk.ts";
import { applyLicenceReviews, loadLicenceReviews, reviewSchema } from "./licence-reviews.ts";

// Curated GOV.UK guides for ingestion. Researched against the live Content API on
// 28 Oct 2026: every path returned HTTP 200 with schema "guide" or "answer", no
// withdrawal notice and no images. Paths are guide-level: part URLs redirect.
//
// Nations: "stated" means the quoted sentence is on the page. "inferred" is our judgement,
// usually because employment law and benefits in Northern Ireland are covered by nidirect.
//
// Licence: GOV.UK content is published under the Open Government Licence v3.0 unless
// otherwise stated. The proposed licence is recorded here; the human decision for each guide
// lives in data/licence-reviews.json (written by `npm run licence:review`). Guides without a
// decision stay pending, and the database will not let content become retrievable without
// a named reviewer.

export const NATIONS = ["england", "wales", "scotland", "northern-ireland"] as const;
export const AREAS = ["tax", "pensions", "employment", "benefits"] as const;

const OGL_URL = "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/";
const OGL_ATTRIBUTION = "Contains public sector information licensed under the Open Government Licence v3.0";

const isoDate = z.string().refine(isValidIsoDate, "Expected YYYY-MM-DD");

const sectionApplicabilitySchema = z.object({
  slug: z.string().min(1),
  appliesFrom: isoDate.nullable(),
  appliesTo: isoDate.nullable(),
  // Must appear verbatim in the section's normalised text, or the period is not applied.
  evidence: z.string().min(10)
}).strict();

export const corpusEntrySchema = z.object({
  basePath: z.string().refine(isSafeGovukPath, "Must be a guide-level GOV.UK path"),
  title: z.string().min(1),
  area: z.enum(AREAS),
  topics: z.array(z.string().regex(/^[a-z_]+$/)).min(1),
  nations: z.array(z.enum(NATIONS)).min(1),
  nationsBasis: z.enum(["stated", "inferred"]),
  nationsEvidence: z.string().min(10),
  applicabilityNote: z.string().nullable(),
  sectionApplicability: z.array(sectionApplicabilitySchema),
  licence: z.object({
    id: z.literal("OGL-UK-3.0"),
    url: z.literal(OGL_URL),
    attribution: z.string().min(1),
    review: reviewSchema.nullable()
  }).strict()
}).strict();

export type CorpusEntry = z.infer<typeof corpusEntrySchema>;
export type SectionApplicability = z.infer<typeof sectionApplicabilitySchema>;

const pendingOgl = { id: "OGL-UK-3.0", url: OGL_URL, attribution: OGL_ATTRIBUTION, review: null } as const;
const ALL_NATIONS = [...NATIONS];
const GREAT_BRITAIN: CorpusEntry["nations"] = ["england", "wales", "scotland"];
const NI_EMPLOYMENT_INFERENCE = "Page has no nation statement; employment rights and statutory pay in Northern Ireland are covered separately on nidirect.";
const UK_WIDE_HMRC_INFERENCE = "Page has no nation restriction; HMRC administers this UK-wide.";

const TAX_2026_27 = { appliesFrom: "2026-04-06", appliesTo: "2027-04-05" } as const;

type EntryInput = Omit<CorpusEntry, "licence" | "sectionApplicability" | "applicabilityNote">
  & Partial<Pick<CorpusEntry, "sectionApplicability" | "applicabilityNote">>;

function entry(input: EntryInput): CorpusEntry {
  return { applicabilityNote: null, sectionApplicability: [], licence: pendingOgl, ...input };
}

const RAW_CORPUS: CorpusEntry[] = [
  // Tax
  entry({ basePath: "/tax-codes", title: "Tax codes", area: "tax", topics: ["paye", "tax_codes"], nations: ALL_NATIONS, nationsBasis: "inferred", nationsEvidence: UK_WIDE_HMRC_INFERENCE }),
  entry({
    basePath: "/income-tax-rates", title: "Income Tax rates and Personal Allowances", area: "tax", topics: ["income_tax"],
    nations: ["england", "wales", "northern-ireland"], nationsBasis: "stated", nationsEvidence: "Income tax bands are different if you live in Scotland.",
    sectionApplicability: [
      { slug: "current-rates-and-allowances", ...TAX_2026_27, evidence: "The current tax year is from 6 April 2026 to 5 April 2027." },
      { slug: "previous-tax-years", appliesFrom: null, appliesTo: "2026-04-05", evidence: "The standard Personal Allowance from 6 April 2025 to 5 April 2026 was £12,570." }
    ]
  }),
  entry({
    basePath: "/scottish-income-tax", title: "Scottish Income Tax", area: "tax", topics: ["income_tax"],
    nations: ["scotland"], nationsBasis: "stated", nationsEvidence: "You pay Scottish Income Tax if you live in Scotland.",
    sectionApplicability: [
      { slug: "how-it-works", ...TAX_2026_27, evidence: "The table shows the 2026 to 2027 Scottish Income Tax rates you pay in each band" },
      { slug: "2025-to-2026-tax-year", appliesFrom: "2025-04-06", appliesTo: "2026-04-05", evidence: "You pay a different rate of tax for income from the tax year 6 April 2025 to 5 April 2026." }
    ]
  }),
  entry({
    basePath: "/welsh-income-tax", title: "Welsh Income Tax", area: "tax", topics: ["income_tax"],
    nations: ["wales"], nationsBasis: "stated", nationsEvidence: "You pay Welsh Income Tax rates if you live in Wales.",
    applicabilityNote: "Single-section page: shows rates for 2026 to 2027 but also refers to the 2025 to 2026 tax year, so no single period is applied."
  }),
  entry({
    basePath: "/national-insurance", title: "National Insurance", area: "tax", topics: ["national_insurance"],
    nations: ALL_NATIONS, nationsBasis: "inferred", nationsEvidence: UK_WIDE_HMRC_INFERENCE,
    sectionApplicability: [
      { slug: "how-much-you-pay", ...TAX_2026_27, evidence: "The Class 1 National Insurance rates for most people for the 2026 to 2027 tax year are" }
    ]
  }),
  entry({
    basePath: "/national-insurance-rates-letters", title: "National Insurance rates and category letters", area: "tax", topics: ["national_insurance", "payroll"],
    nations: ALL_NATIONS, nationsBasis: "inferred", nationsEvidence: UK_WIDE_HMRC_INFERENCE,
    sectionApplicability: [
      { slug: "contribution-rates", ...TAX_2026_27, evidence: "This table shows how much employers pay towards employees’ National Insurance from 6 April 2026 to 5 April 2027." }
    ]
  }),
  entry({ basePath: "/understanding-your-pay", title: "Understanding your pay", area: "tax", topics: ["payslips", "paye"], nations: ALL_NATIONS, nationsBasis: "inferred", nationsEvidence: "Page has no nation restriction; payslip rights and PAYE deductions apply UK-wide." }),
  entry({ basePath: "/paye-forms-p45-p60-p11d", title: "PAYE forms: P45, P60, P11D", area: "tax", topics: ["paye", "payroll"], nations: ALL_NATIONS, nationsBasis: "inferred", nationsEvidence: UK_WIDE_HMRC_INFERENCE }),
  entry({ basePath: "/tax-overpayments-and-underpayments", title: "Tax overpayments and underpayments", area: "tax", topics: ["income_tax", "refunds"], nations: ALL_NATIONS, nationsBasis: "inferred", nationsEvidence: UK_WIDE_HMRC_INFERENCE }),
  entry({
    basePath: "/repaying-your-student-loan", title: "Repaying your student loan", area: "tax", topics: ["student_loans", "payroll"],
    nations: ALL_NATIONS, nationsBasis: "stated", nationsEvidence: "If you applied to Student Finance Northern Ireland You’re on Plan 1, whether you studied an undergraduate course or a postgraduate course."
  }),

  // Pensions
  entry({ basePath: "/workplace-pensions", title: "Workplace pensions", area: "pensions", topics: ["workplace_pensions", "auto_enrolment"], nations: ALL_NATIONS, nationsBasis: "inferred", nationsEvidence: "Page has no nation restriction and mentions Scottish tax rates for relief, implying UK-wide scope." }),
  entry({ basePath: "/new-state-pension", title: "The new State Pension", area: "pensions", topics: ["state_pension"], nations: GREAT_BRITAIN, nationsBasis: "stated", nationsEvidence: "How to claim is different if you claim from Northern Ireland or if you claim from abroad" }),
  entry({ basePath: "/tax-on-your-private-pension", title: "Tax on your private pension contributions", area: "pensions", topics: ["pension_tax_relief"], nations: ALL_NATIONS, nationsBasis: "inferred", nationsEvidence: "Page has no nation restriction and includes a Scotland-specific relief section, implying UK-wide scope." }),
  entry({ basePath: "/pension-credit", title: "Pension Credit", area: "pensions", topics: ["pension_credit", "benefits"], nations: GREAT_BRITAIN, nationsBasis: "stated", nationsEvidence: "This guide covers Pension Credit in England, Scotland and Wales." }),

  // Employment
  entry({ basePath: "/statutory-sick-pay", title: "Statutory Sick Pay (SSP)", area: "employment", topics: ["statutory_pay", "sick_pay"], nations: GREAT_BRITAIN, nationsBasis: "inferred", nationsEvidence: NI_EMPLOYMENT_INFERENCE }),
  entry({ basePath: "/national-minimum-wage-rates", title: "National Minimum Wage and National Living Wage rates", area: "employment", topics: ["minimum_wage"], nations: ALL_NATIONS, nationsBasis: "inferred", nationsEvidence: "Page has no nation restriction; the minimum wage applies across the UK." }),
  entry({ basePath: "/holiday-entitlement-rights", title: "Holiday entitlement", area: "employment", topics: ["holiday_pay"], nations: GREAT_BRITAIN, nationsBasis: "inferred", nationsEvidence: NI_EMPLOYMENT_INFERENCE }),
  entry({ basePath: "/maternity-pay-leave", title: "Maternity pay and leave", area: "employment", topics: ["statutory_pay", "parental_leave"], nations: GREAT_BRITAIN, nationsBasis: "inferred", nationsEvidence: NI_EMPLOYMENT_INFERENCE }),
  entry({ basePath: "/paternity-pay-leave", title: "Paternity pay and leave", area: "employment", topics: ["statutory_pay", "parental_leave"], nations: GREAT_BRITAIN, nationsBasis: "stated", nationsEvidence: "There are different rules if you live in Northern Ireland." }),
  entry({ basePath: "/shared-parental-leave-and-pay", title: "Shared Parental Leave and Pay", area: "employment", topics: ["statutory_pay", "parental_leave"], nations: GREAT_BRITAIN, nationsBasis: "inferred", nationsEvidence: NI_EMPLOYMENT_INFERENCE }),
  entry({ basePath: "/redundancy-your-rights", title: "Redundancy: your rights", area: "employment", topics: ["redundancy"], nations: GREAT_BRITAIN, nationsBasis: "inferred", nationsEvidence: NI_EMPLOYMENT_INFERENCE }),

  // Benefits
  entry({ basePath: "/universal-credit", title: "Universal Credit", area: "benefits", topics: ["universal_credit"], nations: GREAT_BRITAIN, nationsBasis: "stated", nationsEvidence: "If you live in Northern Ireland, go to Universal Credit in Northern Ireland." }),
  entry({ basePath: "/child-benefit", title: "Child Benefit", area: "benefits", topics: ["child_benefit"], nations: ALL_NATIONS, nationsBasis: "stated", nationsEvidence: "You normally qualify for Child Benefit if you’re responsible for a child under 16 and you live in the UK." }),
  entry({ basePath: "/tax-free-childcare", title: "Tax-Free Childcare", area: "benefits", topics: ["childcare"], nations: ALL_NATIONS, nationsBasis: "inferred", nationsEvidence: "Page has no nation restriction; only the free-hours schemes it mentions are England-specific." }),
  entry({ basePath: "/benefit-cap", title: "Benefit cap", area: "benefits", topics: ["benefit_cap", "universal_credit"], nations: GREAT_BRITAIN, nationsBasis: "inferred", nationsEvidence: "Page mentions England, Scotland and Wales only; Northern Ireland benefits are covered on nidirect." })
];

export function validateCorpus(entries: unknown): CorpusEntry[] {
  const parsed = z.array(corpusEntrySchema).min(1).parse(entries);
  const paths = parsed.map(item => item.basePath);
  if (new Set(paths).size !== paths.length) {
    throw new Error("Corpus contains a duplicate path");
  }
  return parsed;
}

export const CORPUS: readonly CorpusEntry[] = validateCorpus(applyLicenceReviews(RAW_CORPUS, loadLicenceReviews()));
