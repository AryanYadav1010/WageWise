# WageWise UK: Complete Project Overview

*Everything about this project in one file: product requirements, architecture, how it works, sources, results, limitations and how to present it. Facts are as of 30 October 2026, after the V2 upgrade.*

> **Note for ChatGPT or any AI reading this file:** this is a complete brief for a real project. Please explain it to me in simple English, one section at a time. Start with what the product does and why it exists, then how it works, using everyday examples. Define any technical term before using it. Treat the figures here as measured results, don't invent others, and keep the difference between "done" and "planned" clear. This file contains no passwords or keys, and I shouldn't share any with you.

---

## 1. The project in one minute

**WageWise UK is a chatbot for UK money questions that only answers from official GOV.UK guidance.**

You ask something like "What does tax code 1257L mean?" WageWise finds the relevant official passages, asks an AI model to write a short answer from those passages only, then checks the answer before showing it. Every answer links back to the exact GOV.UK page. If the official guidance doesn't cover the question, WageWise says so instead of guessing.

The interface is inspired by answer engines such as Perplexity: one question box, a clean reading page and sources one click away. It also has a guidance search page, a directory of official links and a payday budget calculator.

**Current state:** it works end to end on a developer's machine, using 5 approved GOV.UK guides. It is **not deployed publicly**.

---

## 2. Product requirements (PRD)

### The problem
- UK tax and pay rules are spread across many official pages and differ by nation and tax year. For example, Scotland has different income tax bands.
- General AI chatbots can sound confident while giving wrong or outdated figures. In money matters, a wrong number can cost someone real money.
- People need an answer they can check, not just an answer that sounds right.

### Who it is for
- UK employees trying to understand their tax code, payslip or tax rates.
- People moving between nations or tax years who need the rules that apply to them.
- People who want a rough idea of what is left until payday.
- Portfolio audience: employers and reviewers assessing responsible AI engineering.

### Goals
1. Give short, plain-English answers grounded in official guidance.
2. Make every claim traceable to its source.
3. Refuse rather than guess when evidence is missing.
4. Respect nation and tax-year differences.
5. Never use content that a human has not licence-approved.
6. Stay clearly on the side of general information, not regulated financial advice.

### Non-goals
- No personal financial advice or product recommendations.
- No bank connections, payslip uploads or personal financial data.
- No user accounts.
- No content from outside GOV.UK. MoneyHelper content is deliberately not used.

### Features today
| Feature | What it does | User story |
|---|---|---|
| **Ask** | Grounded answers with numbered citations and a sources panel | "As an employee, I want a short answer I can verify, so I can trust it." |
| **Search guidance** | Finds matching official passages without writing an answer | "I want to read the source myself." |
| **Key links** | A small directory of official pages by topic | "I just want the right page." |
| **Payday budget** | Works out money left before payday, including weekends and bank holidays for each UK nation | "I want to know what I can spend per day until payday." |
| **Light and dark themes** | Follows the system setting, with a manual switch | |

### Requirements for an answer
- Answer only from approved, live, in-date passages for the chosen nation.
- Every sentence must cite a source it was given.
- Every figure must appear in a cited passage.
- If nothing survives these checks, show no answer and list the sources instead.
- Show a "not financial advice" notice with every answer.
- If someone asks "should I…", give only the general rules and point to regulated advice.

### Success measures
| Measure | Target | Result on the 5 approved guides |
|---|---|---|
| Right section in the top 5 results (hybrid Recall@5) | at least 90% | **100%** |
| Results from the wrong nation or tax year | 0 | **0** |
| Answer benchmark, automatic checks | as high as possible | **30/30** tuned set, **14/20** new held-out set (all 6 misses are refusals, no wrong answers) |

---

## 3. What exists and what doesn't

### Working today
- Full pipeline from GOV.UK ingestion to a checked answer in the browser.
- 25 guides stored with version history; **5 approved and searchable**.
- Hybrid retrieval, relevance threshold, citation checks and abstention (refusing to answer).
- Reading-first web app on desktop and mobile, with light and dark themes.
- Payday budget calculator, written with whole-pence arithmetic.
- Automated tests, labelled retrieval and answer benchmarks, and CI workflow files.
- A read-only freshness check against GOV.UK, with a weekly schedule ready to enable.
- Spend limits, a concurrency limit and a safe answer cache.
- Separate database branches for development, testing and production.

### Not built yet
- **Public deployment.** It runs only on a local machine.
- **Production data.** The production database branch has no approved content yet.
- **Streaming answers.** The answer appears all at once.
- **Follow-up question suggestions.**
- **Conversation memory.** Each question is answered on its own, by design.
- **Accounts or saved history.**
- **Dashboards and alerting.** Logs contain the data, but nothing watches them yet.
- **CI on GitHub.** The code is in a private repository, but GitHub doesn't start workflows there (`startup_failure`, 30 Oct), as on another private repository on the same account. The same CI steps pass on a clean clone of the pushed commit, run locally.
- **A recorded human review of the current answers.** The owner reports reviewing earlier answers, but no marks are recorded in this repository, and the answers changed on 31 Oct. See the [checklist](docs/ANSWER_REVIEW_CHECKLIST.md).

---

## 4. How it works, in plain English

Think of WageWise as a careful librarian rather than a clever talker.

1. **The library (ingestion).** A script downloads a curated list of guides from GOV.UK's official Content API, splits them into sections and small passages ("chunks"), and stores every version. Nothing is overwritten, so there is always a record of what GOV.UK said.
2. **The licence check.** A person reviews each guide. Unapproved guides stay in storage, but nothing can search them or send them to the AI. The database enforces this.
3. **The index (embeddings).** Each approved passage is converted into 384 numbers that represent its meaning. Passages with similar meanings get similar numbers.
4. **The question.** You ask something and, optionally, choose your nation. The question is validated first.
5. **The search (retrieval).** WageWise searches two ways at once: by exact words (good for "1257L") and by meaning (good for "my employer took too much tax"). It merges the two rankings. Filters remove anything from the wrong nation, outside its tax year, or unapproved.
6. **The relevance check.** WageWise needs a strong match, or a fair match where one passage contains every meaningful word of the question. Otherwise it says it won't guess, and the AI isn't called at all. A one-word question like "pension" gets a request for more detail.
7. **The answer (generation).** Claude Haiku 5.5 receives the passages with strict rules: use only these sources, cite them, and treat their text as data rather than instructions.
8. **The fact check (verification).** Code, not AI, checks every sentence. A sentence is removed if it cites an unknown source, cites nothing, contains a figure missing from its cited passage, talks about the sources rather than the rules, or uses wording mostly absent from the passage. If nothing survives, no answer is shown. This catches inventions; it doesn't prove an answer is right.
9. **The page.** You see the answer, numbered citations and a sources panel showing which sources were used, which nations they apply to and which period they cover.

This approach is called **RAG (Retrieval-Augmented Generation)**: find trusted text first, then have the AI write from that text.

---

## 5. Architecture

```mermaid
flowchart LR
  subgraph Browser
    W[React web app]
  end
  subgraph Server[Fastify API on Node.js]
    R[Routes and validation]
    S[Hybrid search]
    E[Local embedding model]
    C[Answer and citation checks]
    P[Payday calculator]
  end
  subgraph Neon[Neon Postgres + pgvector]
    D[(Versioned guides, chunks, vectors)]
  end
  G[GOV.UK Content API]
  A[Anthropic API: Claude Haiku 5.5]
  CLI[Command-line jobs: ingest, embed, eval]

  W --> R
  R --> S
  S --> E
  S --> D
  R --> C
  C --> A
  R --> P
  CLI --> G
  CLI --> D
```

### Question flow

```mermaid
flowchart TD
  Q[Question + nation + date] --> V[Validate: 3 to 500 characters, no extra fields]
  V --> S[Hybrid search: approved, live, right nation, in date]
  S -->|One vague word| A0[Ask for more detail]
  S -->|Nothing relevant| A1[Abstain: no AI call]
  S -->|Evidence found| F[Withhold passages containing AI instructions]
  F --> P[Build prompt with escaped sources]
  P --> H{Same prompt in cache?}
  H -->|Yes| C
  H -->|No| L[Claude Haiku 5.5: structured output, no tools, spend limits]
  L -->|Timeout or error| A2[Show sources only]
  L -->|Model says not covered| A3[Abstain and list sources]
  L --> C[Check each sentence: valid citation, figures in cited text]
  C -->|Nothing survives| A4[Abstain and list sources]
  C --> OK[Schema-checked answer + citations + notices + disclaimer]
```

### Ingestion flow

```mermaid
flowchart LR
  L[Curated list of 25 guides] --> F[Fetch from GOV.UK Content API]
  F --> N[Parse and normalise]
  N --> H{Content changed?}
  H -->|No| U[Record the check only]
  H -->|Yes| I[Store a new immutable version, sections and chunks]
  I --> R[Human licence decision]
  R --> M[Embed approved content only]
  M --> Q[Searchable through the retrievable_chunks view]
```

### Technology
| Layer | Technology | Why |
|---|---|---|
| Web | React 19, Vite 6, Tailwind CSS 3, TypeScript, lucide icons | Fast, simple, strictly typed |
| Fonts | Inter and Newsreader, self-hosted (OFL licence) | Readable, with no calls to Google |
| API | Node.js, Fastify 5, Zod 4 | Fast server with validated input |
| Database | Neon Postgres 18, pgvector 0.8.6 | One database for text search and vectors; branches isolate environments |
| Embeddings | BAAI bge-small-en-v1.5 (384 dimensions), run locally with transformers.js | No per-query cost; questions stay on the server |
| Answers | Anthropic Claude Haiku 5.5, official SDK, structured JSON output | Low cost and low latency |
| Testing | Vitest, plus a 67-question labelled benchmark | Unit, HTTP and real database coverage |
| Quality | Strict TypeScript, ESLint, GitHub Actions workflow | Consistent checks |

### Folder map
```text
wagewise-uk-clean/
├─ PROJECT_OVERVIEW.md      this file
├─ README.md                how to run it
├─ .env.example             settings template (real values live in .env, never in git)
├─ apps/
│  ├─ api/                  backend
│  │  ├─ data/              bank holidays, licence decisions
│  │  ├─ src/chat/          answer pipeline and citation checks
│  │  ├─ src/retrieval/     hybrid search and benchmark logic
│  │  ├─ src/embeddings/    local embedding model and batch job
│  │  ├─ src/ingest/        GOV.UK fetching, parsing, chunking, storage, verification
│  │  ├─ src/llm/           Anthropic integration
│  │  ├─ src/domain/        payday, dates, bank holidays, link directory
│  │  ├─ src/db/            connections and migration runner
│  │  ├─ src/cli/           commands such as ingest, embed, eval
│  │  └─ tests/             unit, HTTP and database tests
│  └─ web/src/              React app: chat, sources panel, search, budget
├─ db/migrations/           database schema, in numbered SQL files
├─ evals/                   retrieval and answer benchmarks, with their reports
├─ docs/                    licence review records, deployment plan
└─ .github/workflows/       CI
```

### API
| Route | Purpose | Limit per IP per minute |
|---|---|---|
| `POST /api/chat` | Grounded answer | 10 |
| `POST /api/guidance/search` | Passage search | 20 |
| `POST /api/source-search` | Link directory | 60 |
| `POST /api/budget` | Payday calculation | 60 |
| `GET /api/health` | Status of search, chat and bank holiday data | 60 |
| `GET /api/ready` | Checks the database connection | 60 |

### Database
| Table or view | Holds |
|---|---|
| `source_documents` | One row per guide: licence status, nations, lifecycle |
| `document_versions` | Immutable versions, with content hashes |
| `document_sections`, `document_chunks` | Sections and passages, with full-text search data |
| `ingestion_runs`, `ingestion_run_items` | History of every ingestion |
| `embedding_models`, `chunk_embeddings`, `embedding_runs` | Vectors and embedding history |
| `evaluation_runs` | Benchmark history |
| `retrievable_chunks` (view) | **The only door to searchable content:** approved, live, active |

### Key numbers in the pipeline
| Setting | Value |
|---|---|
| Chunk size and overlap | 1,200 characters, 150 overlap |
| Candidates per search list | 30 |
| Ranking fusion | Reciprocal Rank Fusion, k = 60, vector ranks weighted 3× |
| Sources sent to the model | Up to 6 sections, each up to 6,000 characters |
| Answer length | Up to 8 sentences of at most 40 words |
| Search floor | 0.69 cosine similarity |
| Answer gate | 0.75, or 0.69 with all of 3+ meaningful words in one passage |
| Model ceilings | 1,200 output tokens per answer, 4 at once, 2,000,000 tokens a day |
| Answer cache | 500 entries, 60 minutes |
| Model timeout | 30 seconds in total, including retries |

---

## 6. Sources and data

### Approved corpus (5 of 25 guides)
Approved by Aryan Yadav on 29 October 2026. This is 22 sections, 81 chunks and 81 vectors.

| Guide | Nations |
|---|---|
| [Tax codes](https://www.gov.uk/tax-codes) | All four |
| [Income Tax rates and Personal Allowances](https://www.gov.uk/income-tax-rates) | England, Wales, Northern Ireland |
| [Scottish Income Tax](https://www.gov.uk/scottish-income-tax) | Scotland |
| [Welsh Income Tax](https://www.gov.uk/welsh-income-tax) | Wales |
| [National Insurance](https://www.gov.uk/national-insurance) | All four |

### Stored but not approved (20 guides, not searchable)
- **Tax and pay:** National Insurance rates and letters, understanding your pay, PAYE forms (P45, P60, P11D), tax overpayments and underpayments, repaying your student loan.
- **Pensions:** workplace pensions, new State Pension, tax on private pensions, Pension Credit.
- **Employment:** Statutory Sick Pay, National Minimum Wage, holiday entitlement, maternity, paternity, shared parental leave, redundancy.
- **Benefits:** Universal Credit, Child Benefit, Tax-Free Childcare, benefit cap.

The full store is 25 guides, 25 versions, 133 sections and 701 chunks, with 0 integrity problems.

### External sources and services
| Source | Used for | Terms |
|---|---|---|
| [GOV.UK Content API](https://content-api.publishing.service.gov.uk/) | Guidance text | Open Government Licence v3.0, with per-guide human review |
| [GOV.UK bank holidays](https://www.gov.uk/bank-holidays.json) | Payday calculator | Open Government Licence v3.0 |
| [BAAI bge-small-en-v1.5](https://huggingface.co/BAAI/bge-small-en-v1.5) (Xenova ONNX conversion) | Embeddings, run locally | Open model, pinned revision |
| [Anthropic API](https://www.anthropic.com/) | Writing answers | Paid API; called only from the server |
| [Neon](https://neon.tech/) | Hosted Postgres | Free plan |
| [Perplexity](https://www.perplexity.ai/) | Design inspiration only | No code, logo, fonts or brand colours were copied |
| MoneyHelper, FCA, FSCS | **Links only**, in Key links | Their content is never fetched, stored, embedded or sent to the AI, because reuse rights haven't been checked. WageWise has no connection with them |

GOV.UK excerpts are shown with this attribution: *Contains public sector information licensed under the Open Government Licence v3.0.*

---

## 7. Results

### Retrieval benchmark on approved content
40 questions were evaluated: 20 answerable and 20 unanswerable or ambiguous. Another 27 answerable questions were skipped because their guides are not approved, so they don't count as failures.

| Mode | Recall@5 | MRR | Wrong nation or year | Median speed |
|---|---|---|---|---|
| Keyword | 100% | 0.742 | 0 | 330 ms |
| Meaning (vector) | 100% | 0.950 | 0 | 349 ms |
| **Hybrid before V2** | 95% | 0.883 | 0 | 373 ms |
| **Hybrid in V2** | **100%** | **0.925** | **0** | **331 ms** |
| **Hybrid in V2.1** | **100%** | **0.925** | **0** | **474 ms** |

*Recall@5: how often the right section appears in the top 5. MRR: how near the top it appears, where 1.0 is always first.*

Hybrid improved in V2 because vector ranks count three times as much as keyword ranks. V2.1 changed no retrieval score: its gain is in refusals and nation handling, measured below. Keyword-only MRR fell from 0.742 to 0.717 in V2.1, but keyword-only isn't what the app uses.

Vector search alone still has a higher MRR because of one question out of 20 (`nat-08`). A vector weight of 8 would match it, but tuning to one question would be overfitting, so the weight stays at 3. Keywords don't improve ranking on this dataset. They are kept for exact codes such as "1257L" and as the fallback when embeddings are unavailable.

The thresholds stay at 0.69 and 0.75. The strictest similarity threshold keeping 95% of answerable questions is still 0.709.

### Answer benchmark (real Claude Haiku 5.5)
Each question runs twice through the full pipeline. Automatic checks cover behaviour, required and forbidden text, nation and tax year. Reports are in `evals/answers/results/`.

| Set | Before V2 | V2 | V2.1 |
|---|---|---|---|
| Frozen set of 30, used for tuning | 26/30 | 30/30 | **30/30** |
| First held-out set of 17 | not run | 16/17 | **17/17** (no longer unseen: its miss was fixed on request) |
| "Should I…" set of 12, used to build the recommendation check | 11/12 | 12/12 | **12/12** |
| "Should I…" set of 8 in other wordings | not run | 8/8 | **8/8** |
| Jurisdiction set of 20, used to build the V2.1 fixes | not run | not run | **20/20** |
| **New held-out set of 20, run blind once** | not run | not run | **14/20** |

**The blind 14/20 is the fairest measure.** All 6 misses are refusals of casually worded questions, such as "Scottish starter rate please". No answer was wrong, and all 7 conflict, unsupported, injection and advice cases behaved correctly. The set scored 14/20 again on the final code, which isn't a blind result. It hasn't been tuned on.

V2 note: the 30/30 is flattering because fixes targeted those failures, and the first held-out score was the fairer measure at the time. Its miss: "What is the advanced rate of income tax?" for Scotland is refused, though the answer is in the corpus. Both sets are small, and the thresholds were chosen on the benchmark data.

The "Should I…" sets only look for recommendation wording, so they show the wording is gone, not that the answers are right. The set of 8 passed first time, but it then exposed one phrasing the detector missed, which was fixed, so it no longer counts as held out. Four of the 12 and five of the 8 were refused, so the check was tested on 11 answered questions, and many personal questions get no answer at all.

**Human review is still pending.** The sheets have blank columns for a person to mark correctness, citation support, completeness, recommendation wording, abstention and injection resistance. Follow [docs/ANSWER_REVIEW_CHECKLIST.md](docs/ANSWER_REVIEW_CHECKLIST.md).

### V2.1: nation and tax-year fixes
**Root cause of the jurisdiction bug.** None of the 81 approved chunks contains the word "England", and only one contains "Northern Ireland". So a nation named in a question counted as a word the guidance had to contain, and it also pulled similarity below the floor. "What is the higher rate of Income Tax in England?" scored 0.678 against a 0.69 floor, while the same question with England selected scored 0.697 and every word matched. Scotland and Wales hid the bug because their guides do use those words.

**The fix.** A nation in the question now becomes the nation filter and leaves the search and evidence text. A tax year in the question sets the date filter, which also made approved past-year guidance reachable for the first time.

**Rejected on measurement:**
- Letting all-words evidence bypass the floor: it passed "How much is Child Benefit?".
- Adding the nation to the embedded text: it passed council tax, bitcoin and Child Benefit questions for Scottish and Welsh readers.
- Adding the nation to the keyword text: it brought no measured ranking gain, so it was removed.

| Check on frozen questions | Result |
|---|---|
| Named nation vs selected nation, 52 questions × 4 nations | **208/208 identical** results and decisions |
| Unanswerable questions passing the gate, across all 4 nations | **8 of 108**: the 2 questions that also passed before this work, `ty-06` and `year-03`, once per nation. The model and date filter handle them in the answer benchmark |

Automated versions of these checks are in `apps/api/tests/jurisdiction.test.ts` and `search.db.test.ts`.

### Failure testing on real servers (31 Oct)
| Case | Result |
|---|---|
| Empty, blank, too long, bad JSON, wrong type, extra field, bad nation, bad date | HTTP 400, no model call |
| NUL byte in a question | Handled, answered normally |
| Invalid API key | Sources only, HTTP 200, no key or provider text in the response |
| Model timeout (1 s limit) | Sources only, HTTP 200 |
| Injection (reveal prompt, fake £99,999 allowance) | Refused, or answered with the real £12,570 |
| Payday: Christmas Day, New Year in Scotland and England, weekend, invalid input | Correct dates; fractional pence and a missing weekend rule rejected. These cases ran just before the final search change, which doesn't touch the calculator; the final browser run confirmed payday still works |
| Server logs, 71 lines | No question text, no secrets |

Browser checks on 31 Oct (headless Chrome, desktop and mobile dark mode): the [demo flow](docs/DEMO.md), the conflict prompt and its button, citations with GOV.UK links, a refusal and the payday calculator all worked, with no console errors. A final desktop run on the finished code passed all 18 steps. Mobile dark mode was last run just before the final search change.

### Engineering checks
| Check | Result |
|---|---|
| Unit and HTTP tests | 298 pass (API 291, web 7) |
| Database tests on an isolated branch | 77 pass, about 13 minutes |
| Typecheck, lint, production build | Pass |
| `npm audit --omit=dev` | 0 vulnerabilities |
| Embedding library upgrade | Vectors match the old version (cosine 1.0000000) |
| Freshness check | 25 guides checked, 0 changed, 0 failed |
| Browser tests in headless Chrome | Desktop and mobile, both themes, clarifying prompt, sources panel, Key links, payday budget |
| Colour contrast | WCAG AA by calculation in both themes |
| Log audit | No question text or secrets in application logs |

### Caching
| Layer | Decision | Evidence |
|---|---|---|
| Ingestion | Existing: unchanged content creates no new version | 25 checked, 0 new versions |
| Embeddings | Existing: vectors reused for identical text and model | Covered by database tests |
| Retrieval | **Not cached.** It always runs live, which is what keeps the answer cache safe | Saves only about 0.3 s |
| Model answers | **New:** bounded in-memory cache | Median 1,966 ms with a model call, 486 ms from cache, 0 tokens |
| Browser | API sends `no-store`, so answers aren't kept | Header checked |

The answer cache key is a hash of the exact prompt, which holds the question, nation and full text of every source. Because retrieval runs live, withdrawn, superseded or newly approved content changes the key, so a stale answer can't be served; a database test proves this for a withdrawn guide. Personal questions ("I earn £40,000…") and "should I" questions are never cached. Cached drafts are still re-verified.

No real traffic exists, so **a real-world hit rate is unknown**. In the benchmark, where each question repeats once, 18 of 38 answerable runs came from cache.

### Performance and cost
| Measure | Value |
|---|---|
| Answer with a model call | About 2 seconds median |
| Repeat answer from cache | About 0.5 seconds |
| Refusal before any AI call | About 0.2 seconds median |
| Database round trip, UK to Ohio | 156 ms |
| API memory | 88 MB at start, 511 MB once the model loads (was 589 MB) |
| Tokens per model call | About 5,300, so roughly $0.0007 per answer at October 2026 list prices |

---

## 8. Safety and trust

| Risk | Protection |
|---|---|
| Invented figures | Code removes any sentence whose figures aren't in its cited passage |
| Invented wording | Sentences mostly absent from the passage, or about the sources themselves, are removed |
| Fake citations | Citations to unknown sources are removed; every response is schema-checked, and answer sources must be on GOV.UK |
| Weak matches | An evidence gate stops the pipeline before the AI is called. An answer needs strong similarity, every meaningful word in one passage, or every specific word in a passage written for the reader's part of the UK |
| Nation and tax year | A nation or tax year named in the question sets the filter, exactly as if selected. If the question and the selection disagree, the app asks instead of choosing |
| Wrong nation | Nation filter on every search |
| Out-of-date rates | Dated sections are withheld outside their stated period |
| Unlicensed content | The database view exposes approved content only, and a trigger refuses vectors for unapproved chunks |
| Prompt injection | Sources are escaped and marked as data; passages containing instructions to an AI are withheld; the model has no tools; each question stands alone |
| Personal advice | "Should I…" questions get general rules plus a regulated-advice notice. Code removes any sentence with recommendation wording, and for these questions any verdict or instruction, whatever the model wrote |
| Abuse and cost | Per-IP rate limits, length limits, a 16 KB request limit, a per-answer token cap, 4 concurrent model calls and a daily token ceiling |
| Common web attacks | Security headers, one allowed origin, HTTP timeouts, parameterised SQL, generic error messages |
| Over-privileged database access | A read-only role is designed and tested, to be applied at deployment |
| Privacy | No accounts or stored questions; question text is not logged. Questions that pass the relevance check are sent to Anthropic to write the answer |
| Accidental production changes | Local tools point at a development branch; the production URL isn't in local settings |

**Residual risks:** the exposed credentials are not rotated. Limits are per server process and reset on restart. Rate limits don't stop a distributed attack, which is why the Anthropic spend limit matters. The injection filter uses a pattern, so a cleverly worded instruction could pass it; human review of each guide remains the main defence. No independent security test has been done. No legal or regulatory review has been done, which a commercial launch would need.

---

## 9. Known limitations

These are real and should be stated honestly when presenting.

1. **Checks are not proof.** They catch invented figures, sources and wording. A sentence using the source's words can still give a wrong meaning, so human review and the link to GOV.UK still matter.
2. **Casually worded questions are often refused.** The blind test refused 6 of 20, including "Scottish starter rate please" and "What is the Class 4 rate in 2026/27?". This is safe, but it's the biggest quality gap. Comparing numbers in a question with tax bands ("income over £50,270") isn't supported either.
3. **Advice detection is wording-based.** Verdicts, instructions and recommendation phrases are removed by code, but a recommendation in other words can still pass, and a sentence quoting GOV.UK can still steer a reader ("the quickest way is…"). A question that isn't recognised as advice gets no advice notice. Human review is the backstop, and legal advice is needed before a commercial launch.
4. **Answers vary between runs.** The model doesn't support a fixed temperature, and 15 of 30 frozen questions gave identical text across two runs without the cache. Required facts passed in both runs on the frozen set, and cached repeats are identical.
5. **Thresholds were tuned on small datasets** and must be rechecked when guides are added.
6. **Coverage is narrow:** 5 guides, covering 20 of the 47 answerable retrieval questions.
7. **Ranking ties** can move a result by one place between databases.
8. **The database is in Ohio,** which adds latency for UK use.
9. **Limits and the cache are in memory,** so they are per server instance and reset on restart.
10. **MoneyHelper's link** couldn't be checked automatically because the site blocks automated requests.

---

## 10. Run and deploy

**Locally:** see `README.md`. The app runs at `http://localhost:5173` and the API at `http://localhost:3001`.

**Planned deployment** (details in `docs/DEPLOYMENT.md`, no Docker):
- Vercel for the web app.
- Render Standard (2 GB, about $25 a month) for the API, because 512 MB plans are too small for the model.
- Neon for the database.
- The Anthropic key stored only in server-side settings.

**Before any public launch:**
1. Rotate the Neon password and Anthropic key used during development. Both appeared in development logs or chat and were still not rotated on 30 Oct at 23:03. Exact steps are at the top of `docs/DEPLOYMENT.md`.
2. Set an Anthropic monthly spend limit.
3. Have a person complete the [answer review](docs/ANSWER_REVIEW_CHECKLIST.md).
4. Publish the approved content to the production branch, and create the read-only database role.
5. Decide where to host: next to the database in US-East, or move the database to London.
6. Deploy, then re-run the browser, CORS and rate-limit checks on the live site.
7. For a commercial launch, get qualified UK legal and regulatory review first.

---

## 11. Roadmap

**Next (V2.1): quality**
- Complete the human answer review and fix what it finds.
- Grow the held-out set, and fix refused questions like the Scottish advanced rate.
- Approve more guides, especially pensions, sick pay and student loans.

**Then: launch**
- Rotate credentials, deploy, and enable the freshness schedule.
- Alerts on errors, spending and abstention rate.

**Later, once quality and reliability hold up**
- Follow-up question suggestions, streaming answers and conversation memory.

---

## 12. Key decisions

| Decision | Why |
|---|---|
| Answer only from approved passages | Trust matters more than coverage for money questions |
| Abstain instead of guessing | A refusal is safer than a wrong figure |
| Code checks the AI, not more AI | Checks are cheap, deterministic and testable |
| Cache answers, not retrieval | Retrieval stays live, so stale content can't be served and nothing needs invalidating |
| No Redis or accounts | One server instance doesn't need them |
| Measure before tuning | The answer benchmark was frozen first, then checked on questions it had never seen |
| Hybrid search | Keywords catch exact codes; vectors catch meaning |
| One Postgres database | No separate vector database or microservices to run |
| Local embeddings | No per-query cost, and questions aren't sent to a third party for embedding |
| Immutable versions | Keeps an auditable record of what GOV.UK said |
| Human licence approval per guide | Open licences have exceptions, so a person confirms each page |
| Answer each question on its own | Earlier messages can't steer later answers |
| Neon branches | Isolated development and tests without Docker |
| Reading-first interface | Puts the answer first and evidence one click away |

---

## 13. How to present it

### 30-second version
"WageWise UK is a chatbot for UK tax and pay questions. General chatbots can give confident but wrong numbers, so WageWise answers only from approved GOV.UK guidance, checks every figure against its source with code, and refuses when the evidence isn't there. Every answer links to the official page."

### 2-minute structure
1. **Problem:** money rules are complex, and they vary by nation and tax year.
2. **Idea:** an assistant that shows its evidence and knows when to stop.
3. **Demo:** the questions below.
4. **How it works:** retrieve, generate, verify.
5. **Results:** 100% Recall@5, zero wrong-nation or wrong-year results, 14/20 on unseen questions with every miss a refusal, not a wrong answer.
6. **Honesty:** what citation checks can't catch, and what's next.

### Demo script
| Ask | What it shows |
|---|---|
| "What is an emergency tax code?" | A clear answer; click a citation to open its source |
| "What is the intermediate rate of income tax?" with Scotland, then England | Nation-aware behaviour |
| "What is the capital gains tax rate on selling shares?" | Refuses instead of guessing |
| Payday budget tab | A deterministic calculator alongside the AI |

### Portfolio or CV summary
- Built a full-stack RAG chatbot in TypeScript (React, Fastify, Postgres with pgvector) that answers UK tax questions only from licence-approved GOV.UK guidance.
- Implemented weighted hybrid retrieval, reaching 100% Recall@5 with zero wrong-nation or wrong-year results on a labelled benchmark of approved guides.
- Built an answer evaluation that improved results from 26/30 to 30/30, with 14/20 on blind held-out questions and no wrong answers, using code-based verification, a two-signal evidence gate and prompt-injection defences.
- Added a provably safe answer cache that cut repeat answers from about 2 s to 0.5 s, plus spend ceilings and schema-checked API responses.
- Covered the system with 375 automated tests across unit, HTTP and real database layers.

### Questions people may ask
- **Is it financial advice?** No. It gives general information and says so on every answer.
- **Can it still be wrong?** Yes. Checks catch invented figures and sources, not every wrong paraphrase, which is why every answer links to the source.
- **Why not just use ChatGPT?** WageWise restricts itself to reviewed official sources, filters by nation and date, and refuses when evidence is missing.
- **Why only five guides?** Each guide needs human licence review. Quality was proven on a small set first.
- **Is it live?** Not yet. It runs locally, with deployment planned.

---

## 14. Project history

| Stage | What happened |
|---|---|
| Foundations | Monorepo, payday calculator and bank holiday data, safe API |
| Ingestion | 25 GOV.UK guides stored as immutable, verified versions |
| Retrieval | Local embeddings, hybrid search, labelled benchmark |
| Chat | Claude Haiku integration, citation checks, abstention, injection defences |
| Move to Neon | Docker dropped; development, test and production database branches |
| Real content | 5 guides approved; benchmark and threshold run on real content; bugs from live testing fixed |
| Redesign | Studied Perplexity's public interface; rebuilt the UI as a reading-first experience with its own identity |
| Clean-up | Removed Docker files, unused packages, old tools and old planning documents; created this clean repository |
| V2 | Answer benchmark, better ranking and evidence gate, stricter checks, safe cache, spend limits, security headers, dependency upgrades, freshness check |

The project was built with AI pair programming using Claude Code.

---

## 15. Glossary

| Term | Meaning |
|---|---|
| **RAG** | Find trusted text first, then have AI write from it |
| **Corpus** | The set of documents the system can use |
| **Chunk** | A small passage of a document |
| **Embedding / vector** | Numbers representing the meaning of text |
| **Hybrid search** | Combining keyword search with search by meaning |
| **Abstain** | Refuse to answer when evidence is insufficient |
| **Threshold** | The minimum similarity needed to count as relevant |
| **Prompt injection** | Hidden text that tries to give the AI instructions |
| **Recall@5** | How often the right result appears in the top 5 |
| **MRR** | How close to the top the right result appears |
| **Ingestion** | Fetching and storing source content |
| **Migration** | A numbered script that changes the database structure |
| **CI** | Automated checks run on every code change |
| **OGL** | Open Government Licence, which allows reuse of UK government content with attribution |
