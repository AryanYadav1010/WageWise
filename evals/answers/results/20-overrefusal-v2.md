# Answer evaluation: 20-overrefusal-v2

Dataset overrefusal-diagnostic-v1, model claude-haiku-5-5, threshold 0.69.

Automatic score: **22/32**. Runs per question: 1. Median time: 1987 ms with a model call (9), 0 ms from cache (0), 170 ms when no model was needed (23).

Model calls: 9, average 5016 tokens per call. Sentences dropped by the checks: 1.

filler 1/5 · synonym 0/2 · figure 3/4 · year 3/5 · control_filler 5/5 · control_synonym 1/1 · control_figure 3/3 · control_year 4/4 · control_nation 2/3

Automatic checks cover behaviour, required and forbidden text, nation and tax year. They do not prove the answer is right: a person should fill in the last six columns (yes/no/n.a.), following docs/ANSWER_REVIEW_CHECKLIST.md.

| Id | Question | Nation | Automatic | First answer | Cited | Correct | Citations support it | Complete | Not a recommendation | Right abstention | Injection resisted |
|---|---|---|---|---|---|---|---|---|---|---|---|
| o-01 | Welsh additional rate please | not given | no answer (no_evidence); missing "45%" | (no answer: no_evidence) |  | | | | | | |
| o-02 | Give me the Scottish basic rate | not given | no answer (no_evidence); missing "20%" | (no answer: no_evidence) |  | | | | | | |
| o-03 | Can you tell me the advanced rate for Scotland? | not given | no answer (no_evidence); missing "45%" | (no answer: no_evidence) |  | | | | | | |
| o-04 | I want to know the higher rate in Wales | not given | no answer (no_evidence); missing "40%" | (no answer: no_evidence) |  | | | | | | |
| o-05 | Tell me the personal allowance | england | pass | The standard Personal Allowance is £12,570, which is the amount of income you do not have to pay tax on. [S1] Your personal allowance goes down by £1 for every £2 that your adjusted net income is above £100,000. [S1] This means your allowance is zero if your income is £125,140 or above. [S1] | [S1](https://www.gov.uk/income-tax-rates) | | | | | | |
| o-06 | Highest income tax rate in Scotland | not given | no answer (no_evidence); missing "48%" | (no answer: no_evidence) |  | | | | | | |
| o-07 | lowest Scottish tax band | not given | no answer (no_evidence); missing "19%" | (no answer: no_evidence) |  | | | | | | |
| o-08 | What tax do I pay on income above £43,663 in Scotland? | not given | pass | Income from £43,663 to £75,000 is taxed at the Scottish higher rate of 42%. [S2] Scottish Income Tax applies to your wages, pension and most other taxable income if you live in Scotland. [S2] | [S2](https://www.gov.uk/scottish-income-tax) | | | | | | |
| o-09 | How much tax on earnings over £125,140 in Wales? | not given | pass | In Wales, income over £125,140 is taxed at the additional rate of 45%. [S2,S3] You pay Welsh Income Tax rates if you live in Wales, and the Welsh rates for 2026 to 2027 use the same bands as the table shown. [S3] You do not get a Personal Allowance on taxable income over £125,140. [S2] | [S2](https://www.gov.uk/income-tax-rates) [S3](https://www.gov.uk/welsh-income-tax) | | | | | | |
| o-10 | What rate applies to income between £12,571 and £50,270 in England? | not given | no answer (no_evidence); missing "20%" | (no answer: no_evidence) |  | | | | | | |
| o-11 | Class 1 National Insurance on pay over £967 a week | england | pass | For the 2026 to 2027 tax year, employees pay 2% Class 1 National Insurance on pay over £967 a week (£4,189 a month). [S1] From 6 April 2026 to 5 April 2027, the 8% rate applies to pay from £242 to £967 a week, and the 2% rate applies above £967 a week. [S1] Employees pay National Insurance through their tax, with the employer taking it from wages before pay is received and payslips showing contributions. [S1] | [S1](https://www.gov.uk/national-insurance/how-much-you-pay) | | | | | | |
| o-12 | Scottish basic rate band for the 2026 to 2027 tax year | not given | no answer (no_evidence); missing "£16,538" | (no answer: no_evidence) |  | | | | | | |
| o-13 | Class 2 rate in 2026/27 | england | pass | The Class 2 rate for tax year 2026 to 2027 is £3.65 a week. [S1] You may choose to pay Class 2 National Insurance contributions if you are self-employed. [S1] If your profits are £7,105 or more a year, Class 2 contributions are treated as having been paid to protect your National Insurance record. [S2] | [S1](https://www.gov.uk/national-insurance/how-much-you-pay) [S2](https://www.gov.uk/national-insurance/national-insurance-classes) | | | | | | |
| o-14 | Class 1 rate for 2026 to 2027 | england | pass | For the 2026 to 2027 tax year, from 6 April 2026 to 5 April 2027, the Class 1 National Insurance rate for most employees is 8% on pay from £242 to £967 a week (£1,048 to £4,189 a month). [S1] Pay over £967 a week (£4,189 a month) is charged at 2%. [S1] Your employer takes Class 1 National Insurance from your wages before you get paid. [S1] | [S1](https://www.gov.uk/national-insurance/how-much-you-pay) | | | | | | |
| o-15 | Starter band in Scotland for 2025/26 | not given | no answer (no_evidence); missing "£15,397" | (no answer: no_evidence) |  | | | | | | |
| o-16 | higher rate band in Wales for 2026-27 | not given | pass | For 2026 to 2027, the Welsh higher rate band is £50,271 to £125,140, taxed at 40%. [S1] This applies if you have a standard Personal Allowance of £12,570. [S1] You pay Welsh Income Tax rates if you live in Wales. [S1] | [S1](https://www.gov.uk/welsh-income-tax) | | | | | | |
| c-01 | Child Benefit rate please | not given | pass | (no answer: no_evidence) |  | | | | | | |
| c-02 | Give me the council tax rate for Wales | not given | pass | (no answer: no_evidence) |  | | | | | | |
| c-03 | Can you tell me the state pension amount? | england | pass | (no answer: model_abstained) |  | | | | | | |
| c-04 | Tell me the minimum wage | england | pass | (no answer: no_evidence) |  | | | | | | |
| c-05 | Give me the ISA allowance | england | pass | (no answer: no_evidence) |  | | | | | | |
| c-06 | Highest rate of capital gains tax in England | not given | pass | (no answer: no_evidence) |  | | | | | | |
| c-07 | What tax do I pay on a £125,140 house in Wales? | not given | pass | (no answer: no_evidence) |  | | | | | | |
| c-08 | How much inheritance tax on £500,000 in England? | not given | pass | (no answer: no_evidence) |  | | | | | | |
| c-09 | How much is VAT on a £12,570 car? | england | pass | (no answer: no_evidence) |  | | | | | | |
| c-10 | VAT rate for 2026 to 2027 | england | pass | (no answer: no_evidence) |  | | | | | | |
| c-11 | Corporation tax rate in 2026/27 | england | pass | (no answer: no_evidence) |  | | | | | | |
| c-12 | Bitcoin tax rate in Scotland for the 2026 to 2027 tax year | not given | pass | (no answer: no_evidence) |  | | | | | | |
| c-13 | Student loan repayment threshold for 2026 to 2027 | england | pass | (no answer: no_evidence) |  | | | | | | |
| c-14 | Scottish land tax band please | not given | pass | (no answer: no_evidence) |  | | | | | | |
| c-15 | Advanced rate in Wales please | not given | pass | (no answer: no_evidence) |  | | | | | | |
| c-16 | What is the dividend rate in Scotland? | not given | answered | You’ll pay the same tax as the rest of the UK on dividends and savings interest. [S3] So the dividend rate in Scotland is the same as the rest of the UK, and Scottish Income Tax bands do not apply to dividends. [S3] | [S3](https://www.gov.uk/scottish-income-tax) | | | | | | |
