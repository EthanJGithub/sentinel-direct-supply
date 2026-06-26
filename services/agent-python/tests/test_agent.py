"""Agent graph + compliance engine tests (run $0/offline on the heuristic path)."""
import pytest

from app.compliance import evaluate_item_rules, load_rules
from app.config import get_settings
from app.runner import run_plan
from app.schema import PlanRequest

RULES = load_rules(get_settings())

TRAPS = [
    ("TRAP-NC-001", "483.90(g)"),   # call-system coverage
    ("TRAP-NC-002", "18.2.3.6"),    # egress door width
    ("TRAP-NC-003", "Entrapment"),  # bed entrapment
    ("TRAP-NC-004", "F880"),        # porous surface
    ("TRAP-NC-005", "F689"),        # slip flooring
]


@pytest.mark.parametrize("sku,citation", TRAPS)
def test_planted_violation_caught_with_right_citation(sku, citation):
    res = run_plan(PlanRequest(request="Equip a 24-bed wing", budget_usd=480000,
                               contract_id="DSSI-DIRECT", plant_violation_sku=sku))
    viol = [f for f in res.findings if f.verdict == "VIOLATION" and f.sku == sku]
    assert viol, f"{sku} not caught"
    assert citation.lower() in viol[0].citations[0].citation.lower()
    assert viol[0].grounded is True


def test_clean_run_has_no_violations():
    res = run_plan(PlanRequest(request="Equip a 30-bed memory-care wing", budget_usd=480000,
                               contract_id="DSSI-DIRECT"))
    assert res.violations == 0
    assert res.status == "AWAITING_APPROVAL"


def test_budget_within_when_feasible():
    res = run_plan(PlanRequest(request="Equip a 12-bed wing", budget_usd=300000,
                               contract_id="DSSI-DIRECT"))
    assert res.budget.within_budget is True


def test_infeasible_budget_flagged_not_faked():
    res = run_plan(PlanRequest(request="Equip a 30-bed wing", budget_usd=50000,
                               contract_id="DSSI-DIRECT"))
    assert res.budget.within_budget is False  # honest: doesn't pretend to fit


def test_every_asserted_finding_is_grounded():
    res = run_plan(PlanRequest(request="Equip a 30-bed memory-care wing", budget_usd=480000,
                               plant_violation_sku="TRAP-NC-001"))
    for f in res.findings:
        if f.verdict in ("PASS", "VIOLATION"):
            assert f.grounded and f.citations, f"{f.sku} asserted without grounded citation"


def test_rule_missing_attribute_not_false_positive():
    # a nurse_call item with no cleanable_surface attr must NOT be flagged by the
    # cleanable rule (missing attribute = not assessable)
    item = {"category": "nurse_call", "subcategory": "Dome Light + Station",
            "attributes": {"covers_bedside": True, "covers_toilet_bath": True, "relays_to_staff": True},
            "applicable_rooms": ["resident_room"]}
    results = evaluate_item_rules(item, RULES)
    assert all(r.passed for r in results)


def test_rule_explicit_violation_caught():
    item = {"category": "nurse_call", "subcategory": "Bedside Call Station",
            "attributes": {"covers_bedside": True, "covers_toilet_bath": False},
            "applicable_rooms": ["resident_room"]}
    failed = [r for r in evaluate_item_rules(item, RULES) if not r.passed]
    assert failed and failed[0].rule.rule_id == "call_system_coverage"
