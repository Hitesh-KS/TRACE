"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { SystemStatus } from "@/components/system-status";

type User = { id: string; email: string; role: string };
type AdminCase = { case_id: string; name: string | null; description: string | null; created_at: string };
type AdminUser = { id: string; email: string; role: string; is_active: boolean };
type IntegritySummary = { checked: number; passed: number; failed: number; ledger_failed: number; storage_errors: number; checked_at: string };
const API_URL = "/api/trace/admin";

export default function AdminDashboard() {
  const [user, setUser] = useState<User | null>(null);
  const [cases, setCases] = useState<AdminCase[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [caseId, setCaseId] = useState("");
  const [caseName, setCaseName] = useState("");
  const [caseDescription, setCaseDescription] = useState("");
  const [membershipCase, setMembershipCase] = useState("");
  const [membershipUser, setMembershipUser] = useState("");
  const [submitting, setSubmitting] = useState("");
  const [systemBusy, setSystemBusy] = useState("");
  const [integrity, setIntegrity] = useState<IntegritySummary | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch(`${API_URL}/api/v1/auth/me`, { signal: controller.signal }),
      fetch(`${API_URL}/api/v1/admin/cases`, { signal: controller.signal }),
      fetch(`${API_URL}/api/v1/admin/users`, { signal: controller.signal }),
    ])
      .then(async ([identityResponse, casesResponse, usersResponse]) => {
        if (!identityResponse.ok) throw new Error("The current bearer session could not be loaded.");
        if (!casesResponse.ok || !usersResponse.ok) throw new Error("Administrator directory data could not be loaded.");
        setUser(await identityResponse.json() as User);
        setCases(((await casesResponse.json()) as { items: AdminCase[] }).items);
        setUsers(((await usersResponse.json()) as { items: AdminUser[] }).items);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to load administrator data.");
      });
    return () => controller.abort();
  }, []);

  async function createCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitAdmin("case", "/api/v1/admin/cases", { case_id: caseId.trim(), name: caseName.trim() || null, description: caseDescription.trim() || null }, () => {
      setCaseId(""); setCaseName(""); setCaseDescription("");
    });
    const response = await fetch(`${API_URL}/api/v1/admin/cases`);
    if (response.ok) setCases(((await response.json()) as { items: AdminCase[] }).items);
  }

  async function createMembership(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitAdmin("membership", "/api/v1/admin/case-memberships", { case_id: membershipCase.trim(), user_id: membershipUser.trim() }, () => {
      setMembershipCase(""); setMembershipUser("");
    });
  }

  async function submitAdmin(kind: string, path: string, body: object, onSuccess: () => void) {
    setSubmitting(kind); setError(""); setNotice("");
    const response = await fetch(`${API_URL}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => ({})) as { detail?: string };
    setSubmitting("");
    if (!response.ok) { setError(payload.detail ?? `The ${kind} request failed (${response.status}).`); return; }
    onSuccess();
    setNotice(kind === "case" ? "Case created successfully." : "Case membership created successfully.");
  }

  async function runIntegrity() {
    setSystemBusy("integrity"); setError(""); setNotice("");
    const response = await fetch(`${API_URL}/api/v1/admin/system-integrity`);
    const payload = await response.json().catch(() => ({})) as IntegritySummary & { detail?: string };
    setSystemBusy("");
    if (!response.ok) { setError(payload.detail ?? `System integrity check failed (${response.status}).`); return; }
    setIntegrity(payload);
    setNotice(`System integrity check complete: ${payload.passed}/${payload.checked} evidence records passed.`);
  }

  async function downloadSystemLog() {
    setSystemBusy("log"); setError(""); setNotice("");
    const response = await fetch(`${API_URL}/api/v1/admin/system-log`);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { detail?: string };
      setSystemBusy("");
      setError(payload.detail ?? `System log export failed (${response.status}).`);
      return;
    }
    const objectUrl = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = objectUrl; link.download = "trace-system-log.pdf"; link.click(); URL.revokeObjectURL(objectUrl);
    setSystemBusy("");
    setNotice("System log downloaded.");
  }

  const isAdmin = user?.role === "ADMIN";
  return <div className="trace-shell">
    <aside className="trace-sidebar"><Link className="trace-brand" href="/"><span className="trace-mark">T</span><span><strong>TRACE</strong><small>FORENSIC EVIDENCE PLATFORM</small></span></Link><p className="sidebar-intro">Tamper-proof Record Archive for Cryptographic Evidence</p><p className="sidebar-label">ADMINISTRATION</p><nav className="trace-nav" aria-label="Administration navigation"><a className="trace-nav-link active" href="#overview"><Icon name="grid" size={16} />Overview</a><a className="trace-nav-link" href="#users"><Icon name="lock" size={16} />User management</a><a className="trace-nav-link" href="#cases"><Icon name="briefcase" size={16} />Case management</a><a className="trace-nav-link" href="#memberships"><Icon name="link" size={16} />Case memberships</a><a className="trace-nav-link" href="#evidence"><Icon name="folder" size={16} />Evidence registry</a><a className="trace-nav-link" href="#system"><Icon name="server" size={16} />System health</a></nav><div className="trace-sidebar-footer"><div className="development-note"><span className="status-dot warning" /><span><strong>Administrative workspace</strong><small>All actions are server-authorized</small></span></div></div></aside>
    <main className="trace-main"><header className="trace-topbar"><div><span className="crumb-muted">Local workspace</span><span className="crumb-divider">/</span><strong>Admin dashboard</strong></div><div className="topbar-actions"><SystemStatus compact /><Link className="topbar-link" href="/">Role selection <Icon name="arrow-up-right" size={13} /></Link></div></header>
      <div className="trace-content"><section className="hero-row" id="overview"><div><p className="overline">PLATFORM ADMINISTRATION / CONTROLLED ACTIONS</p><h1>Admin Dashboard</h1><p className="hero-copy">Manage case boundaries and memberships without changing evidence, reports, or custody history.</p></div></section>
        {user && !isAdmin && <div className="inline-alert error"><Icon name="info" size={16} />This session belongs to <strong>{user.role}</strong>. Administrative requests will be rejected by the backend.</div>}
        {error && <div className="inline-alert error"><Icon name="info" size={16} />{error}</div>}{notice && <div className="inline-alert success"><Icon name="check" size={16} />{notice}</div>}
        <section className="metric-grid"><Metric label="Session identity" value={user ? user.role : "Unavailable"} detail={user?.email ?? "No authenticated identity loaded."} icon="lock" /><Metric label="User directory" value={String(users.length)} detail="User accounts returned by the admin API." icon="briefcase" /><Metric label="Case registry" value={String(cases.length)} detail="Cases available for administration." icon="folder" /><Metric label="Evidence registry" value="Blind" detail="ADMIN has no evidence view, download, or decrypt access." icon="shield-check" /></section>
        <section className="lower-grid" id="cases"><div className="panel"><div className="panel-heading"><div><p className="overline">CASE MANAGEMENT</p><h2>Create a case</h2><p>New cases can be assigned to active users below.</p></div><Icon name="briefcase" size={20} /></div><form className="admin-form" onSubmit={createCase}><label>Case ID<input required maxLength={200} value={caseId} onChange={(event) => setCaseId(event.target.value)} placeholder="case-2026-001" /></label><label>Name<input maxLength={255} value={caseName} onChange={(event) => setCaseName(event.target.value)} placeholder="Optional case name" /></label><label>Description<textarea maxLength={5000} value={caseDescription} onChange={(event) => setCaseDescription(event.target.value)} placeholder="Optional description" /></label><button className="button button-primary" disabled={submitting === "case"}>{submitting === "case" ? "Creating…" : "Create case"}</button></form><div className="case-list">{cases.map((item) => <article className="case-list-item" key={item.case_id}><span className="metric-icon"><Icon name="briefcase" size={16} /></span><div><strong>{item.name || item.case_id}</strong><small>{item.case_id}</small></div></article>)}</div></div>
          <div className="panel" id="memberships"><div className="panel-heading"><div><p className="overline">CASE MEMBERSHIPS</p><h2>Assign access</h2><p>Choose an existing case and active user.</p></div><Icon name="link" size={20} /></div><form className="admin-form" onSubmit={createMembership}><label>Case<select required value={membershipCase} onChange={(event) => setMembershipCase(event.target.value)}><option value="">Select a case</option>{cases.map((item) => <option key={item.case_id} value={item.case_id}>{item.name ? `${item.name} (${item.case_id})` : item.case_id}</option>)}</select></label><label>User<select required value={membershipUser} onChange={(event) => setMembershipUser(event.target.value)}><option value="">Select an active user</option>{users.filter((item) => item.is_active).map((item) => <option key={item.id} value={item.id}>{item.email} · {item.role}</option>)}</select></label><button className="button button-primary" disabled={submitting === "membership" || !cases.length || !users.some((item) => item.is_active)}>{submitting === "membership" ? "Assigning…" : "Assign membership"}</button></form></div></section>
        <section className="panel" id="users"><div className="panel-heading"><div><p className="overline">USER MANAGEMENT</p><h2>User directory</h2><p>Account visibility only; authentication and role editing are not available here.</p></div><Icon name="lock" size={20} /></div>{users.length ? <div className="table-wrap"><table className="trace-table"><thead><tr><th>User</th><th>Role</th><th>Status</th><th>User ID</th></tr></thead><tbody>{users.map((item) => <tr key={item.id}><td>{item.email}</td><td>{item.role}</td><td>{item.is_active ? "Active" : "Inactive"}</td><td><code>{item.id}</code></td></tr>)}</tbody></table></div> : <div className="empty-state"><Icon name="lock" size={19} /><strong>No accounts available</strong><p>There are no user accounts to display.</p></div>}</section>
        <section className="lower-grid"><div className="panel" id="evidence"><div className="panel-heading"><div><p className="overline">EVIDENCE REGISTRY</p><h2>Blind registry</h2><p>ADMIN is intentionally excluded from evidence reads.</p></div><Icon name="folder" size={20} /></div><div className="empty-state"><Icon name="lock" size={19} /><strong>No evidence access</strong><p>System integrity checks return aggregate health counts without exposing evidence records.</p></div></div><div className="panel" id="system"><div className="panel-heading"><div><p className="overline">SYSTEM HEALTH</p><h2>Service status</h2><p>API availability and aggregate storage/ledger integrity.</p></div><SystemStatus /></div><div className="report-form-actions"><button className="button button-primary" type="button" onClick={() => void runIntegrity()} disabled={!isAdmin || systemBusy === "integrity"}>{systemBusy === "integrity" ? "Checking…" : "Run system integrity check"}</button><button className="button button-quiet" type="button" onClick={() => void downloadSystemLog()} disabled={!isAdmin || systemBusy === "log"}>{systemBusy === "log" ? "Preparing…" : "Download system log"}</button></div>{integrity && <p className="panel-placeholder">Checked {integrity.checked} evidence records: {integrity.passed} passed, {integrity.failed} failed, {integrity.ledger_failed} ledger failures, {integrity.storage_errors} storage errors.</p>}<p className="panel-placeholder">The system log contains infrastructure counts and routing only. It contains no evidence records.</p></div></section>
      </div></main>
  </div>;
}

function Metric({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: "lock" | "briefcase" | "folder" | "shield-check" }) {
  return <article className="metric-card"><span className="metric-icon"><Icon name={icon} size={17} /></span><div><p>{label}</p><strong>{value}</strong><small>{detail}</small></div></article>;
}
