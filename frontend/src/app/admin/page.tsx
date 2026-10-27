"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { SystemStatus } from "@/components/system-status";

type User = { id: string; email: string; role: string };
const API_URL = process.env.NEXT_PUBLIC_TRACE_API_URL ?? "http://localhost:8000";

export default function AdminDashboard() {
  const [token] = useState(() => typeof window === "undefined" ? "" : window.sessionStorage.getItem("trace-bearer-token") ?? "");
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [caseId, setCaseId] = useState("");
  const [caseName, setCaseName] = useState("");
  const [caseDescription, setCaseDescription] = useState("");
  const [membershipCase, setMembershipCase] = useState("");
  const [membershipUser, setMembershipUser] = useState("");
  const [submitting, setSubmitting] = useState("");

  useEffect(() => {
    if (!token) return;
    fetch(`${API_URL}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 403 ? "The current session is not authorized." : "The current bearer session could not be loaded.");
        setUser(await response.json() as User);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to load administrator identity."));
  }, [token]);

  async function createCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitAdmin("case", "/api/v1/admin/cases", { case_id: caseId.trim(), name: caseName.trim() || null, description: caseDescription.trim() || null }, () => {
      setCaseId(""); setCaseName(""); setCaseDescription("");
    });
  }

  async function createMembership(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitAdmin("membership", "/api/v1/admin/case-memberships", { case_id: membershipCase.trim(), user_id: membershipUser.trim() }, () => {
      setMembershipCase(""); setMembershipUser("");
    });
  }

  async function submitAdmin(kind: string, path: string, body: object, onSuccess: () => void) {
    if (!token) { setError("Connect a valid bearer session before using administrative actions."); return; }
    setSubmitting(kind); setError(""); setNotice("");
    const response = await fetch(`${API_URL}${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => ({})) as { detail?: string };
    setSubmitting("");
    if (!response.ok) { setError(payload.detail ?? `The ${kind} request failed (${response.status}).`); return; }
    onSuccess();
    setNotice(kind === "case" ? "Case created successfully." : "Case membership created successfully.");
  }

  const isAdmin = user?.role === "ADMIN";
  return <div className="trace-shell">
    <aside className="trace-sidebar"><Link className="trace-brand" href="/"><span className="trace-mark">T</span><span><strong>TRACE</strong><small>FORENSIC EVIDENCE PLATFORM</small></span></Link><p className="sidebar-intro">Tamper-proof Record Archive for Cryptographic Evidence</p><p className="sidebar-label">ADMINISTRATION</p><nav className="trace-nav" aria-label="Administration navigation"><a className="trace-nav-link active" href="#overview"><Icon name="grid" size={16} />Overview</a><a className="trace-nav-link" href="#users"><Icon name="lock" size={16} />User management</a><a className="trace-nav-link" href="#cases"><Icon name="briefcase" size={16} />Case management</a><a className="trace-nav-link" href="#memberships"><Icon name="link" size={16} />Case memberships</a><a className="trace-nav-link" href="#evidence"><Icon name="folder" size={16} />Evidence registry</a><a className="trace-nav-link" href="#system"><Icon name="server" size={16} />System health</a></nav><div className="trace-sidebar-footer"><div className="development-note"><span className="status-dot warning" /><span><strong>Administrative workspace</strong><small>All actions are server-authorized</small></span></div></div></aside>
    <main className="trace-main"><header className="trace-topbar"><div><span className="crumb-muted">Local workspace</span><span className="crumb-divider">/</span><strong>Admin dashboard</strong></div><div className="topbar-actions"><SystemStatus compact /><Link className="topbar-link" href="/">Role selection <Icon name="arrow-up-right" size={13} /></Link></div></header>
      <div className="trace-content"><section className="hero-row" id="overview"><div><p className="overline">PLATFORM ADMINISTRATION / CONTROLLED ACTIONS</p><h1>Admin Dashboard</h1><p className="hero-copy">Manage case boundaries and memberships without changing evidence, reports, or custody history.</p></div></section>
        {!token && <div className="inline-alert"><Icon name="lock" size={16} />Connect a bearer session to load administrator identity and use protected actions.</div>}
        {user && !isAdmin && <div className="inline-alert error"><Icon name="info" size={16} />This session belongs to <strong>{user.role}</strong>. Administrative requests will be rejected by the backend.</div>}
        {error && <div className="inline-alert error"><Icon name="info" size={16} />{error}</div>}{notice && <div className="inline-alert success"><Icon name="check" size={16} />{notice}</div>}
        <section className="metric-grid"><Metric label="Session identity" value={user ? user.role : token ? "Checking" : "Unavailable"} detail={user?.email ?? "No authenticated identity loaded."} icon="lock" /><Metric label="User directory" value="Unavailable" detail="No administrator user-list endpoint exists." icon="briefcase" /><Metric label="Case registry" value="Create only" detail="No case-list endpoint exists yet." icon="folder" /><Metric label="Evidence registry" value="Restricted" detail="Current evidence reads exclude ADMIN." icon="shield-check" /></section>
        <section className="lower-grid" id="cases"><div className="panel"><div className="panel-heading"><div><p className="overline">CASE MANAGEMENT</p><h2>Create a case</h2><p>Uses the existing administrator-only case endpoint.</p></div><Icon name="briefcase" size={20} /></div><form className="admin-form" onSubmit={createCase}><label>Case ID<input required maxLength={200} value={caseId} onChange={(event) => setCaseId(event.target.value)} placeholder="case-2026-001" /></label><label>Name<input maxLength={255} value={caseName} onChange={(event) => setCaseName(event.target.value)} placeholder="Optional case name" /></label><label>Description<textarea maxLength={5000} value={caseDescription} onChange={(event) => setCaseDescription(event.target.value)} placeholder="Optional description" /></label><button className="button button-primary" disabled={submitting === "case"}>{submitting === "case" ? "Creating…" : "Create case"}</button></form></div>
          <div className="panel" id="memberships"><div className="panel-heading"><div><p className="overline">CASE MEMBERSHIPS</p><h2>Assign access</h2><p>Membership creation requires an existing case and active user UUID.</p></div><Icon name="link" size={20} /></div><form className="admin-form" onSubmit={createMembership}><label>Case ID<input required value={membershipCase} onChange={(event) => setMembershipCase(event.target.value)} placeholder="case-2026-001" /></label><label>User ID<input required value={membershipUser} onChange={(event) => setMembershipUser(event.target.value)} placeholder="UUID from the user record" /></label><button className="button button-primary" disabled={submitting === "membership"}>{submitting === "membership" ? "Assigning…" : "Assign membership"}</button></form></div></section>
        <section className="panel" id="users"><div className="panel-heading"><div><p className="overline">USER MANAGEMENT</p><h2>User directory</h2><p>The backend currently has no administrator user-list or role-management endpoint.</p></div><Icon name="lock" size={20} /></div><div className="empty-state"><Icon name="lock" size={19} /><strong>Unavailable</strong><p>No user data is displayed because the API does not expose a safe administrative directory.</p></div></section>
        <section className="lower-grid"><div className="panel" id="evidence"><div className="panel-heading"><div><p className="overline">EVIDENCE REGISTRY</p><h2>Read-only registry</h2><p>ADMIN is not currently authorized for the evidence list endpoint.</p></div><Icon name="folder" size={20} /></div><div className="empty-state"><Icon name="lock" size={19} /><strong>Backend permission required</strong><p>Adding administrative evidence visibility requires an explicit server-side role decision.</p></div></div><div className="panel" id="system"><div className="panel-heading"><div><p className="overline">SYSTEM HEALTH</p><h2>Service status</h2><p>The health proxy reports API availability only.</p></div><SystemStatus /></div><p className="panel-placeholder">Database and object-storage health are not separately exposed by <code>/healthz</code>.</p></div></section>
      </div></main>
  </div>;
}

function Metric({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: "lock" | "briefcase" | "folder" | "shield-check" }) {
  return <article className="metric-card"><span className="metric-icon"><Icon name={icon} size={17} /></span><div><p>{label}</p><strong>{value}</strong><small>{detail}</small></div></article>;
}
