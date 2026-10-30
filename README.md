# WageWise UK

A source-grounded chatbot for UK money questions. It answers only from licence-approved GOV.UK guidance, cites every claim and says so when it doesn't know. It also includes guidance search, a link directory and a payday budget calculator.

**Independent portfolio project, not affiliated with or endorsed by GOV.UK, the UK Government, MoneyHelper or the FCA. General information only, not financial advice.**

The full explanation (product, architecture, sources, results, limitations) is in **[PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md)**.

## Run it

Needs Node.js 22+, a [Neon](https://neon.tech) Postgres database with pgvector, and an Anthropic API key.

```bash
npm install
cp .env.example .env     # then fill it in; never commit it or paste it anywhere
npm run db:migrate       # create the schema
npm run ingest           # fetch and store the 25 GOV.UK guides
npm run ingest:check     # later: compare GOV.UK with the store, changing nothing
npm run embed            # embed approved guides (downloads a 133 MB model once)
npm run dev              # API on :3001, web on :5173
```

## Checks

```bash
npm run typecheck && npm run lint && npm test && npm run build
npm run test:db          # needs TEST_DATABASE_URL on a separate Neon branch
```

## Working on content

```bash
npm run licence:review -- --list
npm run licence:review -- --path /guide --decision approved --reviewer "Your Name"
npm run ingest && npm run embed && npm run eval:retrieval
npm run eval:answers -- --label my-change    # answer quality, real model; small API cost
```

Before a public release, a person must complete [docs/ANSWER_REVIEW_CHECKLIST.md](docs/ANSWER_REVIEW_CHECKLIST.md).

After changing the approved guides, recheck `SEARCH_MIN_SIMILARITY` and `ANSWER_MIN_SIMILARITY` against the benchmarks. See [docs/LICENCE_REVIEW.md](docs/LICENCE_REVIEW.md) and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

GOV.UK content: *Contains public sector information licensed under the Open Government Licence v3.0.*
