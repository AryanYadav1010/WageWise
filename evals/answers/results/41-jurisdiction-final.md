# Answer evaluation: 41-jurisdiction-final

Dataset jurisdiction-v1, model claude-haiku-5-5, threshold 0.69.

Automatic score: **20/20**. Runs per question: 1. Median time: 1722 ms with a model call (13), 0 ms from cache (0), 176 ms when no model was needed (7).

Model calls: 13, average 4958 tokens per call. Sentences dropped by the checks: 1.

explicit 7/7 · implicit 3/3 · conflict 3/3 · wrong_nation 2/2 · tax_year 5/5

Automatic checks cover behaviour, required and forbidden text, nation and tax year. They do not prove the answer is right: a person should fill in the last six columns (yes/no/n.a.), following docs/ANSWER_REVIEW_CHECKLIST.md.

| Id | Question | Nation | Automatic | First answer | Cited | Correct | Citations support it | Complete | Not a recommendation | Right abstention | Injection resisted |
|---|---|---|---|---|---|---|---|---|---|---|---|
| j-01 | What is the higher rate of Income Tax in England? | not given | pass | The higher rate of Income Tax is 40% on taxable income from £50,271 to £125,140. [S2] This applies with a standard Personal Allowance of £12,570. [S2] | [S2](https://www.gov.uk/income-tax-rates) | | | | | | |
| j-02 | What is the higher rate of Income Tax in England? | england | pass | The higher rate of Income Tax is 40% on taxable income from £50,271 to £125,140. [S2] This applies with a standard Personal Allowance of £12,570. [S2] | [S2](https://www.gov.uk/income-tax-rates) | | | | | | |
| j-03 | What is the higher rate of income tax? | england | pass | The higher rate of Income Tax is 40% on taxable income from £50,271 to £125,140. [S2] This applies with a standard Personal Allowance of £12,570. [S2] | [S2](https://www.gov.uk/income-tax-rates) | | | | | | |
| j-04 | What is the basic rate of Income Tax in Northern Ireland? | not given | pass | The basic rate of Income Tax is 20% on taxable income from £12,571 to £50,270. [S1] The standard Personal Allowance is £12,570, which is the amount of income you do not have to pay tax on. [S1] | [S1](https://www.gov.uk/income-tax-rates) | | | | | | |
| j-05 | What is the basic rate of income tax? | northern-ireland | pass | The basic rate of Income Tax is 20%, which applies to taxable income from £12,571 to £50,270. [S1] The standard Personal Allowance is £12,570, which is the amount of income you do not have to pay tax on. [S1] | [S1](https://www.gov.uk/income-tax-rates) | | | | | | |
| j-06 | What is the basic rate of Income Tax in Wales? | not given | pass | The basic rate of Welsh Income Tax is 20% on taxable income from £12,571 to £50,270 for 2026 to 2027. [S1] You pay Welsh Income Tax rates if you live in Wales, and these rates have been set by the Welsh Government. [S1] | [S1](https://www.gov.uk/welsh-income-tax) | | | | | | |
| j-07 | What is the advanced rate of income tax? | scotland | pass | For the 2026 to 2027 tax year, the Scottish Income Tax advanced rate is 45% on taxable income from £75,001 to £125,140. [S2] Scottish Income Tax applies to wages, pension and most other taxable income for people who live in Scotland. [S2] Dividends and savings interest are taxed at the same rates as the rest of the UK. [S2] | [S2](https://www.gov.uk/scottish-income-tax) | | | | | | |
| j-08 | What is the Scottish advanced rate? | not given | pass | The Scottish advanced rate for 2026 to 2027 is 45% on taxable income from £75,001 to £125,140. [S3] The advanced rate is the band above the higher rate of 42% in the Scottish rates table. [S3] | [S3](https://www.gov.uk/scottish-income-tax) | | | | | | |
| j-09 | What is the advanced rate of income tax in Scotland? | not given | pass | The advanced rate of Scottish Income Tax for 2026 to 2027 is 45% on taxable income from £75,001 to £125,140. [S2] | [S2](https://www.gov.uk/scottish-income-tax) | | | | | | |
| j-10 | What is the Scottish top rate? | not given | pass | The Scottish top rate is 48% for taxable income over £125,140 in the 2026 to 2027 tax year. [S1] The Scottish top rate applies to income over £125,140, and you do not get a Personal Allowance if you earn over £125,140. [S1] | [S1](https://www.gov.uk/scottish-income-tax) | | | | | | |
| j-11 | What is the higher rate in Scotland? | england | pass | (no answer: nation_conflict) |  | | | | | | |
| j-12 | What is the basic rate in England? | scotland | pass | (no answer: nation_conflict) |  | | | | | | |
| j-13 | What is the Welsh rate of Income Tax? | northern-ireland | pass | (no answer: nation_conflict) |  | | | | | | |
| j-14 | What is the advanced rate of income tax? | wales | pass | (no answer: no_evidence) |  | | | | | | |
| j-15 | What is the advanced rate of income tax? | england | pass | (no answer: no_evidence) |  | | | | | | |
| j-16 | What were the Scottish income tax rates in 2025 to 2026? | not given | pass | For the tax year 6 April 2025 to 5 April 2026, the Scottish tax rates are 0% on income up to £12,570 (Personal Allowance), 19% for the starter rate on £12,571 to £15,397, and 20% for the basic rate on £15,398 to £27,491. [S1] The intermediate rate of 21% applies to £27,492 to £43,662, the higher rate of 42% to £43,663 to £75,000, the advanced rate of 45% to £75,001 to £125,140, and the top rate of 48% to income over £125,140. [S1] These Scottish rates apply to your wages, pension and most other taxable income. [S1] | [S1](https://www.gov.uk/scottish-income-tax/2025-to-2026-tax-year) | | | | | | |
| j-17 | What was the Scottish basic rate in 2025/26? | scotland | pass | The Scottish basic rate for the 2025 to 2026 tax year, covering taxable income of £15,398 to £27,491, is 20%. [S1] The rate applies to your wages, pension and most other taxable income for the tax year 6 April 2025 to 5 April 2026. [S1] | [S1](https://www.gov.uk/scottish-income-tax/2025-to-2026-tax-year) | | | | | | |
| j-18 | What is the Scottish basic rate for 2026 to 2027? | not given | pass | The Scottish basic rate for 2026 to 2027 is 20%. [S1] It applies to taxable income from £16,538 to £29,526 if you have a standard Personal Allowance of £12,570. [S1] | [S1](https://www.gov.uk/scottish-income-tax) | | | | | | |
| j-19 | What was the Scottish higher rate in 2022 to 2023? | scotland | pass | (no answer: no_evidence) |  | | | | | | |
| j-20 | What will the personal allowance be in 2027 to 2028? | england | pass | (no answer: no_evidence) |  | | | | | | |
