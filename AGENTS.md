# AGENTS.md — making Sentinel legible to agents (and developers)

Direct Supply's JD asks for "code bases that are **legible to agents** and other
developers." This file is the contract: every tool, schema, and service boundary an
agent (or a new engineer) needs, in one place. Typed I/O is enforced in all three
languages — **Pydantic** (Python), **Zod** (TypeScript MCP), **C# DTOs** (catalog).

## System map
```
console-ts ──REST/WS──▶ agent-python ──HTTP──▶ catalog-csharp ──▶ Postgres
   (TS)                  (LangGraph)   ──MCP──▶ mcp-tools-ts  ──▶ reg corpus / pgvector
```

## The agent graph (services/agent-python/app/agents/graph.py)
Nodes run in order with two re-source loops and an HITL stop:
1. **Planner** — NL request → `ProcurementSpec` (rooms, categories, constraints).
2. **Sourcing** — `catalog_search`, `get_contract_price`, `find_substitution` (C# service).
3. **Compliance** — `reg_search`, `validate_item` (MCP). **citation-or-abstain + hallucination gate.**
4. **Budget** — `cost_calc`; swaps items to hit budget (re-source loop).
5. **Audit** — immutable decision record → `status = AWAITING_APPROVAL`.
6. **HITL** — operator approves → C# `place_order` (violating lines excluded).

State shape: `services/agent-python/app/agents/graph.py::GState`.
Result shape: `services/agent-python/app/schema.py::PlanResult`.

## Tools (the agent-legible surface)

### MCP tool server — `services/mcp-tools-ts` (Zod schemas in `src/schemas.ts`)
| Tool | Input | Output |
|---|---|---|
| `reg_search` | `{query, categories?, k?}` | `{results: Citation[]}` |
| `validate_item` | `{name, category, subcategory?, room_type, attributes}` | `{verdict, rule_id, citation, rationale, grounded}` |
| `validate_layout` | `{room_type, occupancy, area_sqft?, corridor_clear_width_in?, beds_per_smoke_compartment?, has_window?, direct_exit_access?}` | `{findings[], violations}` |
| `cost_calc` | `{lines:[{unit_price, qty}], budget}` | `{subtotal, within_budget, over_by, headroom}` |

Run as MCP stdio (`npm run mcp`) or HTTP (`npm run http`, `POST /tools/:name`).
`verdict ∈ {PASS, VIOLATION, ABSTAIN}`. A verdict is only asserted when grounded in a
retrieved reg chunk; otherwise the tool **abstains**.

### Auth & RBAC — `services/agent-python/app/auth.py`
JWT bearer (HS256) + PBKDF2-SHA256 passwords. Roles: `operator` < `approver` < `admin`.
| Endpoint | Access |
|---|---|
| `POST /auth/login` | public → `{access_token, user}` |
| `GET /auth/me` | any authenticated |
| `POST /plan`, `WS /ws/plan` | operator+ |
| `POST /approve/{id}` | **approver+** (the regulated HITL gate) |
| `GET /runs`, `/runs/{id}` | any authenticated |
WS auth: token via `?token=` query (browsers can't set WS headers). Demo accounts are
on the login screen / in `.env.example`. Runs durably persist to Postgres
(`app/persistence.py`: `plan_runs` + append-only `audit_records`) when `DATABASE_URL` is set.

**Multi-tenancy:** every JWT/run/audit row carries `tenant_id`; reads are tenant-scoped
(`_scope(user)` in `main.py`), `admin` (tenant `*`) is cross-tenant.
**Observability:** `GET /metrics` (Prometheus), `GET /ready` (readiness), structured JSON
logs, Langfuse export when keyed — `app/observability.py`.
**C# service auth:** `POST /api/orders` requires an approver/admin JWT (policy
`CanPlaceOrder`, shared `JWT_SECRET`); the agent forwards the approver's token on approval.

### Catalog & contract service — `services/catalog-csharp` (system of record)
| Endpoint | Purpose |
|---|---|
| `GET /api/catalog/search?query&category&room&limit` | catalog_search |
| `GET /api/catalog/{sku}` | item detail + best contract price |
| `POST /api/contract/price {skus[], contractId}` | get_contract_price |
| `GET /api/catalog/{sku}/substitutions` | find_substitution (compliant alternatives) |
| `GET /api/stock/{sku}` | check_stock |
| `POST /api/orders {planId, facilityName, lines[]}` | place_order (HITL-approved) |

## Compliance rules — `data/catalog/compliance_rules.json`
Each rule maps a product attribute predicate to a **real regulation id** in
`data/regulations/regulations.jsonl`. A *missing* attribute is "not assessable"
(never a false positive); only explicit non-compliant values raise a VIOLATION.
Rule engine: `services/agent-python/app/compliance.py` (mirrored in `mcp-tools-ts/src/tools.ts`).

## Citation-or-abstain + hallucination gate (the trust mechanism)
- Rule-based verdicts are grounded **by construction** (the rule cites a real chunk).
- RAG-based verdicts must clear the grounding gate; if the retrieved reg doesn't
  support the claim → **ABSTAIN** (`gate_blocked = true`), flagged for human review.
- Nothing relevant retrieved above threshold → **ABSTAIN** (no citation invented).

## Provider routing — `services/agent-python/app/providers/router.py`
Capabilities, not vendors: `plan_spec` (Haiku) · `compliance_rationale` (Opus) ·
`grounding_check` (OpenAI cross-check). Three-tier fallback per capability:
**Anthropic/OpenAI (paid, real)** → **Groq (`GROQ_API_KEY`, free tier, real LLM, $0)**
→ **deterministic heuristic** ($0, offline). No keys / `PROVIDER_MODE=dev` → heuristic.

**Why Planner doesn't use Groq:** the eval harness caught a real regression when the
structured procurement spec was routed through Groq's small free model
(`llama-3.1-8b-instant`) — it occasionally dropped a category from the room
breakdown, lowering `plan_completeness` below the eval gate. Structured planning
needs guaranteed category coverage, so it stays on the deterministic heuristic
unless Anthropic is configured; Groq is used only for `compliance_rationale` and
`grounding_check`, where natural-language variance is safe (both are still enforced
by the hallucination gate). Cost + latency tracked per node/model in `monitoring.py`.

## Run it / change it
- Offline graph: `cd services/agent-python && python -m app.cli --plant TRAP-NC-001`
- MCP tool tests: `cd services/mcp-tools-ts && npm test`
- Eval gate: `python eval/harness.py`
- Full stack: `docker compose up --build`

To add a rule: append to `compliance_rules.json` (+ a chunk in `regulations.jsonl`),
then `python eval/harness.py` to confirm recall holds. To add a tool: add a Zod schema
in `mcp-tools-ts/src/schemas.ts` and a handler in `tools.ts` — it's exposed on both the
MCP and HTTP surfaces automatically.
