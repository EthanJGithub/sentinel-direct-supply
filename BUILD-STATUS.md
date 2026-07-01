# BUILD-STATUS — Sentinel (built overnight 2026-06-26)

**Status: complete and verified end-to-end, fully offline ($0, no keys).** All of
Phases 0–4 from `BUILD-PLAN.md §9` are built. Below is exactly what works, what was
verified, and what's left for you.

## What's done (every stack element used)
| Component | State | Verified |
|---|---|---|
| **C#** catalog/contract service (ASP.NET Core + EF Core) | built | `dotnet build -c Release` ✅ |
| **Python** LangGraph agent (Planner→Sourcing→Compliance→Budget→Audit + HITL) | built | graph runs offline; `/plan`+`/approve` live ✅ |
| Provider abstraction (Claude Opus/Haiku + OpenAI + heuristic $0 fallback) | built | dev/auto modes ✅ |
| **TS** MCP tool server (reg_search/validate_item/validate_layout/cost_calc) | built | `npm test` 7/7 ✅ |
| **TS** React/Vite clinical console | built | `npm run build` ✅; screenshot in `docs/img/console.png` ✅ |
| **Eval harness** + golden scenarios + gate | built | `python eval/harness.py` GATE PASSED ✅ |
| Real reg corpus (42 CFR §483.90 verbatim + Appendix PP + NFPA 101) | built | verified vs eCFR/Cornell ✅ |
| ~290-SKU catalog + GPO pricing + 5 planted-violation traps | built | generated + seeded ✅ |
| **Docker** (4 Dockerfiles, repo-root context, data baked in) | built + run | **standalone deploy verified** ✅ (see below) |
| **Terraform** (ECS/RDS/S3/ECR/CloudWatch + LocalStack) | written | **`terraform validate` = Success** (TF 1.15.7, AWS provider v5.100) ✅ |
| **GitHub Actions** eval-gated CI | written | runs on push once on GitHub ⚠️ |
| **Groq provider** (free-tier real LLM for reason + cross_check) | built | eval GATE PASSED with real Groq calls ✅ |
| **DEPLOY.md** — Neon + Render/Fly + Vercel runbook | written | ✅ |
| README · AGENTS.md · DEMO-SCRIPT.md | written | ✅ |

## Deploy-readiness pass (2026-07-01) — the standalone-deploy blocker is fixed
Found and fixed the one real gap before a cloud deploy: **the Dockerfiles only worked
under `docker-compose`'s volume mount** — a standalone image (as Render/Fly would build
it) had an empty `/data`, so the catalog seeded nothing and the RAG corpus was missing.
Fixed by moving the build context to the **repo root** for all three service
Dockerfiles (`COPY data /data` bakes the seed + corpus into the image itself);
`docker-compose.yml` updated to match. **Verified with zero volume mount**, against a
fresh standalone Postgres with no shared network from compose:
- catalog seeded **293 SKUs across 12 categories** into a brand-new Postgres instance;
- MCP served `reg_search`/`validate_item`/etc. with no data volume;
- agent ran a full plan (planted violation caught) using only baked-in data.

Also wired **Groq** (the same free-tier account used by CredAgent/FraudPulse) as a
real, $0 LLM tier between paid Anthropic/OpenAI and the deterministic heuristic. The
eval harness caught a real regression on the first pass — routing the *structured
Planner* through Groq's small free model (`llama-3.1-8b-instant`) dropped
`plan_completeness` to 94.47% (gate threshold 95%) because the model occasionally
omitted a category from the room breakdown. Fixed by keeping the Planner
deterministic (heuristic) and using Groq only for **compliance rationale** and the
**grounding cross-check** — both natural-language capabilities where its variance is
safe and still passes the hallucination gate. Re-ran: **GATE PASSED**, 6/6 metrics,
with genuine LLM calls in the loop, still $0.

Eval result (offline, dev mode): compliance recall **100%**, citation accuracy **100%**,
grounding **100%**, false-violation rate **0**, budget adherence **100%**. Report:
`eval/reports/latest.md`.

## Live Docker stack — verified end-to-end (2026-06-26)
Ran `docker compose up --build` on the WSL2 Docker engine. All 5 containers came up
(db healthy), and a full `/plan → /approve` round-trip was verified live:
- agent reports `catalog: remote` (uses the **C# service**, not the JSON fallback);
- catalog seeded **293 products** into **Postgres**, real GPO contract pricing returned
  (e.g. list $1,830.83 → DSSI-DIRECT $1,423.38);
- the agent made **4 real `reg_search` calls to the TS MCP server over HTTP**;
- planted **TRAP-NC-001 caught → 42 CFR §483.90(g)**, + 2 hallucination-gate abstentions;
- **approve → ORDERED**, order GUID persisted via the C# service.

**Five real bugs the Docker/Terraform round-trip caught (all fixed):**
1. `config.py` used `parents[3]` → `IndexError` in-container (app at `/app/app`). Fixed (safe fallback).
2. C# empty `ConnectionStrings:Catalog` in appsettings beat the `CATALOG_DB` env var → "Host can't be null". Fixed.
3. C# seeder didn't map snake_case JSON (`gpo_name`, `list_price`) → not-null violation + silent $0 prices. Fixed (SnakeCaseLower).
4. `.env.example` had inline comments; pydantic read the comment as the value → bad URL. Fixed (comments on own lines).
5. Added URL guards in the catalog/MCP clients (only treat `http(s)://…` as remote).

These were invisible to host runs — running the real Docker stack is exactly what exposed them.

## Enterprise hardening — all gaps closed (2026-06-26), verified on the live stack
Every yellow/red from the sanity check is now green:
- **Auth + RBAC** — JWT (HS256) + PBKDF2-SHA256; operator < approver < admin. `/approve`
  requires approver+, **independently re-validated by the C# service** (forwarded approver
  JWT on `place_order`). Console: login + role-gated approve + sign-out.
- **Multi-tenancy** — `tenant_id` in JWT/users/runs/audit; reads tenant-scoped; admin
  cross-tenant. Verified: cedarwood sees 1, maplewood sees 1, admin sees both.
- **Durable persistence** — `plan_runs` + append-only `audit_records` + `users` in Postgres.
- **EF migrations** — InitialCreate; `MigrateAsync` (not EnsureCreated).
- **Observability** — Prometheus `/metrics` (per-tenant/model counters), structured JSON
  logs, real Langfuse export when keyed, `/ready` vs `/health`.
- **Secrets** — `REQUIRE_STRONG_SECRETS` fail-fast; Terraform AWS Secrets Manager + ECS
  secret injection (`terraform validate` ✅).
- **Security/API** — headers, per-IP rate limit, configurable CORS, paginated search.
- **Tests in CI** — pytest 23 (+2 integration skipped), xUnit 4, vitest 6, eval gate,
  terraform validate.
- **WCAG 2.1 AA** — all console text ≥4.5:1 (verified in-browser).

## The demo works right now (no keys, no Docker)
```bash
cd services/agent-python && python -m app.cli --plant TRAP-NC-001   # caught -> §483.90(g)
python eval/harness.py                                              # GATE PASSED
cd web/console-ts && npm run dev                                    # clinical console
```
The console auto-falls back to an embedded sample if the agent isn't running, so it
always demos.

## What you need to do
1. **Confirm the interview date/format** — I built the full thing rather than the minimum
   cut since I couldn't ask. If it's soon, the offline path above is the safe demo.
2. **Install Docker Desktop + Terraform** to exercise the two ⚠️ items locally:
   `docker compose up --build`, then `cd infra && terraform init && terraform validate`.
   (Both are authored and should work; I just couldn't run them on this machine.)
3. **For the real model run:** put `ANTHROPIC_API_KEY` + `OPENAI_API_KEY` in `.env`,
   set `PROVIDER_MODE=demo`. A full run is pennies (Haiku routing keeps it tiny).
4. **Deploy (optional):** Neon (Postgres), Render/Fly (3 services), Vercel (console),
   Langfuse (tracing) — all free tiers; see `BUILD-PLAN.md §12b`. Push to GitHub to run CI.
5. **Rehearse** `DEMO-SCRIPT.md` — especially the planted-violation catch.

## Notes / honest caveats
- NFPA 101 text is **paraphrased** (copyrighted) and tied back to 42 CFR §483.90(a);
  the CFR chunks are verbatim and verified. Framing is honest in the README/demo.
- Langfuse wiring is stubbed via env (keys empty = no-op); cost/latency monitoring is
  fully implemented in-process and shown in the console regardless.
- The C# service uses a local catalog JSON fallback when not connected; in compose it
  talks to real Postgres via Npgsql.
- venv for the Python service lives on **D:** (`D:\sentinel-data\venvs\agent`) to spare C:.

First commit: `ee9ec83`. 80 files, no build artifacts leaked.
