# Deployment plan (Docker-free): proposal, not deployed

**Status (29 Oct 2026): nothing is deployed.** Creating paid services, publishing to the production database or going public all need the project owner's approval.

- Figures marked *measured* were measured locally on 29 Oct 2026.
- Prices come from provider pages read on 28 Oct 2026 and have **not** been re-checked since. Confirm them before signing up.

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
| Memory at start | 87 MB RSS |
| Memory after the first chat (bge-small fp32 loaded, pool and SDK active) | **589 MB** RSS |
| First chat after start | 3.7 s (includes loading the model, ~2 s) |
| Later chats | 2.2–5.5 s (model 2–5 s; search 0.3–0.4 s to Ohio) |
| Abstention before any model call (below threshold) | 0.2–1.3 s |

### Embedding strategy

The query embedding runs in-process: BAAI/bge-small-en-v1.5 via transformers.js, about 5 ms warm. Document embeddings are computed offline by `npm run embed` and stored in Neon. Options for the host, in order of preference:

1. **Render Standard (2 GB)** with the current fp32 model. 589 MB leaves enough headroom. Reported at about $25/month.
2. **512 MB plans** (Render Free or Starter): **not suitable** for fp32 (589 MB > 512 MB). An 8-bit model (`dtype: "q8"`) measured 259 MB for the model process earlier. It would need a new model id, a full re-embed, a re-run benchmark and a new calibrated threshold before use.
3. A hosted embedding API behind the existing `EmbeddingProvider` interface. This removes the model from the API process, but adds per-query cost and sends questions to a third party.

The model file (133 MB) downloads on first use into `.cache/models`. On Render, warm it in the build step, or the first query after each deploy pays the download.

Render's free plan sleeps after 15 minutes idle (about a minute to wake), which is unsuitable anyway.

## Environment variables

| Variable | Where | Notes |
|---|---|---|
| `NODE_ENV` | Render | `production`, which also stops the API reading any `.env` file. |
| `HOST`, `PORT` | Render | `0.0.0.0`; Render's `$PORT`. |
| `DATABASE_URL` | Render | Neon **production pooled** URL (host contains `-pooler`). |
| `ANTHROPIC_API_KEY` | Render (secret) | A **new** key, created after rotation. Never in the web app, logs or git. |
| `LLM_MODEL`, `LLM_TIMEOUT_MS` | Render | `claude-haiku-5-5`; `15000` is enough (answers take 2–5 s) and caps waiting, including retries. |
| `EMBEDDING_PROVIDER` | Render | `local-bge-small`. |
| `SEARCH_MIN_SIMILARITY` | Render | `0.7089`, from `evals/retrieval/results/2026-10-29-real-subset1.json`. Recalibrate whenever approved guides change. Chat stays off without it. |
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
| Rate limits | Per-IP limits on all routes (chat 10/min). They are in memory, so per instance and reset on deploy. Proxy-aware via `TRUST_PROXY_HOPS`. | Set `TRUST_PROXY_HOPS=1`. Set a **monthly spend limit** in the Anthropic console: per-IP limits don't stop distributed abuse. |
| Costs | Haiku 5.5 at $0.10 / $0.50 per million input / output tokens (Anthropic price list, 6 Oct 2026). Prompts now carry up to 3,000 characters per source × 6 (≈5,000 input tokens), so roughly **$0.0007 per answer**. Neon Free: 1 GB, 100 CU-hours a month. Vercel Hobby is free for non-commercial use. Render Standard about $25/month. | Re-check prices. Anthropic spend limit set. |
| Data freshness | Manual: `npm run ingest` re-checks every guide, and versions only on change. No scheduler yet. Tax-year sections drop out automatically after their stated period. | Before 6 April 2027 (the new tax year), re-ingest, re-embed and re-evaluate. Add a scheduled job (M5). |
| Monitoring | `/api/health` (search, chat, data date). Structured logs with request ids, outcomes and drop reasons; never question text or secrets. | Point Render's health check at `/api/health`; add an uptime ping. Alerting doesn't exist yet. |
| Database access | API: production pooled URL only. CLIs: development. Tests: test branch. | Optionally restrict Neon access to Render's outbound IPs (paid feature). Keep the production URL out of local files. |
| CI | `.github/workflows/ci.yml`: typecheck, lint, unit tests and builds on push and PR; no secrets, no database. | Push to a GitHub repository; it has not run on GitHub yet, because this folder is not its own repository. |
| Credentials | The Neon password and Anthropic key exposed on 29 Oct are **still in use**. | Rotate both before any deployment. |

## Steps for a public preview (in order; stop at any failed gate)

1. **Rotate** the Neon password (all branches) and the Anthropic key. Run `neon env pull` (development branch), copy the two URLs from `.env.local` into `.env`, delete `.env.local`, and set the test URL.
2. **Licences:** the first five guides are approved (29 Oct, by Aryan Yadav). Approve more only after a per-guide review.
3. **Publish** to production (above). `ingest:verify` must report 0 problems, and `eval:retrieval` must match development: hybrid Recall@5 ≥ 90% and 0 leaks.
4. **Security checks:** `npm audit --omit=dev` reviewed; no secrets in the repository; logs contain no question text.
5. **Deploy** the API to Render (Standard) with the variables above, then the web app to Vercel.
6. **Live checks** against the public URLs: the browser checks listed in `PROJECT_OVERVIEW.md`, CORS from another origin, separate per-visitor rate limits, and `/api/health` showing search and chat `configured`.
7. **Label it a preview:** five guides only, "not financial advice", and a note that answers can still paraphrase wrongly (see the limitations in the README).

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
