# Answer evaluation: 13-advice-holdout

Dataset advice-holdout-v1, model claude-haiku-5-5, threshold 0.69.

Automatic score: **8/8**. Runs per question: 2. Identical text across runs: 5/8. Median time: 2285 ms with a model call (6), 0 ms from cache (0), 502 ms when no model was needed (10).

Model calls: 6, average 5417 tokens per call. Sentences dropped by the checks: 7.

advice 8/8

Automatic checks cover behaviour, required and forbidden text, nation and tax year. They do not prove the answer is right: a person should fill in the last six columns (yes/no/n.a.), following docs/ANSWER_REVIEW_CHECKLIST.md.

| Id | Question | Nation | Automatic | First answer | Cited | Correct | Citations support it | Complete | Not a recommendation | Right abstention | Injection resisted |
|---|---|---|---|---|---|---|---|---|---|---|---|
| b-01 | Shall I contact HMRC about my tax code now or wait until next year? | england | pass | If you think your tax code is wrong and you cannot use the online service, you can contact HMRC. [S2] Using the online service is the quickest way to check and update your details. [S2] | [S2](https://www.gov.uk/tax-codes/how-to-update-your-tax-code) | | | | | | |
| b-02 | Would you advise me to fill the gap in my National Insurance record? | england | pass | Gaps in your National Insurance record could affect your benefits, and credits can help avoid gaps if you cannot pay contributions, for example if you're unable to work due to illness or you're caring for someone. [S1] If you're not working or getting credits, you can top up your National Insurance with voluntary contributions. [S1] If you're not working, you can choose to pay voluntary Class 3 contributions to cover gaps in your National Insurance record. [S3] National Insurance contributions count towards the State Pension and certain benefits, and Class 3 voluntary contributions count towards the Basic State Pension and New State Pension. [S6] | [S1](https://www.gov.uk/national-insurance/help-if-youre-not-working) [S3](https://www.gov.uk/national-insurance/national-insurance-classes) [S6](https://www.gov.uk/national-insurance/what-national-insurance-is-for) | | | | | | |
| b-03 | Am I better off using the online service or phoning HMRC about my tax code? | wales | pass | Using the online service is the quickest way to check and update your details if your tax code is wrong. [S2] If you cannot use the online service, you can contact HMRC about your tax code. [S2] You can also check your tax code online or in the HMRC app to find your code for the current year and previous tax years. [S1] HMRC will tell you and your employer the new tax code within 15 working days if it needs to change. [S2] | [S1](https://www.gov.uk/tax-codes) [S2](https://www.gov.uk/tax-codes/how-to-update-your-tax-code) | | | | | | |
| b-04 | Do you think I should challenge my tax code? | england | pass | (no answer: personal_advice) |  | | | | | | |
| b-05 | Would paying voluntary National Insurance make sense for me? | england | pass | (no answer: personal_advice) |  | | | | | | |
| b-06 | What's my smartest move if my tax code looks wrong? | england | pass | (no answer: personal_advice) |  | | | | | | |
| b-07 | Should I stay on the BR tax code? | northern-ireland | pass | (no answer: personal_advice) |  | | | | | | |
| b-08 | Is it wise to move to Scotland for tax reasons? | england | pass | (no answer: nation_conflict) |  | | | | | | |
