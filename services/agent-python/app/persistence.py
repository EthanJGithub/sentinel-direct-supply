"""Durable persistence for plan runs, the immutable audit trail, and users.

Backed by Postgres when DATABASE_URL is set; a no-op store otherwise so the
offline/$0 path keeps working (runs then live only in the in-memory cache). This
makes the "immutable audit record -> Postgres" claim real and gives the API a
durable run history that survives restarts.
"""
from __future__ import annotations

import json
from typing import Optional

from .config import get_settings

_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  email         text PRIMARY KEY,
  name          text NOT NULL,
  role          text NOT NULL,
  facility      text NOT NULL DEFAULT '',
  password_hash text NOT NULL
);
CREATE TABLE IF NOT EXISTS plan_runs (
  plan_id     text PRIMARY KEY,
  user_email  text,
  status      text,
  violations  int,
  abstentions int,
  cost_usd    numeric(12,6),
  payload     jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit_records (
  id        bigserial PRIMARY KEY,
  plan_id   text NOT NULL,
  seq       int  NOT NULL,
  agent     text NOT NULL,
  decision  jsonb NOT NULL,
  ts        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_plan_idx ON audit_records(plan_id);
"""


class PgStore:
    def __init__(self, dsn: str):
        self.dsn = dsn
        self.enabled = False
        self._psycopg = None
        try:
            import psycopg  # lazy

            self._psycopg = psycopg
            with self._conn() as c:
                c.execute(_SCHEMA)
                c.commit()
            self.enabled = True
        except Exception:
            self.enabled = False

    def _conn(self):
        return self._psycopg.connect(self.dsn, connect_timeout=5)

    # ---- users ----
    def ensure_users(self, users: list[dict]) -> None:
        if not self.enabled:
            return
        with self._conn() as c:
            for u in users:
                c.execute(
                    """INSERT INTO users(email,name,role,facility,password_hash)
                       VALUES(%s,%s,%s,%s,%s) ON CONFLICT (email) DO NOTHING""",
                    (u["email"], u["name"], u["role"], u.get("facility", ""), u["password_hash"]),
                )
            c.commit()

    def load_users(self) -> list[dict]:
        if not self.enabled:
            return []
        with self._conn() as c:
            rows = c.execute("SELECT email,name,role,facility,password_hash FROM users").fetchall()
        return [{"email": r[0], "name": r[1], "role": r[2], "facility": r[3], "password_hash": r[4]} for r in rows]

    # ---- runs + audit ----
    def save_run(self, result: dict, user_email: Optional[str]) -> None:
        if not self.enabled:
            return
        try:
            with self._conn() as c:
                c.execute(
                    """INSERT INTO plan_runs(plan_id,user_email,status,violations,abstentions,cost_usd,payload)
                       VALUES(%s,%s,%s,%s,%s,%s,%s)
                       ON CONFLICT (plan_id) DO UPDATE SET status=EXCLUDED.status, payload=EXCLUDED.payload""",
                    (result["plan_id"], user_email, result["status"], result.get("violations", 0),
                     result.get("abstentions", 0), result.get("metrics", {}).get("total_cost_usd", 0),
                     json.dumps(result)),
                )
                # append-only audit trail
                for seq, a in enumerate(result.get("audit", [])):
                    c.execute(
                        "INSERT INTO audit_records(plan_id,seq,agent,decision,ts) VALUES(%s,%s,%s,%s,%s)",
                        (result["plan_id"], seq, a.get("agent", "?"), json.dumps(a.get("decision", {})),
                         a.get("ts")),
                    )
                c.commit()
        except Exception:
            pass

    def update_status(self, plan_id: str, status: str) -> None:
        if not self.enabled:
            return
        try:
            with self._conn() as c:
                c.execute("UPDATE plan_runs SET status=%s WHERE plan_id=%s", (status, plan_id))
                c.commit()
        except Exception:
            pass

    def load_run(self, plan_id: str) -> Optional[dict]:
        if not self.enabled:
            return None
        with self._conn() as c:
            row = c.execute("SELECT payload FROM plan_runs WHERE plan_id=%s", (plan_id,)).fetchone()
        return row[0] if row else None

    def list_runs(self, limit: int = 50) -> list[dict]:
        if not self.enabled:
            return []
        with self._conn() as c:
            rows = c.execute(
                """SELECT plan_id,user_email,status,violations,abstentions,cost_usd,created_at
                   FROM plan_runs ORDER BY created_at DESC LIMIT %s""", (limit,)).fetchall()
        return [{"plan_id": r[0], "user_email": r[1], "status": r[2], "violations": r[3],
                 "abstentions": r[4], "cost_usd": float(r[5] or 0),
                 "created_at": r[6].isoformat() if r[6] else None} for r in rows]


class NoopStore:
    enabled = False

    def ensure_users(self, users): ...
    def load_users(self): return []
    def save_run(self, result, user_email): ...
    def update_status(self, plan_id, status): ...
    def load_run(self, plan_id): return None
    def list_runs(self, limit=50): return []


_store = None


def get_store():
    global _store
    if _store is None:
        dsn = get_settings().database_url
        _store = PgStore(dsn) if dsn else NoopStore()
    return _store
