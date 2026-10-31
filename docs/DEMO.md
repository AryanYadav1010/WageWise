# Demo script

A 60–90 second walkthrough of WageWise UK for an engineering audience. Every question below was run through the real app on 31 October 2026. The model's wording varies between runs, but the figures shouldn't.

## Before you start

1. Run `npm run dev` and open http://localhost:5173.
2. Ask one question, then click **New conversation**. The first answer after a restart is the slowest.
3. Leave the nation selector on its default, so nothing is selected.

Chat is limited to 10 requests a minute, which this script doesn't reach.

## The script

**Opening (10 seconds).** "WageWise answers UK tax questions using only GOV.UK guidance that a person has approved. Code checks every sentence before you see it, and if it can't support an answer, it refuses."

**1. A nation-specific question (10 seconds).** Ask *What is the higher rate in Scotland?*

"42%, for Scotland, read from the question. Each number is a citation, and every figure must appear in the passage it cites."

**2. A citation (10 seconds).** Click the citation number.

"This opens the source: the exact GOV.UK section, the nations it covers and when it was last checked."

**3. A follow-up (15 seconds).** Ask *What about England?*

"It understood the follow-up and shows how: 'Answering: What is the higher rate? (England)'. It searched GOV.UK again rather than reusing the last answer. Earlier answers are never sent back, so the model can't treat its own words as evidence."

**4. A comparison (10 seconds).** Ask *Compare the two.*

"Each side is retrieved for its own nation and has to pass the checks by itself."

**5. A safe refusal (10 seconds).** Ask *And in 2022 to 2023?*

"The approved guides don't cover that year, so it says so instead of using another year's figures."

**6. The payday calculator (10 seconds).** Open **Payday budget**, set the weekend rule to **The working day before**, and click **Calculate**.

"This part uses no AI. It's whole-pence arithmetic with real UK bank holidays, so the 28 November payday moves to Friday the 27th."

**Close (5 seconds).** "The benchmarks are in the repository, including held-out sets I can't tune on: 19 of 22 conversations and 18 of 20 questions on their blind runs. The misses were refusals and one partial answer. Reading those answers also found one false sentence the checks had passed. I fixed it, and it's why a person still has to review the answers."

## If you're asked

- **Why not lower the threshold to answer more?** "We tested looser rules, and they let through questions the guides can't answer, such as Child Benefit. Instead we stopped counting words that aren't evidence, like 'please'. Refusing too often is safer than answering wrongly."
- **Is it financial advice?** "No. It gives general information, and code removes recommendation wording and direct instructions."
- **Where is the conversation stored?** "Only in the browser tab. The server keeps nothing between requests, so there are no sessions to leak, and New conversation or a refresh clears it."
- **What can a forged history do?** "No more than typing the same words. History is treated as questions, never as facts, and the API rejects any field for an earlier answer."
- **Is it live?** "No. It runs locally, and the database credentials are still to be rotated before any deployment."
