# GOV.UK Content API fixtures

Trimmed copies of real responses from `https://www.gov.uk/api/content/<path>`, fetched on
28 October 2026. Only the fields the parser reads are kept (`links` and other metadata removed).

- `tax-codes.json`, `income-tax-rates.json`: `guide` documents with parts
- `scottish-income-tax.json`, `national-insurance.json`: guides with section-level tax-year statements (added in M3)
- `welsh-income-tax.json`: an `answer` document with a single body
- `redundant-your-rights.json`: a redirect published as a content item (HTTP 200, `schema_name: "redirect"`)
- `plan-for-retirement.json`: `step_by_step_nav`, a format we deliberately do not ingest

Contains public sector information licensed under the Open Government Licence v3.0.
