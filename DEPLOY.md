# Sentinel — Deploy Runbook ($0 free tiers)

Everything below deploys the full polyglot stack for free: **Neon** (Postgres),
**Render** or **Fly.io** (the 3 backend services), **Vercel** (console). A demo run
against real models costs pennies (Anthropic/OpenAI new-account credit) — or run
entirely free on the **Groq** provider (real LLM, $0) or the heuristic fallback.

## 0. Before you start — the one thing that must be true
Every service Dockerfile now bakes `data/` (catalog seed + regulation corpus) into
the image at **repo-root build context**. If your platform builds from a
sub-directory by default, point it at the repo root and pass the explicit
Dockerfile path (see each service section below). Building from inside
`services/agent-python/` directly (`docker build .`) will **fail** — that's
intentional, so a misconfigured deploy fails at build time, not silently at runtime
with an empty catalog.

## 1. Database — Neon (Postgres + pgvector, free tier)
1. Create a project at neon.tech → note the connection string.
2. `pgvector` ships enabled on Neon by default; no extra setup needed.
3. You'll use this connection string twice: `DATABASE_URL` (agent, must include
   `?sslmode=require`) and `CATALOG_DB` in Npgsql format (catalog service).

## 2. Backend services — Render (or Fly.io)
Three services, each built from the **repo root** with an explicit Dockerfile path.

| Service | Dockerfile | Port | Health check |
|---|---|---|---|
| `sentinel-catalog` | `services/catalog-csharp/Dockerfile` | 8080 | `/health` |
| `sentinel-mcp` | `services/mcp-tools-ts/Dockerfile` | 7100 | `/health` |
| `sentinel-agent` | `services/agent-python/Dockerfile` | 8000 | `/health` |

**Render (Web Service, per service):**
- Repo: this GitHub repo · **Root Directory: leave blank (repo root)**
- Build: Docker · **Dockerfile Path:** the path from the table above
- Environment variables: copy from `.env.production.example`, filled in for real
  (generate `JWT_SECRET`, point `DATABASE_URL`/`CATALOG_DB` at Neon)
- Deploy `catalog` and `mcp` first, copy their public Render URLs, then set
  `CATALOG_URL` / `MCP_URL` on the `agent` service before deploying it.

**Fly.io equivalent:** `fly launch --dockerfile services/<x>/Dockerfile` from the
repo root for each service; `fly secrets set` for the env vars.

## 3. Console — Vercel
- Import the repo, set **Root Directory: `web/console-ts`**.
- Build command / output: defaults (Vite) are correct.
- Environment variable (Project Settings → Environment Variables, **not** a runtime
  `.env` — Vite bakes it in at build time): `VITE_AGENT_URL=https://<your-agent-url>`
- Deploy. The console falls back to an embedded sample if the agent is unreachable,
  so a misconfigured `VITE_AGENT_URL` degrades gracefully rather than showing a blank page.

## 4. Generate the required secrets
```bash
# JWT signing secret — same value on BOTH the agent and catalog services
python -c "import secrets; print(secrets.token_urlsafe(48))"
```
```bash
# Override the seeded demo users before a PUBLIC deploy (the default
# operator/approver/admin passwords are in this public repo)
cd services/agent-python
python -c "from app.auth import hash_password; print(hash_password('a-real-password'))"
# then set SENTINEL_AUTH_USERS as one line of JSON on the agent service, e.g.:
# [{"email":"you@company.com","name":"Your Name","role":"admin","tenant_id":"cedarwood","facility":"Cedarwood Senior Living","password_hash":"pbkdf2_sha256$..."}]
```

## 5. Set `REQUIRE_STRONG_SECRETS=true` on the agent service
This makes the agent **refuse to start** if `JWT_SECRET` is still the default or
`CORS_ORIGINS` is still `*` — a misconfigured production deploy fails loudly at
startup instead of running insecurely. Set `CORS_ORIGINS` to your exact Vercel URL.

## 6. Model provider for the deploy
Pick one (`PROVIDER_MODE` + keys on the agent service):
- **`demo` + ANTHROPIC_API_KEY + OPENAI_API_KEY** — the real interview-grade run
  (Opus reasoning, Haiku routing, OpenAI grounding cross-check). Costs pennies.
- **`auto` + GROQ_API_KEY only** — genuine LLM reasoning, **$0** (Groq free tier).
  This is the safe default for a public/always-on demo deploy.
- **no keys** — deterministic heuristic provider, $0, still fully functional
  (all compliance rules, citations, and the eval gate work; just no free-text LLM
  reasoning).

## 7. Verify the live deploy
```bash
curl https://<agent-url>/health
# expect: "catalog":"remote", "persistence":"postgres", "auth":"jwt+rbac"
curl https://<agent-url>/metrics       # Prometheus scrape target
curl https://<agent-url>/ready         # 200 once Postgres is reachable
```
Log in at the Vercel console URL with the demo accounts (or your overridden
`SENTINEL_AUTH_USERS`) and run the planted-violation scenario end-to-end.

## 8. CI/CD (optional, already wired)
`.github/workflows/ci.yml` builds all services, runs pytest/xUnit/vitest, and
gates on the eval harness (`eval/harness.py`) before pushing images to `ghcr.io`.
Point Render/Fly's auto-deploy at the `ghcr.io` images if you want push-to-deploy.

## Rollback / local fallback
`docker compose up --build` always works as the offline/local fallback — it uses
the same Dockerfiles (repo-root context) plus a local Postgres, so it's a faithful
mirror of the cloud deploy minus Neon/Render/Vercel.
