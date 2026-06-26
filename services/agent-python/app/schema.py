"""Typed, schema-validated I/O end-to-end (Pydantic side; Zod mirrors it in the
MCP server, C# DTOs mirror it in the catalog service)."""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Request / plan inputs
# ---------------------------------------------------------------------------
class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: dict


class PlanRequest(BaseModel):
    request: str = Field(..., description="Natural-language procurement request")
    facility_name: str = "Cedarwood Senior Living"
    state: str = "NC"
    care_type: str = "memory_care"
    budget_usd: float = 480_000
    contract_id: Optional[str] = "DSSI-DIRECT"
    # demo hook: inject a known non-compliant SKU into the cart to exercise the gate
    plant_violation_sku: Optional[str] = None


# ---------------------------------------------------------------------------
# Procurement spec (Planner output)
# ---------------------------------------------------------------------------
class RoomSpec(BaseModel):
    room_type: str                 # resident_room | bathroom | corridor | common_area | nursing_station
    count: int
    categories: list[str]          # equipment categories needed


class ProcurementSpec(BaseModel):
    summary: str
    rooms: list[RoomSpec]
    constraints: list[str] = []
    budget_usd: float


# ---------------------------------------------------------------------------
# Cart (Sourcing output)
# ---------------------------------------------------------------------------
class CartLine(BaseModel):
    sku: str
    name: str
    category: str
    subcategory: str = ""
    room_type: str
    qty: int
    unit_price: float
    list_price: float = 0.0
    contract_id: Optional[str] = None
    attributes: dict[str, Any] = {}

    @property
    def line_cost(self) -> float:
        return round(self.unit_price * self.qty, 2)


# ---------------------------------------------------------------------------
# Compliance (Compliance output)
# ---------------------------------------------------------------------------
class Citation(BaseModel):
    reg_id: str
    source: str
    citation: str
    quote: str                     # the retrieved reg text the verdict is grounded in
    score: float = 0.0


Verdict = Literal["PASS", "VIOLATION", "ABSTAIN"]


class ComplianceFinding(BaseModel):
    sku: str
    name: str
    room_type: str
    verdict: Verdict
    rule_id: Optional[str] = None
    rationale: str
    citations: list[Citation] = []
    grounded: bool = False         # did the claim quote retrieved reg text?
    gate_blocked: bool = False     # hallucination gate downgraded this to ABSTAIN
    recommended_substitution: Optional[dict] = None  # compliant alternative for a VIOLATION


# ---------------------------------------------------------------------------
# Budget (Budget output)
# ---------------------------------------------------------------------------
class BudgetReport(BaseModel):
    budget_usd: float
    subtotal_usd: float
    savings_vs_list_usd: float
    within_budget: bool
    swaps: list[dict[str, Any]] = []


# ---------------------------------------------------------------------------
# Audit + trace
# ---------------------------------------------------------------------------
class AuditEntry(BaseModel):
    agent: str
    decision: dict[str, Any]
    ts: str


class TraceEvent(BaseModel):
    node: str
    event: str                     # start | end | tool | model | gate
    detail: str = ""
    model: Optional[str] = None
    tokens_in: int = 0
    tokens_out: int = 0
    cost_usd: float = 0.0
    latency_ms: float = 0.0


class PlanResult(BaseModel):
    plan_id: str
    status: str                    # AWAITING_APPROVAL | APPROVED | REJECTED | ORDERED
    spec: Optional[ProcurementSpec] = None
    cart: list[CartLine] = []
    findings: list[ComplianceFinding] = []
    budget: Optional[BudgetReport] = None
    audit: list[AuditEntry] = []
    trace: list[TraceEvent] = []
    metrics: dict[str, Any] = {}
    abstentions: int = 0
    violations: int = 0
