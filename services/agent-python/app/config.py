"""Central configuration. Everything degrades gracefully: with no keys / no DB /
no peer services, the graph still runs on the heuristic provider + local RAG +
catalog-JSON fallback, so the demo and eval harness work fully offline."""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# repo root = .../sentinel-direct-supply on the host; in a container the app lives at
# /app/app so the 4-levels-up path doesn't exist — fall back safely (DATA_DIR is set there).
_PARENTS = Path(__file__).resolve().parents
REPO_ROOT = _PARENTS[3] if len(_PARENTS) > 3 else _PARENTS[-1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # --- provider routing ---
    # provider mode: "auto" uses real keys when present else heuristic; "demo" forces real;
    # "dev" forces free/heuristic (preserve credits while iterating).
    provider_mode: str = os.getenv("PROVIDER_MODE", "auto")
    anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    groq_api_key: str = os.getenv("GROQ_API_KEY", "")

    # model ids (latest Claude family per Anthropic guidance)
    model_reason: str = os.getenv("MODEL_REASON", "claude-opus-4-8")
    model_route: str = os.getenv("MODEL_ROUTE", "claude-haiku-4-5-20251001")
    model_embed: str = os.getenv("MODEL_EMBED", "text-embedding-3-small")

    # --- peer services ---
    catalog_url: str = os.getenv("CATALOG_URL", "")          # C# service; empty -> JSON fallback
    mcp_url: str = os.getenv("MCP_URL", "")                   # TS MCP server; empty -> in-proc tools
    database_url: str = os.getenv("DATABASE_URL", "")         # Postgres; empty -> in-memory audit/RAG

    # --- observability ---
    langfuse_public_key: str = os.getenv("LANGFUSE_PUBLIC_KEY", "")
    langfuse_secret_key: str = os.getenv("LANGFUSE_SECRET_KEY", "")
    langfuse_host: str = os.getenv("LANGFUSE_HOST", "https://cloud.langfuse.com")

    # --- guardrails ---
    per_request_cost_ceiling_usd: float = float(os.getenv("COST_CEILING_USD", "0.50"))

    # --- auth ---
    jwt_secret: str = os.getenv("JWT_SECRET", "dev-secret-change-me-in-prod")
    jwt_ttl_seconds: int = int(os.getenv("JWT_TTL_SECONDS", "28800"))  # 8h
    cors_origins: str = os.getenv("CORS_ORIGINS", "*")
    rate_limit_per_min: int = int(os.getenv("RATE_LIMIT_PER_MIN", "120"))

    # --- data paths (DATA_DIR overrides for containers where data is mounted at /data) ---
    data_dir: Path = Path(os.getenv("DATA_DIR", str(REPO_ROOT / "data")))

    @property
    def catalog_json(self) -> Path:
        return self.data_dir / "catalog" / "catalog.json"

    @property
    def contracts_json(self) -> Path:
        return self.data_dir / "catalog" / "contracts.json"

    @property
    def rules_json(self) -> Path:
        return self.data_dir / "catalog" / "compliance_rules.json"

    @property
    def regulations_jsonl(self) -> Path:
        return self.data_dir / "regulations" / "regulations.jsonl"

    @property
    def has_anthropic(self) -> bool:
        return bool(self.anthropic_api_key) and self.provider_mode != "dev"

    @property
    def has_openai(self) -> bool:
        return bool(self.openai_api_key) and self.provider_mode != "dev"


@lru_cache
def get_settings() -> Settings:
    return Settings()
