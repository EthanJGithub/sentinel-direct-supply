import type { PlanRequest, PlanResult, TraceEvent } from "./types";

const AGENT_URL = (import.meta as any).env?.VITE_AGENT_URL ?? "http://localhost:8000";

export interface AuthUser { email: string; name: string; role: string; facility: string; }

// ---- token storage ----
const TKEY = "sentinel.token";
const UKEY = "sentinel.user";
export const getToken = () => localStorage.getItem(TKEY);
export const getUser = (): AuthUser | null => {
  const raw = localStorage.getItem(UKEY);
  return raw ? JSON.parse(raw) : null;
};
export function setSession(token: string, user: AuthUser) {
  localStorage.setItem(TKEY, token);
  localStorage.setItem(UKEY, JSON.stringify(user));
}
export function clearSession() {
  localStorage.removeItem(TKEY);
  localStorage.removeItem(UKEY);
}
const authHeaders = (): Record<string, string> => {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
};

export async function login(email: string, password: string): Promise<AuthUser> {
  const r = await fetch(`${AGENT_URL}/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "login failed");
  const data = await r.json();
  setSession(data.access_token, data.user);
  return data.user as AuthUser;
}

export async function health(): Promise<any> {
  const r = await fetch(`${AGENT_URL}/health`);
  return r.json();
}

export async function approve(planId: string): Promise<any> {
  const r = await fetch(`${AGENT_URL}/approve/${planId}`, { method: "POST", headers: { ...authHeaders() } });
  if (r.status === 403) throw new Error("forbidden: your role cannot place orders");
  return r.json();
}

/** Stream the live agent trace over WebSocket (token via query); resolves with the
 *  final PlanResult. Falls back to REST, then to the embedded sample. */
export function runPlanStreaming(
  req: PlanRequest,
  onTrace: (ev: TraceEvent) => void,
): Promise<PlanResult> {
  return new Promise((resolve, reject) => {
    const token = getToken() ?? "";
    const wsUrl = AGENT_URL.replace(/^http/, "ws") + `/ws/plan?token=${encodeURIComponent(token)}`;
    let settled = false;
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      return restFallback(req).then(resolve, reject);
    }
    const failTimer = setTimeout(() => {
      if (!settled) { try { ws.close(); } catch {} restFallback(req).then(resolve, reject); settled = true; }
    }, 4000);

    ws.onopen = () => { clearTimeout(failTimer); ws.send(JSON.stringify(req)); };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "trace") onTrace(msg.event as TraceEvent);
      else if (msg.type === "result") { settled = true; resolve(msg.result as PlanResult); ws.close(); }
      else if (msg.type === "error") { settled = true; reject(new Error(msg.error)); ws.close(); }
    };
    ws.onerror = () => {
      if (!settled) { clearTimeout(failTimer); settled = true; restFallback(req).then(resolve, reject); }
    };
  });
}

async function restFallback(req: PlanRequest): Promise<PlanResult> {
  const r = await fetch(`${AGENT_URL}/plan`, {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!r.ok) throw new Error(`agent error ${r.status}`);
  return r.json();
}
