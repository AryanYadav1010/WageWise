# V3 release candidate

Branch `release/v3-rc`, for private demos. It isn't deployed, and it isn't merged into `main`. App code is from commit `bbac4c6`. Later commits change documentation, benchmark results and one line of the review sheet command.

## Verification on the release code, 31 October 2026

| Check | Result |
|---|---|
| Typecheck, lint, production build | Pass |
| Unit and HTTP tests | 509 pass (API 502, web 7) |
| Database tests on an isolated branch | 87 pass |
| Browser check on the real app, desktop and mobile | 28 of 28 |
| `npm audit --omit=dev` | 0 vulnerabilities |
| gitleaks, working files and full history | No leaks |

| Retrieval, 40 frozen questions | Recall@5 | MRR | Wrong nation or year |
|---|---|---|---|
| Hybrid | 100% | 0.925 | 0 |
| Vector | 100% | 0.950 | 0 |
| Keyword | 100% | 0.717 | 0 |

| Answer benchmark, real Claude Haiku 5.5 | Result |
|---|---|
| Frozen set | 30/30 |
| Jurisdiction set | 20/20 |
| Advice sets | 12/12 and 8/8 |
| Over-refusal diagnostic | 30/32 |
| Conversation development sets | 33/33 and 29/29 |
| Earlier single-turn held-out sets | 17/20 and 19/20 |
| Earlier conversation held-out sets | 21/22, 24/24 and 15/15 |

These re-runs aren't blind, because those sets were already exposed. The blind scores are in [PROJECT_OVERVIEW.md](../PROJECT_OVERVIEW.md): 14/20, 18/20, 19/22, 10/24 before and 20/24 after the stabilisation fixes, and 15/15. Automatic checks don't prove an answer is right.

## Human review

| Item | Status |
|---|---|
| Owner's statement | On 31 October 2026 the owner stated that they had reviewed all 66 priority rows and the relevant financial queries |
| Decisions for each row | **Not recorded.** All 66 rows of the [priority sheet](../evals/answers/review/v3-priority.md) are blank |
| Sign-off result, rows marked no, stop items | **Not recorded** |
| Commit the owner reviewed | Not stated. The sheet shows answers from `bbac4c6`, the app code in this release |
| Full review of 8 sheets | Not done |

No answer in this release can be counted as human-approved until those decisions are recorded. Any later change to the model, prompt, thresholds, guides or answer code needs a new review.

## Before any public release

- Reset the Neon password, which was exposed in development and had not been rotated at the last check on 30 October at 23:35.
- Confirm the replaced Anthropic key is deleted.
- Record the priority review, then complete the full review.
- Get GitHub Actions running: workflows don't start on this private repository, so these commits have not run in CI.
- Remove the leftover throwaway databases on the Neon test branch.
- Get qualified UK legal and regulatory review before any commercial launch.
