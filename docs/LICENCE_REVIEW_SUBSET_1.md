# Licence review: first five guides

**Status (29 Oct 2026): all five APPROVED by Aryan Yadav.** Recorded on 29 Oct 2026 with `npm run licence:review`, on the owner's explicit instruction after their review. The other 20 guides remain pending.

These five guides cover income tax, tax codes and National Insurance for all four nations. They are the same five guides as the test fixtures, so the real benchmark can be compared directly with the fixture benchmark. They cover 20 of the 47 answerable benchmark questions (all 7 answerable nation-specific ones and 5 of the 6 answerable tax-year ones) plus all 20 unanswerable or ambiguous ones.

Full criteria: [LICENCE_REVIEW.md](LICENCE_REVIEW.md). In short, GOV.UK pages are under the Open Government Licence v3.0 *except where otherwise stated*, so you are checking that nothing on the page is "otherwise stated".

## Automated pre-check (re-run 29 Oct 2026 against the live Content API)

| Guide | Publisher | Parts | Images / video / iframes | Copyright or other-licence text | Attachments | Non-government links | Stored (production) |
|---|---|---|---|---|---|---|---|
| [/tax-codes](https://www.gov.uk/tax-codes) | HM Revenue & Customs | 7 | none | none | none | none | 7 sections, 26 chunks |
| [/income-tax-rates](https://www.gov.uk/income-tax-rates) | HM Revenue & Customs | 2 | none | none | none | none | 2 sections, 12 chunks |
| [/scottish-income-tax](https://www.gov.uk/scottish-income-tax) | HM Revenue & Customs | 5 | none | none | none | none | 5 sections, 10 chunks |
| [/welsh-income-tax](https://www.gov.uk/welsh-income-tax) | HM Revenue & Customs; Welsh Government | 1 (single page) | none | none | none | none | 1 section, 6 chunks |
| [/national-insurance](https://www.gov.uk/national-insurance) | HM Revenue & Customs; Department for Work and Pensions | 7 | none | none | none | register.fca.org.uk | 7 sections, 27 chunks |

The FCA register link is a link only: the FCA page is never fetched, stored or shown.

## Your checks, per guide

Open each part of the guide in a browser and tick:

- [ ] The publisher shown on the page is a UK government organisation (above).
- [ ] No other licence is stated, and there is no copyright notice, third-party logo, photo, chart or quoted third-party material.
- [ ] You're comfortable with how WageWise shows it: short excerpts, a link to the exact GOV.UK section, the OGL attribution line, and an "independent, not endorsed by GOV.UK" notice.

Parts to open:

1. **/tax-codes**: [overview](https://www.gov.uk/tax-codes) · [why-tax-code-change](https://www.gov.uk/tax-codes/why-tax-code-change) · [what-your-tax-code-means](https://www.gov.uk/tax-codes/what-your-tax-code-means) · [how-to-update-your-tax-code](https://www.gov.uk/tax-codes/how-to-update-your-tax-code) · [if-youve-paid-too-much-or-too-little-tax](https://www.gov.uk/tax-codes/if-youve-paid-too-much-or-too-little-tax) · [emergency-tax-codes](https://www.gov.uk/tax-codes/emergency-tax-codes) · [k-in-your-tax-code](https://www.gov.uk/tax-codes/k-in-your-tax-code)
2. **/income-tax-rates**: [current-rates-and-allowances](https://www.gov.uk/income-tax-rates) · [previous-tax-years](https://www.gov.uk/income-tax-rates/previous-tax-years)
3. **/scottish-income-tax**: [how-it-works](https://www.gov.uk/scottish-income-tax) · [who-pays](https://www.gov.uk/scottish-income-tax/who-pays) · [if-you-live-in-more-than-one-home](https://www.gov.uk/scottish-income-tax/if-you-live-in-more-than-one-home) · [if-you-move-to-or-from-scotland](https://www.gov.uk/scottish-income-tax/if-you-move-to-or-from-scotland) · [2025-to-2026-tax-year](https://www.gov.uk/scottish-income-tax/2025-to-2026-tax-year)
4. **/welsh-income-tax**: [single page](https://www.gov.uk/welsh-income-tax)
5. **/national-insurance**: [overview](https://www.gov.uk/national-insurance) · [your-national-insurance-number](https://www.gov.uk/national-insurance/your-national-insurance-number) · [national-insurance-classes](https://www.gov.uk/national-insurance/national-insurance-classes) · [how-much-you-pay](https://www.gov.uk/national-insurance/how-much-you-pay) · [what-national-insurance-is-for](https://www.gov.uk/national-insurance/what-national-insurance-is-for) · [help-if-youre-not-working](https://www.gov.uk/national-insurance/help-if-youre-not-working) · [change-of-circumstance](https://www.gov.uk/national-insurance/change-of-circumstance)

## Recording your decision

Run one command per guide you have checked yourself. Approving one guide never approves another; you can approve fewer than five, or reject one.

```bash
cd ~/Desktop/wagewise/wagewise-uk
npm run licence:review -- --path /tax-codes           --decision approved --reviewer "Your Name" --notes "Checked all 7 parts on <date>; no third-party material"
npm run licence:review -- --path /income-tax-rates    --decision approved --reviewer "Your Name" --notes "..."
npm run licence:review -- --path /scottish-income-tax --decision approved --reviewer "Your Name" --notes "..."
npm run licence:review -- --path /welsh-income-tax    --decision approved --reviewer "Your Name" --notes "..."
npm run licence:review -- --path /national-insurance  --decision approved --reviewer "Your Name" --notes "..."
npm run licence:review -- --list
```

Decisions go into `apps/api/data/licence-reviews.json` with your name and the time. After that, `npm run ingest && npm run embed` applies them: only approved, active content is embedded or searchable.
