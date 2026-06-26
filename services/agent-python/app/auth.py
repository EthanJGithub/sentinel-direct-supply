"""Authentication + role-based access control for the agent API.

- Passwords hashed with PBKDF2-HMAC-SHA256 (stdlib; salted, 200k iterations).
- Stateless JWT (HS256) bearer tokens.
- Roles: operator (run plans) < approver (place orders / HITL) < admin (all).
  The approver gate is the meaningful one — in a regulated procurement workflow,
  only an authorized approver may commit an order, which maps directly to the
  human-in-the-loop checkpoint.

Runs $0/offline: a default demo user set is seeded in-memory; with DATABASE_URL a
`users` table is created/seeded and used instead. JWT secret + users overridable
via env (JWT_SECRET, SENTINEL_AUTH_USERS).
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import time
from dataclasses import dataclass
from typing import Optional

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import get_settings

ROLE_RANK = {"operator": 1, "approver": 2, "admin": 3}
PBKDF2_ITERATIONS = 200_000


# ---------------------------------------------------------------------------
# password hashing (stdlib)
# ---------------------------------------------------------------------------
def hash_password(password: str, *, salt: Optional[bytes] = None) -> str:
    salt = salt or secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iters, salt_hex, hash_hex = stored.split("$")
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(iters))
        return hmac.compare_digest(dk.hex(), hash_hex)
    except Exception:
        return False


# ---------------------------------------------------------------------------
# user store
# ---------------------------------------------------------------------------
@dataclass
class User:
    email: str
    name: str
    role: str
    facility: str = "Cedarwood Senior Living"

    def public(self) -> dict:
        return {"email": self.email, "name": self.name, "role": self.role, "facility": self.facility}


# Demo accounts (documented in README / shown on the login screen). Override with
# SENTINEL_AUTH_USERS='[{"email","name","role","password"}]' in production.
DEFAULT_USERS = [
    {"email": "operator@cedarwood.health", "name": "Dana Ops", "role": "operator", "password": "Operator!2026"},
    {"email": "approver@cedarwood.health", "name": "Avery Approver", "role": "approver", "password": "Approver!2026"},
    {"email": "admin@sentinel.io", "name": "Sentinel Admin", "role": "admin", "password": "Admin!2026"},
]


class UserStore:
    def __init__(self):
        raw = os.getenv("SENTINEL_AUTH_USERS")
        seed = json.loads(raw) if raw else DEFAULT_USERS
        self._users: dict[str, dict] = {}
        for u in seed:
            self._users[u["email"].lower()] = {
                "email": u["email"], "name": u["name"], "role": u["role"],
                "facility": u.get("facility", "Cedarwood Senior Living"),
                "password_hash": u.get("password_hash") or hash_password(u["password"]),
            }
        # best-effort durable users table (does not break offline runs)
        self._sync_db()

    def _sync_db(self) -> None:
        from .persistence import get_store
        store = get_store()
        if not store.enabled:
            return
        try:
            store.ensure_users(list(self._users.values()))
            for row in store.load_users():
                self._users[row["email"].lower()] = row
        except Exception:
            pass  # offline / db hiccup -> in-memory users still work

    def get(self, email: str) -> Optional[dict]:
        return self._users.get(email.lower())

    def authenticate(self, email: str, password: str) -> Optional[User]:
        rec = self.get(email)
        if not rec or not verify_password(password, rec["password_hash"]):
            return None
        return User(email=rec["email"], name=rec["name"], role=rec["role"], facility=rec["facility"])


_store: Optional[UserStore] = None


def get_user_store() -> UserStore:
    global _store
    if _store is None:
        _store = UserStore()
    return _store


# ---------------------------------------------------------------------------
# JWT
# ---------------------------------------------------------------------------
def create_token(user: User) -> str:
    s = get_settings()
    now = int(time.time())
    payload = {"sub": user.email, "name": user.name, "role": user.role,
               "facility": user.facility, "iat": now, "exp": now + s.jwt_ttl_seconds}
    return jwt.encode(payload, s.jwt_secret, algorithm="HS256")


def decode_token(token: str) -> dict:
    s = get_settings()
    return jwt.decode(token, s.jwt_secret, algorithms=["HS256"])


# ---------------------------------------------------------------------------
# FastAPI dependencies
# ---------------------------------------------------------------------------
_bearer = HTTPBearer(auto_error=False)


def _user_from_token(token: str) -> User:
    try:
        claims = decode_token(token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "token expired")
    except Exception:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid token")
    return User(email=claims["sub"], name=claims.get("name", ""), role=claims.get("role", "operator"),
                facility=claims.get("facility", ""))


def current_user(creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer)) -> User:
    if creds is None or not creds.credentials:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing bearer token")
    return _user_from_token(creds.credentials)


def require_role(*roles: str):
    """Dependency factory: caller must hold one of `roles` (or higher rank)."""
    min_rank = min(ROLE_RANK[r] for r in roles)

    def dep(user: User = Depends(current_user)) -> User:
        if ROLE_RANK.get(user.role, 0) < min_rank:
            raise HTTPException(status.HTTP_403_FORBIDDEN,
                                f"role '{user.role}' lacks permission (requires {'/'.join(roles)}+)")
        return user

    return dep


def user_from_ws_token(token: Optional[str]) -> User:
    """WebSocket auth (browsers can't set headers on WS) — token via first message/query."""
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing token")
    return _user_from_token(token)
