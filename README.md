# Sentinel — Agentic Procurement & Compliance Copilot for Senior Care

> A facility manager says *"Open a 30-bed memory-care wing in 60 days, equip it within
> $480K, compliant with CMS Life-Safety."* Sentinel decomposes the request, sources
> equipment through a C# system-of-record, validates **every item against real CMS /
> NFPA regulation with citations**, keeps it in budget, and produces an auditable plan
> for human approval — wrapped in the eval harness + cost/latency monitoring you'd need
> to actually **operate** it in production.

Built for the **Direct Supply — AI Engineer** interview on Direct Supply's exact stack.
It fuses their three product lines — **DSSI** (sourcing/contracts), **TELS** (compliance),
**Attainia** (capital-equipment planning) — and is the same multi-agent + RAG-over-policy
+ audit architecture shipped in production for credit underwriting (CredAgent).

![Sentinel console](docs/img/console.png)

## Why it maps to the role
| JD asks for | Sentinel answer |
|---|---|
| Python, C#, TypeScript, PostgreSQL | LangGraph agent (Py) · catalog service (C#) · MCP tools + React console (TS) · one Postgres |
| Anthropic + OpenAI | Claude Opus (compliance reasoning) + Haiku (routing) · OpenAI embeddings + grounding cross-check |
| Docker, Terraform, AWS | every service Dockerized · `docker compose up` · Terraform → ECS/RDS/S3/ECR/CloudWatch |
| "operate… evaluation, cost, performance" | eval harness (compliance recall, grounding rate) + per-node cost/latency + per-request cost ceiling |
| "legible to agents / drive tooling" | MCP tool server + typed schemas (Pydantic/Zod/C# DTOs) + [`AGENTS.md`](AGENTS.md) |
| "integrate AI into existing products" | the agent works **through** the C# system-of-record, not a greenfield toy |
| healthcare / regulated data | RAG over **42 CFR §483.90 / CMS Appendix PP / NFPA 101** + an immutable audit trail |

## The architecture
```
 TypeScript  React/Vite console ──REST/WebSocket──▶ Python  FastAPI + LangGraph
   (plan · live trace · compliance · monitoring · HITL)     Planner→Sourcing→Compliance→Budget→Audit
                                                              │ MCP            │ HTTP
                                          TypeScript MCP tools ◀┘    C# ASP.NET Core catalog ◀┘
                                          reg_search·validate_item    catalog·contracts·orders
                                                     └──────── PostgreSQL + pgvector ────────┘
        Docker (every service) · Terraform → AWS (ECS Fargate ×3 · RDS · S3 · ECR · CloudWatch)
```
Eight in-depth diagrams in [`ARCHITECTURE-DIAGRAMS.md`](ARCHITECTURE-DIAGRAMS.md); full
spec in [`BUILD-PLAN.md`](BUILD-PLAN.md).

## The trust mechanism — citation-or-abstain
Every compliance claim is grounded in retrieved regulation text, **or the agent abstains**:
- deterministic attribute rules → grounded by construction (cite a real chunk);
- RAG verdicts pass a **hallucination gate** (the claim must be supported by the quote);
- nothing relevant retrieved → **ABSTAIN**, flagged for human review. No citation is invented.

The demo's wow moment: **plant a non-compliant item and watch the Compliance Agent catch
it with a citation while the gate blocks an ungrounded claim.**

## Quickstart

### Full stack (Docker)
```bash
cp .env.example .env          # optional: add ANTHROPIC_API_KEY / OPENAI_API_KEY for the real run
docker compose up --build      # console → http://localhost:5173
```

### No Docker? Everything runs offline, $0, no keys
```bash
# 1) seed data
python data/scripts/generate_catalog.py
# 2) agent graph end-to-end (heuristic provider + local keyword RAG)
cd services/agent-python && pip install -r requirements.txt
python -m app.cli --plant TRAP-NC-001        # watch the violation get caught with §483.90(g)
# 3) eval gate
cd ../.. && python eval/harness.py            # compliance recall / grounding / budget / cost
# 4) MCP tools
cd services/mcp-tools-ts && npm install && npm test
# 5) console
cd ../../web/console-ts && npm install && npm run dev   # http://localhost:5173
```

## The "operate" layer (the differentiator)
- **Eval harness** (`eval/harness.py`) — 12 golden scenarios with planted violations.
  Latest report: [`eval/reports/latest.md`](eval/reports/latest.md). Gate enforces
  compliance recall = 100%, grounding ≥ 95%, **zero false-violations**, budget adherence = 100%.
- **Cost + latency monitoring** — per-node latency, per-model token cost, tool success
  rate, and a **per-request cost ceiling**, surfaced in the console and (in AWS) CloudWatch.
- **Eval-gated CI** (`.github/workflows/ci.yml`) — a regression in compliance recall
  **blocks the deploy**.
- **Model routing** — Haiku for routing/extraction, Opus for compliance reasoning,
  OpenAI for an independent grounding cross-check; free/heuristic fallback for dev/eval.

## Enterprise hardening
Beyond the demo, Sentinel ships the production-shaping pieces:
- **Auth + RBAC** — JWT bearer tokens (HS256), PBKDF2-SHA256 password hashing, three
  roles (`operator` < `approver` < `admin`). The **approver gate is the regulated
  human-in-the-loop control**: only an approver/admin may place an order — enforced in
  the API (`/approve` → 403 otherwise) *and* reflected in the UI. Demo accounts are on
  the login screen.
- **Durable persistence** — plan runs and an **append-only audit trail** are written to
  Postgres (`plan_runs`, `audit_records`), surviving restarts; falls back to in-memory offline.
- **Schema migrations** — the C# service is **EF-migration-managed** (not `EnsureCreated`).
- **API hardening** — security headers, per-IP rate limiting, configurable CORS, typed
  schema validation end-to-end.
- **Tests** — a `pytest` suite (19 tests: compliance rules, citation-or-abstain, graph
  e2e, RBAC) plus the MCP tool self-test, both run in CI alongside the eval gate.

## Data — real, honestly framed
- **42 CFR §483.90** (Physical Environment) — verbatim subsections, verified against eCFR.
- **CMS State Operations Manual, Appendix PP** — F-tag interpretive guidance (e.g. F921 71–81°F).
- **NFPA 101 (2012)** — Life-Safety references (corridor width, egress door, smoke compartments),
  paraphrased (the code is copyrighted) and tied back to §483.90(a).
- **Catalog** — a representative ~290-SKU senior-care set with synthesized GPO pricing.

> Honest framing: a prototype on public CMS data + a representative catalog. The edge is
> the architecture, the full-stack execution, and the operate story. With Direct Supply's
> real DSSI catalog/contracts and the licensed NFPA text, this gets far richer.

## Repo layout
```
services/catalog-csharp/   ASP.NET Core + EF Core  (system of record)
services/agent-python/     FastAPI + LangGraph + provider abstraction + eval-ready runner
services/mcp-tools-ts/     MCP tool server (stdio + HTTP), Zod schemas
web/console-ts/            React/Vite clinical operator console
eval/                      golden scenarios + harness + reports
data/                      catalog seed + regulation corpus + download scripts (cache → D:)
infra/                     Terraform (ECS/RDS/S3/ECR/CloudWatch, LocalStack-friendly)
docker-compose.yml · AGENTS.md · BUILD-PLAN.md · ARCHITECTURE-DIAGRAMS.md
```

— Ethan Jones · built on free tiers ($0) · [AGENTS.md](AGENTS.md) for the tool/schema contract.
