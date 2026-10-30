# Deployment plan (Docker-free): proposal, not deployed

**Status (30 Oct 2026): nothing is deployed.** Creating paid services, publishing to the production database or going public all need the project owner's approval.

- Figures marked *measured* were measured locally on 29 Oct 2026.
- Prices come from provider pages read on 28 Oct 2026 and have **not** been re-checked since. Confirm them before signing up.

## Blocker: rotate the exposed credentials first

**Checked 30 Oct 2026 at 23:03: not rotated.** The values in `.env` are the ones exposed during development, the Neon password is unchanged on the server, and the old Anthropic key still works. Nothing should be deployed until this is done. Only the owner can do it.

1. **Neon:** Neon Console → your project → Branches → open `production` → Roles & Databases → `neondb_owner` → Reset password. Repeat on `development` and `test`.
2. **Update `.env` yourself**, without pasting values anywhere else: set `DATABASE_URL` from `neon connection-string development --pooled`, `DATABASE_URL_UNPOOLED` from `neon connection-string development`, and `TEST_DATABASE_URL` from `neon connection-string test`.
3. **Anthropic:** Console → Settings → API keys → create a new key, put it in `.env`, then delete the old key.
4. **Set a monthly spend limit** in the Anthropic console.
5. **Confirm:** restart the app; `curl localhost:3001/api/ready` should return `"database":"ok"`, and asking a question should work.

## Target

| Part | Service | Notes |
|---|---|---|
| React/Vite web app | **Vercel**, static build of `apps/web` | Build `npm run build -w @wagewise/web`, output `apps/web/dist`. Nothing secret in the bundle (`VITE_API_URL` only). |
| Fastify API + local embeddings | **Render** web service, native Node 22 runtime, no Docker | Build `npm ci && npm run build -w @wagewise/api`; start `node apps/api/dist/server.js`; health check `/api/health`. |
| Postgres + pgvector | **Neon** branch `production` | The API reads it through the **pooled** URL only. |
| Answers | **Anthropic API**, `claude-haiku-5-5` | Called server-side only. |

## Neon branches

| Branch | Used by | Who writes |
|---|---|---|
| `production` | The deployed API (read-only use) | Only the owner, during a deliberate **publish** step (below). Its URL is not in the local `.env`. |
| `development` | Local `npm run dev` and the CLIs (`.env`, `.neon`) | Local work: ingest, embed, eval. Created 29 Oct from production, no expiry. |
| `test` | `npm run test:db` | Tests only, in their own throwaway databases; the code refuses the main branch and pooled URLs. |

### Publishing the approved corpus to production (owner, deliberately)

Production holds no approved content yet: on 29 Oct it had 0 vectors and 0 approved guides. After checking the development results:

```bash
cd ~/Desktop/wagewise/wagewise-uk
export DATABASE_URL_UNPOOLED="$(neon connection-string production)"   # value stays in this shell, not in history or .env
npm run db:migrate && npm run ingest && npm run ingest:verify && npm run embed && npm run eval:retrieval
unset DATABASE_URL_UNPOOLED
```

Environment variables override `.env`, so these commands write to production only while that variable is set. The eval must reproduce the development metrics, give or take one case: exact score ties are broken by random row ids, which differ between databases.

## Runtime (measured, production build)

| What | Value |
|---|---|
| Start-up to listening | 0.47 s; the model is not loaded at start |
| Memory at start | 88 MB RSS |
| Memory after the first chat (bge-small fp32 loaded, pool and SDK active) | **511 MB** RSS |
| First chat after start | 3.3 s (includes loading the model, ~1.4 s) |
| Later chats | About 2 s median with a model call; 0.5 s from cache |
| Abstention before any model call (below threshold) | 0.2–1.3 s |

### Embedding strategy

The query embedding runs in-process: BAAI/bge-small-en-v1.5 via transformers.js, about 5 ms warm. Document embeddings are computed offline by `npm run embed` and stored in Neon. Options for the host, in order of preference:

1. **Render Standard (2 GB)** with the current fp32 model. 511 MB leaves enough headroom. Reported at about $25/month.
2. **512 MB plans** (Render Free or Starter): **not suitable** for fp32 (511 MB leaves nothing spare). An 8-bit model (`dtype: "q8"`) measured 259 MB for the model process earlier. It would need a new model id, a full re-embed, a re-run benchmark and a new calibrated threshold before use.
3. A hosted embedding API behind the existing `EmbeddingProvider` interface. This removes the model from the API process, but adds per-query cost and sends questions to a third party.

The model file (133 MB) downloads on first use into `.cache/models`. On Render, warm it in the build step, or the first query after each deploy pays the download.

Render's free plan sleeps after 15 minutes idle (about a minute to wake), which is unsuitable anyway.

## Environment variables

| Variable | Where | Notes |
|---|---|---|
| `NODE_ENV` | Render | `production`, which also stops the API reading any `.env` file. |
| `HOST`, `PORT` | Render | `0.0.0.0`; Render's `$PORT`. |
| `DATABASE_URL` | Render | Neon **production pooled** URL (host contains `-pooler`), for the read-only role below. |
| `ANTHROPIC_API_KEY` | Render (secret) | A **new** key, created after rotation. Never in the web app, logs or git. |
| `LLM_MODEL`, `LLM_TIMEOUT_MS` | Render | `claude-haiku-5-5`; `15000` is enough (answers take 2–5 s) and caps waiting, including retries. |
| `EMBEDDING_PROVIDER` | Render | `local-bge-small`. |
| `SEARCH_MIN_SIMILARITY`, `ANSWER_MIN_SIMILARITY` | Render | `0.69` and `0.75`, chosen on the frozen benchmark. Recalibrate whenever approved guides change. Chat stays off without the first. |
| `LLM_MAX_CONCURRENT`, `LLM_DAILY_TOKEN_LIMIT` | Render | Defaults 4 and 2,000,000 tokens a day (about 370 answers). Past either limit, users get sources without an answer. |
| `ANSWER_CACHE_ENTRIES`, `ANSWER_CACHE_TTL_MINUTES` | Render | Defaults 500 and 60. |
| `WEB_ORIGIN` | Render | The exact Vercel URL, for CORS. |
| `TRUST_PROXY_HOPS` | Render | `1`, so rate limits key on the visitor, not on Render's proxy. Leave it `0` locally, where `X-Forwarded-For` is ignored and can't be spoofed. Check after deploy: two different clients must get separate limits. |
| `RATE_LIMIT_PER_MINUTE`, `SEARCH_RATE_LIMIT_PER_MINUTE`, `CHAT_RATE_LIMIT_PER_MINUTE` | Render | Defaults 60, 20 and 10 per IP per minute. |
| `VITE_API_URL` | Vercel | The Render URL. Public by design. |

Never on Render: `DATABASE_URL_UNPOOLED`, `TEST_DATABASE_URL`. The API needs neither.

## Readiness checklist

| Area | State | Before going public |
|---|---|---|
| HTTPS | Vercel and Render terminate TLS. The API connects to Neon with `sslmode=verify-full`. | Use `https://` URLs for `VITE_API_URL` and `WEB_ORIGIN`. |
| CORS | Exactly one allowed origin (`WEB_ORIGIN`). | Set it to the Vercel URL, then check that another origin is refused. |
| Rate limits | Per-IP limits on all routes (chat 10/min), a concurrency limit and a daily token ceiling. All are in memory: fine for one instance, and a restart resets them. | Set `TRUST_PROXY_HOPS=1`. Set a **monthly spend limit** in the Anthropic console: per-IP limits don't stop distributed abuse. Add a shared store (Redis) only when running more than one instance. |
| Costs | Haiku 5.5 at $0.10 / $0.50 per million input / output tokens (Anthropic price list, 6 Oct 2026). Measured about 5,300 tokens per model call, so roughly **$0.0007 per answer**; cached repeats cost nothing. Neon Free: 1 GB, 100 CU-hours a month. Vercel Hobby is free for non-commercial use. Render Standard about $25/month. | Re-check prices. Anthropic spend limit set. |
| Data freshness | `npm run ingest:check` compares GOV.UK with the store and changes nothing. `.github/workflows/freshness.yml` runs it weekly; a failed run emails the owner. Applying a change stays a person's decision: `npm run ingest && npm run embed && npm run eval:retrieval`. Tax-year sections drop out automatically after their stated period. | Add the `DATABASE_URL_UNPOOLED` secret to enable the schedule. Between `ingest` and `embed`, new chunks have keyword search only, so run them together. Re-check everything before 6 April 2027. |
| Monitoring | `/api/health` (no database call, for frequent platform checks) and `/api/ready` (checks the database). Each chat logs outcome, abstain reason, drop reasons, tokens, cache hit, retrieval and model time; never question text or secrets. | Point Render's health check at `/api/health`, and a 5-minute uptime monitor at `/api/ready`. Alert on the log fields in your log tool; no dashboards exist yet. |
| Database access | API: production pooled URL only. CLIs: development. Tests: test branch. | Use the read-only role below. Optionally restrict Neon access to Render's outbound IPs (paid feature). Keep the production URL out of local files. |
| Backups | Neon keeps restore history for a window that depends on the plan. All content can be rebuilt from GOV.UK; licence decisions are in git. | Confirm the window on your plan, and do one test restore to a new branch. |
| CI | `.github/workflows/ci.yml`: audit, typecheck, lint, unit tests and builds; database tests when the `TEST_DATABASE_URL` secret exists. | Pushed to a private repository on 30 Oct, but no workflow can start: GitHub reports `startup_failure`, including for the freshness workflow, and another private repository on the account shows the same. Check Actions billing and limits in the account settings, then confirm a green run. The CI steps pass on a clean clone run locally; the database job and the weekly freshness check have never run on GitHub. |
| Credentials | **Not rotated.** See the blocker at the top. | Rotate before any deployment. |
| Static assets | Vite gives built files hashed names, which Vercel caches long-term; the API sends `no-store`, so answers aren't kept in browsers. | Add a CSP on Vercel with `connect-src` set to the Render URL. |

## Steps for a public preview (in order; stop at any failed gate)

1. **Rotate** the credentials (see the blocker at the top).
2. **Licences:** the first five guides are approved (29 Oct, by Aryan Yadav). Approve more only after a per-guide review.
3. **Publish** to production (above). `ingest:verify` must report 0 problems, and `eval:retrieval` must match development: hybrid Recall@5 ≥ 90% and 0 leaks.
4. **Security checks:** `npm audit --omit=dev` reviewed; no secrets in the repository; logs contain no question text.
5. **Answer review:** [ANSWER_REVIEW_CHECKLIST.md](ANSWER_REVIEW_CHECKLIST.md) signed off, with no stop item open.
6. **Deploy** the API to Render (Standard) with the variables above, then the web app to Vercel.
7. **Live checks** against the public URLs: the browser checks listed in `PROJECT_OVERVIEW.md`, CORS from another origin, separate per-visitor rate limits, and `/api/health` showing search and chat `configured`.
8. **Label it a preview:** five guides only, "not financial advice", and a note that answers can still paraphrase wrongly (see the limitations in the README).

## Read-only database role for the API

The deployed API only reads. Run this on `production` as the owner, then give the API a connection string for this role. Verified 30 Oct in a rolled-back transaction on the test branch: the role can read what the API needs, and direct table reads, writes and `DROP` are refused.

```sql
CREATE ROLE wagewise_app LOGIN PASSWORD '<generate in the Neon console or a password manager>';
GRANT USAGE ON SCHEMA public TO wagewise_app;
GRANT SELECT ON retrievable_chunks, chunk_embeddings TO wagewise_app;
```

`ingest:check` also needs `SELECT` on `source_documents` and `document_versions`, so give the freshness workflow its own read-only role with those grants.

## Known limitations

- **Region:** the Neon project is in AWS us-east-2 (Ohio). One round trip from the UK takes 156 ms. Either host the API in US-East next to the database, or move to London first (below).
- There is no authentication: the preview is anonymous and read-only, protected by rate limits only.

## Moving the database to London (plan, not done)

A Neon project's region can't be changed, so this means a new project in `aws-eu-west-2` (the region is available through Neon's API, though the CLI help omits it):

1. `brew install postgresql@18` so `pg_dump` matches the server version.
2. Create the new project: `neon projects create --name wagewise-uk-london --region-id aws-eu-west-2 --org-id <your-org-id> --no-secrets`.
3. Copy the data using direct URLs held in environment variables: `pg_dump --format=custom --no-owner --no-privileges` from the old project, then `pg_restore --no-owner --no-privileges` into the new one. Alternatively rebuild with `npm run db:migrate && npm run ingest && npm run embed`, which loses audit history.
4. Before switching, require: `ingest:verify` 0 problems, matching `eval:retrieval` results, and `test:db` passing on a new `test` branch.
5. Update `.neon`, `.env` and the host's variables. The new project has new passwords.
6. Keep the Ohio project for 14 days as a rollback, then delete it.
