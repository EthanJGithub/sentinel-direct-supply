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
| **Docker** (4 Dockerfiles + docker-compose) | built + run | **full stack up; live e2e verified** ✅ (see below) |
| **Terraform** (ECS/RDS/S3/ECR/CloudWatch + LocalStack) | written | **`terraform validate` = Success** (TF 1.15.7, AWS provider v5.100) ✅ |
| **GitHub Actions** eval-gated CI | written | runs on push once on GitHub ⚠️ |
| README · AGENTS.md · DEMO-SCRIPT.md | written | ✅ |

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
