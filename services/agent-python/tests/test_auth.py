"""Auth + RBAC unit tests."""
import pytest

from app.auth import (ROLE_RANK, User, create_token, decode_token,
                      get_user_store, hash_password, verify_password)


def test_password_hash_roundtrip():
    h = hash_password("Operator!2026")
    assert h.startswith("pbkdf2_sha256$")
    assert verify_password("Operator!2026", h)
    assert not verify_password("wrong", h)


def test_hash_is_salted():
    assert hash_password("same") != hash_password("same")  # random salt


@pytest.mark.parametrize("email,pw,role", [
    ("operator@cedarwood.health", "Operator!2026", "operator"),
    ("approver@cedarwood.health", "Approver!2026", "approver"),
    ("admin@sentinel.io", "Admin!2026", "admin"),
])
def test_default_users_authenticate(email, pw, role):
    u = get_user_store().authenticate(email, pw)
    assert u is not None and u.role == role


def test_bad_password_rejected():
    assert get_user_store().authenticate("operator@cedarwood.health", "nope") is None
    assert get_user_store().authenticate("ghost@nowhere.io", "x") is None


def test_token_roundtrip_preserves_role():
    u = User(email="a@b.c", name="A", role="approver")
    claims = decode_token(create_token(u))
    assert claims["sub"] == "a@b.c" and claims["role"] == "approver"


def test_role_rank_ordering():
    assert ROLE_RANK["operator"] < ROLE_RANK["approver"] < ROLE_RANK["admin"]
