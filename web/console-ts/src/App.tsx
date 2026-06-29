import { useEffect, useMemo, useRef, useState } from "react";
import {
  approve, clearSession, getRunDetail, getUser, health, listRuns,
  runPlanStreaming, type AuthUser, type RunSummary,
} from "./api";
import Login from "./Login";
import {
  IconAlert, IconBolt, IconBuilding, IconCheck, IconClock, IconCoin,
  IconDoc, IconHelp, IconList, IconShield,
} from "./icons";
import { SAMPLE_RESULT } from "./sample";
import type { ComplianceFinding, PlanRequest, PlanResult, TraceEvent, Verdict } from "./types";

const NODES = ["Planner", "Sourcing", "Compliance", "Budget", "Audit"];
const usd = (n: number) => "$" + Math.round(n).toLocaleString();

const PRESETS: { label: string; tag?: string; danger?: boolean; req: Partial<PlanRequest> }[] = [
  { label: "30-bed memory-care wing", req: { request: "Opening a 30-bed memory-care wing in 60 days. Equip resident rooms, nursing station, and common areas, compliant with CMS Life-Safety + NC rules, using GPO contract pricing.", budget_usd: 480000, plant_violation_sku: null } },
  { label: "Plant a violation — bedside-only call station", tag: "DEMO · watch it get caught", danger: true, req: { request: "Equip a 30-bed memory-care wing within budget and compliant.", budget_usd: 480000, plant_violation_sku: "TRAP-NC-001" } },
  { label: "Plant — 36in egress door (NFPA 101)", tag: "DEMO", danger: true, req: { request: "Equip a 30-bed skilled-nursing wing, Life-Safety compliant.", budget_usd: 480000, plant_violation_sku: "TRAP-NC-002" } },
  { label: "Tight budget — force optimization", tag: "$250k", req: { request: "Equip a 30-bed memory-care wing for $250k using contract pricing.", budget_usd: 250000, plant_violation_sku: null } },
];

// ---- status pill ----
function Pill({ kind, children }: { kind: "ok" | "warn" | "crit" | "info"; children: React.ReactNode }) {
  const icon = kind === "ok" ? <IconCheck /> : kind === "crit" ? <IconAlert /> : kind === "warn" ? <IconHelp /> : <IconShield />;
  return <span className={`pill ${kind}`}>{icon}{children}</span>;
}
const verdictKind = (v: Verdict) => (v === "PASS" ? "ok" : v === "VIOLATION" ? "crit" : "warn");

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(getUser());
  if (!user) return <Login onLogin={setUser} />;
  return <Console user={user} onLogout={() => { clearSession(); setUser(null); }} />;
}

function Console({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const canApprove = user.role === "approver" || user.role === "admin";
  const [view, setView] = useState<"compose" | "queue">("compose");
  const [req, setReq] = useState<PlanRequest>({
    request: PRESETS[0].req.request!, facility_name: "Cedarwood Senior Living", state: "NC",
    care_type: "memory_care", budget_usd: 480000, contract_id: "DSSI-DIRECT", plant_violation_sku: null,
  });
  const [result, setResult] = useState<PlanResult | null>(null);
  const [running, setRunning] = useState(false);
  const [activeNode, setActiveNode] = useState<string | null>(null);
  const [doneNodes, setDoneNodes] = useState<Set<string>>(new Set());
  const [log, setLog] = useState<TraceEvent[]>([]);
  const [offline, setOffline] = useState(false);
  const [env, setEnv] = useState<any>(null);
  const [approved, setApproved] = useState<any>(null);
  const [approveErr, setApproveErr] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [queueDetail, setQueueDetail] = useState<PlanResult | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => { health().then(setEnv).catch(() => setEnv(null)); }, []);
  useEffect(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight); }, [log]);
  const refreshRuns = () => listRuns().then(setRuns).catch(() => setRuns([]));
  useEffect(() => { refreshRuns(); }, []);
  // refresh the queue whenever a plan is generated or approved
  useEffect(() => { if (result || approved) refreshRuns(); }, [result?.plan_id, approved]);
  const pending = runs.filter((r) => r.status === "AWAITING_APPROVAL").length;

  function applyPreset(p: typeof PRESETS[number]) {
    setReq((r) => ({ ...r, ...p.req }));
    setView("compose");
  }

  async function run() {
    setRunning(true); setResult(null); setApproved(null); setOffline(false);
    setDoneNodes(new Set()); setActiveNode(null); setLog([]);
    try {
      const res = await runPlanStreaming(req, (ev) => {
        setLog((l) => [...l, ev]);
        if (ev.event === "start") setActiveNode(ev.node);
        if (ev.event === "end") setDoneNodes((d) => new Set(d).add(ev.node));
      });
      setActiveNode(null); setResult(res);
    } catch {
      // backend unreachable -> show embedded sample so the experience still renders
      setOffline(true);
      await playSampleTrace();
      setResult({ ...SAMPLE_RESULT, plan_id: SAMPLE_RESULT.plan_id, status: SAMPLE_RESULT.status });
    } finally { setRunning(false); }
  }

  async function playSampleTrace() {
    for (const n of NODES) {
      setActiveNode(n);
      setLog((l) => [...l, { node: n, event: "start", detail: `${n} started`, tokens_in: 0, tokens_out: 0, cost_usd: 0, latency_ms: 0 }]);
      await new Promise((r) => setTimeout(r, 430));
      setDoneNodes((d) => new Set(d).add(n));
    }
    setActiveNode(null);
  }

  async function doApprove() {
    if (!result) return;
    setApproveErr(null);
    if (offline) { setApproved({ status: "ORDERED", order: { id: "ord_sample", total: result.budget?.subtotal_usd, note: "offline sample" } }); return; }
    try { setApproved(await approve(result.plan_id)); }
    catch (e: any) { setApproveErr(e.message ?? "approval failed"); }
  }

  return (
    <div className="app">
      <Rail env={env} onPreset={applyPreset} view={view} setView={setView} pending={pending} />
      <TopBar req={req} env={env} offline={offline} user={user} onLogout={onLogout} />
      <main className="main">
        {view === "compose" ? (
          <>
            <Composer req={req} setReq={setReq} run={run} running={running} />
            {!result && !running && <EmptyState />}
            {(running || result) && (
              <>
                {result && <Kpis result={result} />}
                {result && result.status === "AWAITING_APPROVAL" && !approved &&
                  <Approval result={result} onApprove={doApprove} canApprove={canApprove}
                    approveErr={approveErr} role={user.role} onGoToQueue={() => setView("queue")} />}
                {approved && <OrderedBanner approved={approved} />}
                <Trace activeNode={activeNode} doneNodes={doneNodes} log={log} logRef={logRef} models={result?.metrics?.models} />
                {result && <Compliance findings={result.findings} />}
                {result && <Cart result={result} />}
              </>
            )}
          </>
        ) : (
          <Requests user={user} canApprove={canApprove} runs={runs} refresh={refreshRuns}
            onSelect={setQueueDetail} />
        )}
      </main>
      <Aside result={view === "queue" ? queueDetail : result} offline={offline} />
    </div>
  );
}

// ---------------- left rail ----------------
function Rail({ env, onPreset, view, setView, pending }:
  { env: any; onPreset: (p: typeof PRESETS[number]) => void;
    view: "compose" | "queue"; setView: (v: "compose" | "queue") => void; pending: number }) {
  return (
    <aside className="rail">
      <div className="brand">
        <span className="logo" style={{ color: "#fff" }}><IconShield /></span>
        <div><h1>Sentinel</h1><div className="sub">Procurement &amp; Compliance</div></div>
      </div>
      <div className="rail-section">
        <h3>Workspace</h3>
        <button className={`nav-item${view === "compose" ? " active" : ""}`} onClick={() => setView("compose")}>
          <IconDoc /><span>New request</span>
        </button>
        <button className={`nav-item${view === "queue" ? " active" : ""}`} onClick={() => setView("queue")}>
          <IconList /><span>Approval queue</span>
          {pending > 0 && <span className="nav-badge">{pending}</span>}
        </button>
      </div>
      <div className="rail-section">
        <h3>Facility</h3>
        <div className="rail-field"><label>Provider</label><div className="val">Cedarwood Senior Living</div></div>
        <div className="rail-field"><label>State · Care type</label><div className="val">NC · Memory care</div></div>
        <div className="rail-field"><label>GPO contract</label><div className="val">Direct Supply DSSI</div></div>
      </div>
      <div className="rail-section">
        <h3>Scenarios</h3>
        {PRESETS.map((p) => (
          <button key={p.label} className={`preset${p.danger ? " danger" : ""}`} onClick={() => onPreset(p)}>
            {p.label}{p.tag && <><br /><span className="tag">{p.tag}</span></>}
          </button>
        ))}
      </div>
      <div className="rail-spacer" />
      <div className="rail-foot">
        {env ? <>Agent online · {env.rag === "pgvector" ? "pgvector RAG" : "keyword RAG"}<br />models: {env.real_models ? "Claude + OpenAI" : "heuristic (dev)"}</>
             : "Agent offline · sample mode"}
      </div>
    </aside>
  );
}

// ---------------- topbar ----------------
function TopBar({ req, env, offline, user, onLogout }:
  { req: PlanRequest; env: any; offline: boolean; user: AuthUser; onLogout: () => void }) {
  const roleKind = user.role === "approver" ? "ok" : user.role === "admin" ? "info" : "warn";
  return (
    <header className="topbar">
      <span style={{ color: "var(--primary)" }}><IconBuilding /></span>
      <div>
        <div className="facility">{req.facility_name}</div>
        <div className="crumbs">New care wing · {req.care_type.replace("_", " ")} · budget {usd(req.budget_usd)}</div>
      </div>
      <div className="spacer" />
      <span className="env-chip">{offline ? "offline sample" : env ? (env.real_models ? "PROVIDER=demo (Claude+OpenAI)" : "PROVIDER=dev (free)") : "connecting…"}</span>
      <div className="user-box">
        <div className="user-meta">
          <span className="user-name">{user.name}</span>
          <Pill kind={roleKind as any}>{user.role}</Pill>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onLogout}>Sign out</button>
      </div>
    </header>
  );
}

// ---------------- composer ----------------
function Composer({ req, setReq, run, running }: any) {
  return (
    <div className="card composer">
      <header><span style={{ color: "var(--primary)" }}><IconDoc /></span><h2>Procurement request</h2>
        <span className="hint">natural language → multi-agent plan</span></header>
      <div className="body">
        <textarea value={req.request} onChange={(e) => setReq({ ...req, request: e.target.value })} />
        <div className="row">
          <div className="field"><label>Budget (USD)</label>
            <input type="number" value={req.budget_usd} onChange={(e) => setReq({ ...req, budget_usd: Number(e.target.value) })} /></div>
          <div className="field"><label>GPO contract</label>
            <select value={req.contract_id ?? ""} onChange={(e) => setReq({ ...req, contract_id: e.target.value })}>
              <option value="DSSI-DIRECT">Direct Supply DSSI</option>
              <option value="GPO-PREMIER">Premier</option>
              <option value="GPO-VIZIENT">Vizient</option>
            </select></div>
          <div className="field"><label>Plant violation (demo)</label>
            <select value={req.plant_violation_sku ?? ""} onChange={(e) => setReq({ ...req, plant_violation_sku: e.target.value || null })}>
              <option value="">none</option>
              <option value="TRAP-NC-001">TRAP-NC-001 · call coverage</option>
              <option value="TRAP-NC-002">TRAP-NC-002 · egress door</option>
              <option value="TRAP-NC-003">TRAP-NC-003 · bed entrapment</option>
              <option value="TRAP-NC-004">TRAP-NC-004 · porous surface</option>
              <option value="TRAP-NC-005">TRAP-NC-005 · slip flooring</option>
            </select></div>
          <div className="field" style={{ marginLeft: "auto" }}><label>&nbsp;</label>
            <button className="btn btn-primary" onClick={run} disabled={running}>
              {running ? <><span className="spinner" />Running agents…</> : "Generate compliant plan"}</button></div>
        </div>
      </div>
    </div>
  );
}

// ---------------- KPI strip ----------------
function Kpis({ result }: { result: PlanResult }) {
  const b = result.budget; const m = result.metrics;
  return (
    <div className="kpis">
      <div className="kpi"><div className="label">Plan total</div>
        <div className={`value ${b?.within_budget ? "ok" : "crit"}`}>{usd(b?.subtotal_usd ?? 0)}</div>
        <div className="meta">of {usd(b?.budget_usd ?? 0)} · saved {usd(b?.savings_vs_list_usd ?? 0)} vs list</div></div>
      <div className="kpi"><div className="label">Violations caught</div>
        <div className={`value ${result.violations ? "crit" : "ok"}`}>{result.violations}</div>
        <div className="meta">{result.abstentions} abstained for review</div></div>
      <div className="kpi"><div className="label">Run cost</div>
        <div className="value">${(m?.total_cost_usd ?? 0).toFixed(4)}</div>
        <div className="meta">ceiling ${m?.cost_ceiling_usd ?? "0.50"} · {m?.over_budget ? "OVER" : "within"}</div></div>
      <div className="kpi"><div className="label">Latency</div>
        <div className="value">{Math.round((m?.total_latency_ms ?? 0))}<span style={{ fontSize: 13 }}> ms</span></div>
        <div className="meta">tool success {Math.round((m?.tool_success_rate ?? 1) * 100)}%</div></div>
    </div>
  );
}

// ---------------- HITL approval (role-gated) ----------------
function Approval({ result, onApprove, canApprove, approveErr, role, onGoToQueue }:
  { result: PlanResult; onApprove: () => void; canApprove: boolean; approveErr: string | null;
    role: string; onGoToQueue?: () => void }) {
  const blocked = result.violations > 0;
  return (
    <div className={`approval${blocked ? " blocked" : ""}`}>
      <span style={{ color: blocked ? "var(--crit)" : "var(--info)" }}>{blocked ? <IconAlert /> : <IconCheck />}</span>
      <div className="a-text">
        <b>{blocked ? `${result.violations} compliance violation(s) held for your review` : "Plan validated — ready for approval"}</b>
        Human-in-the-loop checkpoint. {blocked ? "Violating items are excluded from the order; approve to place the compliant remainder." : "All items grounded in CMS / Life-Safety regulation."}
        {!canApprove && <span className="rbac-note"> Submitted to the <b>approval queue</b> as request <code>{result.plan_id}</code>. Your role (<b>{role}</b>) can review but not place orders — an <b>approver</b> must sign off.</span>}
        {approveErr && <span className="login-err" style={{ marginTop: 6 }}>{approveErr}</span>}
      </div>
      {canApprove
        ? <button className="btn btn-ok" onClick={onApprove}>Approve &amp; place order</button>
        : onGoToQueue
          ? <button className="btn btn-ghost" onClick={onGoToQueue} title="Open the approval queue">View in queue →</button>
          : null}
    </div>
  );
}
function OrderedBanner({ approved }: { approved: any }) {
  return (
    <div className="approval">
      <span style={{ color: "var(--ok)" }}><IconCheck /></span>
      <div className="a-text"><b>Order placed via C# catalog service</b>
        Order {approved.order?.id} · total {usd(approved.order?.total ?? 0)} {approved.order?.note ? `(${approved.order.note})` : ""}</div>
    </div>
  );
}

// ---------------- agent trace ----------------
function Trace({ activeNode, doneNodes, log, logRef, models }: any) {
  const detail = (n: string) => {
    const last = [...log].reverse().find((e: TraceEvent) => e.node === n && e.detail);
    return last?.detail ?? "";
  };
  return (
    <div className="card">
      <header><span style={{ color: "var(--primary)" }}><IconBolt /></span><h2>Agent trace</h2>
        <span className="hint">LangGraph · Planner → Sourcing → Compliance → Budget → Audit</span>
        <span className="spacer" />
        {models && <span className="env-chip">reason: {models.reason}</span>}</header>
      <div className="body">
        <div className="pipeline">
          {NODES.map((n, i) => {
            const cls = doneNodes.has(n) ? "done" : activeNode === n ? "active" : "";
            return (
              <div key={n} className={`node-row ${cls}`}>
                <span className="node-dot">{doneNodes.has(n) ? "✓" : i + 1}</span>
                <div><div className="node-name">{n}</div><div className="node-detail">{detail(n) || nodeBlurb(n)}</div></div>
              </div>
            );
          })}
        </div>
        <div className="tracelog" ref={logRef}>
          {log.length === 0 && <div className="ln muted">waiting for trace…</div>}
          {log.map((e: TraceEvent, i: number) => (
            <div key={i} className={`ln ${e.event}`}>
              [{e.node}] {e.event}{e.model ? ` · ${e.model}` : ""}{e.cost_usd ? ` · $${e.cost_usd.toFixed(5)}` : ""}{e.latency_ms ? ` · ${e.latency_ms}ms` : ""} {e.detail}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
const nodeBlurb = (n: string) => ({
  Planner: "decompose request → procurement spec", Sourcing: "catalog_search + contract pricing (C# service)",
  Compliance: "reg_search + validate_item · citation-or-abstain", Budget: "constraint solve vs budget",
  Audit: "immutable decision record",
}[n] ?? "");

// ---------------- approval queue ----------------
const statusKind = (s: string): "ok" | "warn" | "crit" | "info" =>
  s === "ORDERED" ? "ok" : s === "AWAITING_APPROVAL" ? "warn" : "info";

function Requests({ user, canApprove, runs, refresh, onSelect }:
  { user: AuthUser; canApprove: boolean; runs: RunSummary[]; refresh: () => void;
    onSelect: (r: PlanResult | null) => void }) {
  const [detail, setDetail] = useState<PlanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [approved, setApproved] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  async function open(planId: string) {
    setLoading(true); setErr(null); setApproved(null);
    try { const d = await getRunDetail(planId); setDetail(d); onSelect(d); }
    catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  }
  function back() { setDetail(null); onSelect(null); setApproved(null); setErr(null); }

  async function doApprove() {
    if (!detail) return;
    setErr(null);
    try { const r = await approve(detail.plan_id); setApproved(r); refresh(); await open(detail.plan_id); }
    catch (e: any) { setErr(e.message ?? "approval failed"); }
  }

  if (detail) {
    const ordered = !!approved || detail.status === "ORDERED";
    return (
      <>
        <div className="queue-bar">
          <button className="btn btn-ghost btn-sm" onClick={back}>← Back to queue</button>
          <span className="sku">request {detail.plan_id}</span>
        </div>
        <Kpis result={detail} />
        {ordered
          ? <OrderedBanner approved={approved ?? { status: "ORDERED", order: { id: "(persisted)", total: detail.budget?.subtotal_usd } }} />
          : canApprove
            ? <Approval result={detail} onApprove={doApprove} canApprove approveErr={err} role={user.role} />
            : <Approval result={detail} onApprove={() => {}} canApprove={false} approveErr={err} role={user.role} />}
        <Compliance findings={detail.findings} />
        <Cart result={detail} />
      </>
    );
  }

  return (
    <div className="card">
      <header><span style={{ color: "var(--primary)" }}><IconList /></span><h2>Approval queue</h2>
        <span className="hint">requests in your tenant{user.role === "admin" ? " (all tenants)" : ""}</span>
        <span className="spacer" />
        <button className="btn btn-ghost btn-sm" onClick={refresh}>Refresh</button></header>
      <div className="body tight">
        {runs.length === 0 && (
          <div className="empty"><IconList />
            <div className="muted">No requests yet. Generate a plan from “New request”.</div></div>)}
        {runs.length > 0 && (
          <table className="grid">
            <thead><tr><th>Request</th>{user.role === "admin" && <th>Tenant</th>}
              <th>Status</th><th className="num">Violations</th><th className="num">Cost</th><th></th></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.plan_id}>
                  <td className="sku">{r.plan_id}</td>
                  {user.role === "admin" && <td className="muted">{r.tenant_id}</td>}
                  <td><Pill kind={statusKind(r.status)}>
                    {r.status === "AWAITING_APPROVAL" ? "pending" : r.status.toLowerCase()}</Pill></td>
                  <td className="num">{r.violations}</td>
                  <td className="num">{r.cost_usd != null ? "$" + r.cost_usd.toFixed(4) : "—"}</td>
                  <td><button className="btn btn-ghost btn-sm" onClick={() => open(r.plan_id)}>
                    {r.status === "AWAITING_APPROVAL" && canApprove ? "Review & approve" : "View"}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {loading && <div className="muted" style={{ padding: 12 }}>Loading…</div>}
        {err && <div className="login-err" style={{ margin: 12 }}>{err}</div>}
      </div>
    </div>
  );
}

// ---------------- compliance ----------------
function Compliance({ findings }: { findings: ComplianceFinding[] }) {
  const order = { VIOLATION: 0, ABSTAIN: 1, PASS: 2 } as const;
  const sorted = [...findings].sort((a, b) => order[a.verdict] - order[b.verdict]);
  const counts = findings.reduce((a, f) => ((a[f.verdict] = (a[f.verdict] ?? 0) + 1), a), {} as Record<string, number>);
  return (
    <div className="card">
      <header><span style={{ color: "var(--primary)" }}><IconShield /></span><h2>Compliance report</h2>
        <span className="spacer" />
        <Pill kind="crit">{counts.VIOLATION ?? 0} violation</Pill>&nbsp;
        <Pill kind="warn">{counts.ABSTAIN ?? 0} abstain</Pill>&nbsp;
        <Pill kind="ok">{counts.PASS ?? 0} pass</Pill></header>
      <div className="body">
        {sorted.map((f, i) => (
          <div key={i} className={`finding v-${f.verdict}`}>
            <div className="f-head">
              <Pill kind={verdictKind(f.verdict)}>{f.verdict}</Pill>
              <span className="f-name">{f.name}</span>
              <span className="f-room">· {f.room_type.replace("_", " ")}</span>
              <span className="spacer" />
              {f.gate_blocked && <Pill kind="warn">hallucination gate</Pill>}
              {f.grounded && <span className="sku">grounded</span>}
            </div>
            <p className="f-rationale">{f.rationale}</p>
            {f.citations?.[0] && (
              <div className="citation">
                <div className="c-cite"><IconDoc />{f.citations[0].citation}</div>
                <div className="c-quote">“{f.citations[0].quote}”</div>
                <div className="c-src">{f.citations[0].source}</div>
              </div>
            )}
            {f.recommended_substitution && (
              <div className="fix"><IconCheck /> Recommended compliant substitution: {f.recommended_substitution.name} ({usd(f.recommended_substitution.price)})</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- cart ----------------
function Cart({ result }: { result: PlanResult }) {
  const violating = new Set(result.findings.filter((f) => f.verdict === "VIOLATION").map((f) => f.sku));
  return (
    <div className="card">
      <header><span style={{ color: "var(--primary)" }}><IconList /></span><h2>Procurement plan</h2>
        <span className="hint">sourced via C# catalog &amp; contract service</span></header>
      <div className="body tight">
        <table className="grid">
          <thead><tr><th>Item</th><th>Room</th><th>SKU</th><th>Contract</th><th className="num">Qty</th><th className="num">Unit</th><th className="num">Line</th><th></th></tr></thead>
          <tbody>
            {result.cart.map((l, i) => (
              <tr key={i}>
                <td>{l.name}</td>
                <td className="muted">{l.room_type.replace("_", " ")}</td>
                <td className="sku">{l.sku}</td>
                <td className="muted">{l.contract_id ?? "list"}</td>
                <td className="num">{l.qty}</td>
                <td className="num">{usd(l.unit_price)}</td>
                <td className="num">{usd(l.unit_price * l.qty)}</td>
                <td>{violating.has(l.sku) ? <Pill kind="crit">excluded</Pill> : <Pill kind="ok">ok</Pill>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------- aside: monitoring + audit ----------------
function Aside({ result, offline }: { result: PlanResult | null; offline: boolean }) {
  const m = result?.metrics;
  const ceiling = m?.cost_ceiling_usd ?? 0.5;
  const spent = m?.total_cost_usd ?? 0;
  const pct = Math.min(100, (spent / ceiling) * 100);
  return (
    <aside className="aside">
      <h3>Cost &amp; performance</h3>
      {!result && <div className="banner-note">Run a plan to populate live cost / latency monitoring.</div>}
      {result && (
        <>
          <div className="meter">
            <div className="top"><span>Per-request cost</span><span>${spent.toFixed(4)} / ${ceiling}</span></div>
            <div className="bar"><i style={{ width: `${pct}%`, background: pct > 100 ? "var(--crit)" : "var(--ok)" }} /></div>
          </div>
          <h3>Model routing</h3>
          {Object.entries(m?.by_model ?? {}).map(([name, v]: any) => (
            <div className="modelrow" key={name}>
              <span className="m-name">{name}</span>
              <span>${v.cost.toFixed(4)} · {v.calls}×</span>
            </div>
          ))}
          <h3 style={{ marginTop: 16 }}><IconClock /> Per-node latency</h3>
          {Object.entries(m?.by_node ?? {}).map(([n, v]: any) => {
            const max = Math.max(...Object.values(m?.by_node ?? {}).map((x: any) => x.latency_ms), 1);
            return (
              <div className="meter" key={n}>
                <div className="top"><span>{n}</span><span>{Math.round(v.latency_ms)} ms</span></div>
                <div className="bar"><i style={{ width: `${(v.latency_ms / max) * 100}%`, background: "var(--primary)" }} /></div>
              </div>
            );
          })}
          <h3 style={{ marginTop: 16 }}>Audit trail</h3>
          {result.audit.map((a, i) => (
            <div className="audit-item" key={i}>
              <span className="a-dot" />
              <div><span className="a-agent">{a.agent}</span>
                <div className="a-detail">{Object.entries(a.decision).map(([k, v]) => `${k}: ${v}`).join(" · ")}</div></div>
            </div>
          ))}
          {offline && <div className="banner-note" style={{ marginTop: 14 }}>Offline sample (backend unreachable). Numbers illustrate a real run; start the agent service for live data.</div>}
        </>
      )}
    </aside>
  );
}

function EmptyState() {
  return (
    <div className="card"><div className="empty">
      <IconShield />
      <div style={{ fontWeight: 600, color: "var(--ink-2)" }}>No active plan</div>
      <div className="muted" style={{ marginTop: 6, maxWidth: 420, marginInline: "auto" }}>
        Enter a procurement request or pick a scenario. Sentinel decomposes it, sources equipment through the C# catalog
        service, validates every item against CMS Appendix PP / NFPA 101 with citations, and keeps it in budget.
      </div>
    </div></div>
  );
}
