# Licence review checklist

**Generated 28 Oct 2026 from the live Content API. Status (29 Oct 2026): 5 guides APPROVED by Aryan Yadav (see [LICENCE_REVIEW_SUBSET_1.md](LICENCE_REVIEW_SUBSET_1.md)); the other 20 PENDING.** `npm run licence:review -- --list` is the source of truth.

Nothing in this project becomes retrievable or embedded until a person records a decision with `npm run licence:review` (stored in `apps/api/data/licence-reviews.json`). The database enforces this: `retrievable_chunks` only exposes documents whose `licence_status` is `approved` with a named reviewer and date, and the embedding job reads only from that view.

## What the reviewer is confirming

GOV.UK content is published under the [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/) "except where otherwise stated" ([GOV.UK terms](https://www.gov.uk/help/terms-conditions)). For each guide, open the canonical URL and confirm:

1. The publisher is a UK government organisation (listed below from the Content API).
2. The page states no other licence, and contains no third-party copyright notice, logo, photograph, chart or quoted third-party material.
3. Anything flagged by the automated pre-check is acceptable (see notes).
4. Attribution will be shown with every excerpt: *Contains public sector information licensed under the Open Government Licence v3.0*, plus a link to the page.
5. No implication of endorsement: WageWise is independent and says so on every page.

## Automated pre-check (28 Oct 2026)

- **Images:** no `<img>`, `<figure>`, video, iframe or attachment on any page. 7 pages contain an inline `<svg>`; each one is the GOV.UK Design System arrow icon on a "Start now"/"Apply now" button, which the normaliser drops.
- **Copyright notices:** no `©`, "copyright" or "all rights reserved" text on any page.
- **Links to non-government sites** are listed below. We store only the GOV.UK wording around them; the linked sites are never fetched, stored or indexed. In particular, the MoneyHelper link on `/workplace-pensions` does not bring any MoneyHelper content into the corpus.

## Per-guide checklist

| # | Guide (canonical URL) | Publisher | Pre-check notes | Exceptions found | Decision | Reviewer | Date |
|---|---|---|---|---|---|---|---|
| 1 | [/tax-codes](https://www.gov.uk/tax-codes) | HM Revenue & Customs | none | none found (pre-check 29 Oct) | **APPROVED** | Aryan Yadav | 29 Oct 2026 |
| 2 | [/income-tax-rates](https://www.gov.uk/income-tax-rates) | HM Revenue & Customs | none | none found (pre-check 29 Oct) | **APPROVED** | Aryan Yadav | 29 Oct 2026 |
| 3 | [/scottish-income-tax](https://www.gov.uk/scottish-income-tax) | HM Revenue & Customs | none | none found (pre-check 29 Oct) | **APPROVED** | Aryan Yadav | 29 Oct 2026 |
| 4 | [/welsh-income-tax](https://www.gov.uk/welsh-income-tax) | HM Revenue & Customs; Welsh Government | none | none found (pre-check 29 Oct) | **APPROVED** | Aryan Yadav | 29 Oct 2026 |
| 5 | [/national-insurance](https://www.gov.uk/national-insurance) | HM Revenue & Customs; Department for Work and Pensions | links to: register.fca.org.uk | none found (pre-check 29 Oct) | **APPROVED** | Aryan Yadav | 29 Oct 2026 |
| 6 | [/national-insurance-rates-letters](https://www.gov.uk/national-insurance-rates-letters) | HM Revenue & Customs | none | _to check_ | **PENDING** | | |
| 7 | [/understanding-your-pay](https://www.gov.uk/understanding-your-pay) | Department for Business, Innovation, Science and Trade; Department for Work and Pensions; Department for Business, Energy & Industrial Strategy | links to: www.acas.org.uk, www.citizensadvice.org.uk | _to check_ | **PENDING** | | |
| 8 | [/paye-forms-p45-p60-p11d](https://www.gov.uk/paye-forms-p45-p60-p11d) | HM Revenue & Customs | none | _to check_ | **PENDING** | | |
| 9 | [/tax-overpayments-and-underpayments](https://www.gov.uk/tax-overpayments-and-underpayments) | HM Revenue & Customs | start-button icon only | _to check_ | **PENDING** | | |
| 10 | [/repaying-your-student-loan](https://www.gov.uk/repaying-your-student-loan) | HM Revenue & Customs; Student Loans Company | start-button icon only | _to check_ | **PENDING** | | |
| 11 | [/workplace-pensions](https://www.gov.uk/workplace-pensions) | HM Revenue & Customs; Department for Work and Pensions | links to: www.fscs.org.uk, www.moneyhelper.org.uk, www.nestpensions.org.uk, www.pensionprotectionfund.org.uk, www.unbiased.co.uk | _to check_ | **PENDING** | | |
| 12 | [/new-state-pension](https://www.gov.uk/new-state-pension) | Department for Work and Pensions | start-button icon only; links to: www.gov.im | _to check_ | **PENDING** | | |
| 13 | [/tax-on-your-private-pension](https://www.gov.uk/tax-on-your-private-pension) | HM Revenue & Customs | none | _to check_ | **PENDING** | | |
| 14 | [/pension-credit](https://www.gov.uk/pension-credit) | Department for Work and Pensions | start-button icon only; links to: connect.interpreterslive.co.uk, www.ageuk.org.uk, www.citizensadvice.org.uk, www.mygov.scot, www.relayuk.bt.com, www.royalmail.com, www.youtube.com | _to check_ | **PENDING** | | |
| 15 | [/statutory-sick-pay](https://www.gov.uk/statutory-sick-pay) | Department for Work and Pensions; HM Revenue & Customs | none | _to check_ | **PENDING** | | |
| 16 | [/national-minimum-wage-rates](https://www.gov.uk/national-minimum-wage-rates) | Department for Business, Innovation, Science and Trade; Department for Business, Energy & Industrial Strategy | none | _to check_ | **PENDING** | | |
| 17 | [/holiday-entitlement-rights](https://www.gov.uk/holiday-entitlement-rights) | Department for Business, Innovation, Science and Trade; Department for Business, Energy & Industrial Strategy | links to: www.acas.org.uk | _to check_ | **PENDING** | | |
| 18 | [/maternity-pay-leave](https://www.gov.uk/maternity-pay-leave) | Department for Work and Pensions | none | _to check_ | **PENDING** | | |
| 19 | [/paternity-pay-leave](https://www.gov.uk/paternity-pay-leave) | Department for Business, Innovation, Science and Trade; Department for Work and Pensions; HM Revenue & Customs | none | _to check_ | **PENDING** | | |
| 20 | [/shared-parental-leave-and-pay](https://www.gov.uk/shared-parental-leave-and-pay) | Department for Business, Innovation, Science and Trade; HM Revenue & Customs | links to: www.acas.org.uk | _to check_ | **PENDING** | | |
| 21 | [/redundancy-your-rights](https://www.gov.uk/redundancy-your-rights) | Department for Business, Innovation, Science and Trade; HM Revenue & Customs; Department for Business, Energy & Industrial Strategy | links to: gov.wales, www.acas.org.uk, www.citizensadvice.org.uk, www.myworldofwork.co.uk | _to check_ | **PENDING** | | |
| 22 | [/universal-credit](https://www.gov.uk/universal-credit) | Department for Work and Pensions | start-button icon only; links to: advicelocal.uk, connect.interpreterslive.co.uk, www.cas.org.uk, www.citizensadvice.org.uk, www.gov.scot, www.mygov.scot, www.relayuk.bt.com, www.youtube.com | _to check_ | **PENDING** | | |
| 23 | [/child-benefit](https://www.gov.uk/child-benefit) | HM Revenue & Customs | start-button icon only; links to: www.youtube.com | _to check_ | **PENDING** | | |
| 24 | [/tax-free-childcare](https://www.gov.uk/tax-free-childcare) | HM Revenue & Customs | start-button icon only | _to check_ | **PENDING** | | |
| 25 | [/benefit-cap](https://www.gov.uk/benefit-cap) | Department for Work and Pensions | links to: connect.interpreterslive.co.uk, www.gov.wales, www.mygov.scot, www.relayuk.bt.com, www.youtube.com | _to check_ | **PENDING** | | |

## How to record a decision

After reviewing a guide yourself:

```bash
npm run licence:review -- --path /tax-codes --decision approved --reviewer "Your Name" --notes "Checked 29 Oct 2026; no third-party material"
npm run licence:review -- --list     # shows every guide's status
npm run ingest                        # applies decisions to the database
npm run embed                         # embeds newly approved content only
```

Decisions are stored in `apps/api/data/licence-reviews.json` (one per guide; a later decision replaces an earlier one). A rejected guide is never retrievable; its stored versions stay for audit. Approval is per guide: approving one never approves another, and you can approve a subset first.
