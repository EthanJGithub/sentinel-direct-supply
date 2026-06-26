import { useState } from "react";
import { login, type AuthUser } from "./api";
import { IconShield } from "./icons";

const DEMO = [
  { role: "Operator", email: "operator@cedarwood.health", pw: "Operator!2026", note: "run plans" },
  { role: "Approver", email: "approver@cedarwood.health", pw: "Approver!2026", note: "place orders (HITL)" },
  { role: "Admin", email: "admin@sentinel.io", pw: "Admin!2026", note: "full access" },
];

export default function Login({ onLogin }: { onLogin: (u: AuthUser) => void }) {
  const [email, setEmail] = useState("operator@cedarwood.health");
  const [password, setPassword] = useState("Operator!2026");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try { onLogin(await login(email, password)); }
    catch (e: any) { setErr(e.message ?? "login failed"); }
    finally { setBusy(false); }
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-brand">
          <span className="logo"><IconShield /></span>
          <div><h1>Sentinel</h1><div className="sub">Procurement &amp; Compliance Copilot</div></div>
        </div>
        <p className="login-lead">Sign in to the operator console. Access is role-based — only
          <b> approvers</b> may place orders (the regulated human-in-the-loop gate).</p>
        <form onSubmit={submit}>
          <label className="login-field">
            <span>Work email</span>
            <input type="email" value={email} autoComplete="username"
              onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className="login-field">
            <span>Password</span>
            <input type="password" value={password} autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)} required />
          </label>
          {err && <div className="login-err" role="alert">{err}</div>}
          <button className="btn btn-primary login-btn" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <div className="login-demo">
          <div className="login-demo-title">Demo accounts (click to fill)</div>
          {DEMO.map((d) => (
            <button key={d.email} type="button" className="demo-row"
              onClick={() => { setEmail(d.email); setPassword(d.pw); }}>
              <span className="demo-role">{d.role}</span>
              <span className="demo-email">{d.email}</span>
              <span className="demo-note">{d.note}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="login-foot">JWT + RBAC · passwords hashed (PBKDF2-SHA256) · $0 free-tier build</div>
    </div>
  );
}
