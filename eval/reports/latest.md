# Sentinel — Eval Report
_Generated 2026-06-26T15:10:16.018090+00:00_  ·  12 golden scenarios

**Gate: PASSED ✅**

| Metric | Value | Threshold | Pass |
|---|---|---|---|
| Compliance recall (planted violations caught) | 100.0% | 100% | ✅ |
| Citation accuracy (correct regulation cited) | 100.0% | 100% | ✅ |
| Citation-grounding rate | 100.0% | 95% | ✅ |
| Budget adherence (feasible scenarios) | 100.0% | 100% | ✅ |
| False-violation rate (clean carts) | 0.00 | 0.00 | ✅ |
| Plan completeness | 100.0% | 95% | ✅ |
| Avg cost / run | $0.00000 | — | — |
| Avg latency / run | 2 ms | — | — |

## Per-scenario
| Scenario | Caught | Expected | Catch | Budget | Subtotal/Budget |
|---|---|---|---|---|---|
| 30-bed memory-care wing, ample budget (clean b | — | — | ✅ | within | $283,992 / $480,000 |
| Planted: bedside-only call station (no toilet/ | TRAP-NC-001 | TRAP-NC-001 | ✅ | within | $284,086 / $480,000 |
| Planted: 36in resident room door (egress width | TRAP-NC-002 | TRAP-NC-002 | ✅ | within | $284,968 / $480,000 |
| Planted: legacy-rail bed (entrapment risk) | TRAP-NC-003 | TRAP-NC-003 | ✅ | within | $227,876 / $400,000 |
| Planted: porous, non-cleanable lounge seating  | TRAP-NC-004 | TRAP-NC-004 | ✅ | within | $206,410 / $350,000 |
| Planted: non-slip-rated resident room vinyl (f | TRAP-NC-005 | TRAP-NC-005 | ✅ | within | $284,834 / $460,000 |
| Infeasible budget — minimum compliant config e | — | — | ✅ | OVER | $110,383 / $100,000 |
| Budget optimization — swaps bring cart under b | — | — | ✅ | within | $234,985 / $250,000 |
| Small 12-bed wing | — | — | ✅ | within | $124,996 / $200,000 |
| Large 48-bed wing | — | — | ✅ | within | $443,283 / $900,000 |
| Planted violation AND tight budget (two pressu | TRAP-NC-001 | TRAP-NC-001 | ✅ | within | $235,080 / $260,000 |
| Assisted living on Vizient contract | — | — | ✅ | within | $204,739 / $300,000 |
