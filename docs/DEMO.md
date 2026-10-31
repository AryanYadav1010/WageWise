# Demo script

A 60–90 second walkthrough of WageWise UK for an engineering audience. Every question below was run through the real app on 31 October 2026. The model's wording varies between runs, but the figures shouldn't.

## Before you start

1. Run `npm run dev` and open http://localhost:5173.
2. Ask one question and start a new one from the sidebar. The first answer after a restart is the slowest.
3. Leave the nation selector on its default, so nothing is selected.

Chat is limited to 10 requests a minute, which this script doesn't reach.

## The script

**Opening (10 seconds).** "WageWise answers UK tax questions using only GOV.UK guidance that a person has approved. Code checks every sentence before you see it, and if it can't support an answer, it refuses."

**1. A tax-code question (15 seconds).** Ask *What does tax code 1257L mean?*

"It explains the code in plain English. Each number is a citation, and every figure must appear in the passage it cites."

**2. A citation (10 seconds).** Click a citation number.

"This opens the source: the exact GOV.UK section, the nations it covers and when it was last checked."

**3. A nation-specific question (20 seconds).** Ask *What is the Scottish advanced rate?*

"It reads Scotland from the question and answers 45% on income from £75,001 to £125,140. Scotland has its own bands, so this filter matters."

Select **England**, then ask the same question again.

"Now the question and the selection disagree, so it asks which one I mean instead of guessing." Click **Use Scotland**.

**4. A correct refusal (10 seconds).** Ask *How much is Child Benefit?*

"Child Benefit isn't in the approved guides, so it refuses without calling the model. A refusal is better than a confident guess about someone's money."

**5. The payday calculator (15 seconds).** Open **Payday budget**, set the weekend rule to **The working day before**, and click **Calculate**.

"This part uses no AI. It's whole-pence arithmetic with real UK bank holidays, so the 28 November payday moves to Friday the 27th, leaving about £7.40 a day."

**Close (5 seconds).** "The retrieval and answer benchmarks are in the repository, including a held-out set I can't tune on. It scored 14 out of 20: every miss was a refusal, with no wrong answers."

## If you're asked

- **Why not lower the threshold to answer more?** "We tested a looser rule, and it let through questions the guides can't answer, such as Child Benefit. Refusing too often is safer than answering wrongly."
- **Is it financial advice?** "No. It gives general information, and code removes recommendation wording and direct instructions."
- **Is it live?** "No. It runs locally, and the database credentials are still to be rotated before any deployment."
