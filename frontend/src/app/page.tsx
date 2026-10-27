"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { Icon, type IconName } from "@/components/icon";
import { SystemStatus } from "@/components/system-status";

type User = { id: string; email: string; role: string };
type Evidence = {
  evidence_id: string;
  case_id: string;
  file_name: string;
  content_type: string;
  file_sha256: string;
  byte_size: number;
  status: string;
  created_at: string;
  uploader_id?: string | null;
};
type Verification = { status: string; ledger_status: string };
type ApiResult = { items: Evidence[]; limit: number; offset: number };
type NavItem = { label: string; href: string; icon: IconName };

const API_URL = process.env.NEXT_PUBLIC_TRACE_API_URL ?? "http://localhost:8000";
const navItems: NavItem[] = [
  { label: "Dashboard", href: "#overview", icon: "grid" },
  { label: "My cases", href: "#cases", icon: "briefcase" },
  { label: "Evidence vault", href: "#evidence", icon: "folder" },
  { label: "Chain of custody", href: "#custody", icon: "link" },
  { label: "Forensic notes", href: "#notes", icon: "document" },
  { label: "Reports", href: "#reports", icon: "file" },
  { label: "Activity & audit", href: "#activity", icon: "activity" },
  { label: "System status", href: "#system", icon: "server" },
];

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function shortenHash(value: string) {
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

export default function Home() {
  const [token, setToken] = useState(() => (
    typeof window === "undefined" ? "" : window.sessionStorage.getItem("trace-bearer-token") ?? ""
  ));
  const [tokenDraft, setTokenDraft] = useState(() => (
    typeof window === "undefined" ? "" : window.sessionStorage.getItem("trace-bearer-token") ?? ""
  ));
  const [user, setUser] = useState<User | null>(null);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [caseId, setCaseId] = useState("");
  const [clientHash, setClientHash] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const [verification, setVerification] = useState<Record<string, Verification>>({});

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    Promise.all([
      fetch(`${API_URL}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      }),
      fetch(`${API_URL}/api/v1/evidence?limit=100`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      }),
    ])
      .then(async ([userResponse, evidenceResponse]) => {
        if (!userResponse.ok || !evidenceResponse.ok) {
          throw new Error("The API rejected the current bearer token.");
        }
        const nextUser = (await userResponse.json()) as User;
        const result = (await evidenceResponse.json()) as ApiResult;
        setUser(nextUser);
        setEvidence(result.items);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setUser(null);
          setEvidence([]);
          setError(reason instanceof Error ? reason.message : "Unable to load workspace data.");
        }
      })
    return () => controller.abort();
  }, [token]);

  const filteredEvidence = useMemo(
    () =>
      evidence.filter((item) =>
        [item.file_name, item.case_id, item.evidence_id, item.file_sha256]
          .join(" ")
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [evidence, query],
  );

  function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextToken = tokenDraft.trim();
    if (!nextToken) return;
    window.sessionStorage.setItem("trace-bearer-token", nextToken);
    setError("");
    setToken(nextToken);
  }

  function disconnect() {
    window.sessionStorage.removeItem("trace-bearer-token");
    setToken("");
    setTokenDraft("");
    setUser(null);
    setEvidence([]);
  }

  async function verify(item: Evidence) {
    const response = await fetch(`${API_URL}/api/v1/evidence/${item.evidence_id}/verify`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return;
    const result = (await response.json()) as Verification;
    setVerification((current) => ({ ...current, [item.evidence_id]: result }));
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
    setUploadMessage("");
  }

  async function registerEvidence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFile || !caseId.trim() || !clientHash.trim()) {
      setUploadMessage("Select a file, enter an authorized case ID, and provide the client SHA-256.");
      return;
    }
    setUploading(true);
    setUploadMessage("");
    const form = new FormData();
    form.append("file", selectedFile);
    form.append("case_id", caseId.trim());
    form.append("client_sha256", clientHash.trim());
    const response = await fetch(`${API_URL}/api/v1/evidence`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    setUploading(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { detail?: string };
      setUploadMessage(body.detail ?? "Evidence registration failed.");
      return;
    }
    setUploadMessage("Evidence registered. Refreshing the evidence vault.");
    setUploadOpen(false);
    setSelectedFile(null);
    setClientHash("");
    setCaseId("");
    setToken((current) => current);
    window.location.reload();
  }

  return (
    <div className="trace-shell">
      <aside className="trace-sidebar">
        <a className="trace-brand" href="#overview">
          <span className="trace-mark">T</span>
          <span><strong>TRACE</strong><small>FORENSIC EVIDENCE PLATFORM</small></span>
        </a>
        <p className="sidebar-intro">Tamper-proof Record Archive for Cryptographic Evidence</p>
        <p className="sidebar-label">WORKSPACE</p>
        <nav className="trace-nav" aria-label="Workspace navigation">
          {navItems.map((item, index) => (
            <a className={`trace-nav-link${index === 0 ? " active" : ""}`} href={item.href} key={item.label}>
              <Icon name={item.icon} size={16} /><span>{item.label}</span>
            </a>
          ))}
        </nav>
        <div className="trace-sidebar-footer">
          <div className="development-note"><span className="status-dot warning" /><span><strong>Development instance</strong><small>Do not store real evidence</small></span></div>
          {user ? <button className="profile-button" onClick={disconnect}><span className="avatar">{user.email.slice(0, 1).toUpperCase()}</span><span><strong>{user.email}</strong><small>{user.role}</small></span><Icon name="arrow-right" size={14} /></button> : <span className="profile-locked"><Icon name="lock" size={14} /> Not connected</span>}
        </div>
      </aside>

      <main className="trace-main">
        <header className="trace-topbar">
          <div><span className="crumb-muted">Local workspace</span><span className="crumb-divider">/</span><strong>Investigator dashboard</strong></div>
          <div className="topbar-actions"><SystemStatus compact /><a className="topbar-link" href={`${API_URL}/docs`} target="_blank" rel="noreferrer">API docs <Icon name="arrow-up-right" size={13} /></a></div>
        </header>

        <div className="trace-content" id="overview">
          <section className="hero-row">
            <div><p className="overline">INVESTIGATOR WORKSPACE / {user?.role ?? "READ-ONLY"}</p><h1>{user ? `Investigator workspace` : "Evidence register"}</h1><p className="hero-copy">Review authorized evidence records and run integrity checks against the stored object version.</p></div>
            <div className="hero-actions"><button className="button button-primary" onClick={() => setUploadOpen(true)} disabled={!user || user.role !== "INVESTIGATOR"}><Icon name="plus" size={16} /> Register evidence</button><a className="button button-quiet" href="#cases">View my cases <Icon name="arrow-right" size={15} /></a></div>
          </section>

          {!token && <section className="connect-panel"><div><p className="overline">AUTHENTICATED WORKSPACE</p><h2>Connect a bearer session</h2><p>Enter the development bearer token to load only data authorized by the TRACE API. The token remains in this browser session only.</p></div><form onSubmit={connect} className="connect-form"><label htmlFor="token">Bearer token</label><div><input id="token" type="password" value={tokenDraft} onChange={(event) => setTokenDraft(event.target.value)} placeholder="Paste a development token" /><button className="button button-primary" type="submit">Connect</button></div></form></section>}
          {error && <div className="inline-alert error"><Icon name="info" size={16} />{error}<button onClick={disconnect}>Clear session</button></div>}

          <section className="metric-grid" aria-label="Workspace metrics">
            <MetricCard icon="briefcase" label="Assigned cases" value="Unavailable" detail="No case-list endpoint is exposed." />
            <MetricCard icon="folder" label="Evidence records" value={token && !user && !error ? "…" : evidence.length.toString()} detail="Accessible records returned by the API." />
            <MetricCard icon="shield-check" label="Verified evidence" value="On demand" detail="Run an exact-version verification to establish status." />
            <MetricCard icon="activity" label="Recent activity" value="Unavailable" detail="Activity feed is not exposed by the API." />
          </section>

          <section className="workspace-grid">
            <div className="panel wide-panel" id="evidence">
              <div className="panel-heading"><div><p className="overline">AUTHORIZED RECORDS</p><h2>Evidence vault</h2><p>Evidence returned for the authenticated user&apos;s case memberships.</p></div><div className="search-box"><Icon name="scan" size={15} /><input aria-label="Search evidence" placeholder="Search evidence or case" value={query} onChange={(event) => setQuery(event.target.value)} /></div></div>
              <div className="table-wrap">
                <table className="trace-table"><thead><tr><th>Evidence</th><th>Case</th><th>Recorded SHA-256</th><th>Integrity</th><th>Received</th><th /></tr></thead><tbody>
                  {filteredEvidence.map((item) => <tr key={item.evidence_id}><td><a className="record-link" href={`${API_URL}/api/v1/evidence/${item.evidence_id}`} target="_blank" rel="noreferrer">{item.file_name}</a><small>{formatBytes(item.byte_size)} · {item.evidence_id.slice(0, 8)}</small></td><td><span className="case-chip">{item.case_id}</span></td><td><code title={item.file_sha256}>{shortenHash(item.file_sha256)}</code></td><td>{verification[item.evidence_id] ? <span className={`result ${verification[item.evidence_id].status === "PASS" ? "pass" : "fail"}`}>{verification[item.evidence_id].status}</span> : <button className="table-action" onClick={() => verify(item)} disabled={!user}>Verify</button>}</td><td>{formatDate(item.created_at)}</td><td><a className="icon-action" href={`${API_URL}/api/v1/evidence/${item.evidence_id}/download`} target="_blank" rel="noreferrer" aria-label={`Open ${item.file_name} download`}><Icon name="arrow-up-right" size={14} /></a></td></tr>)}
                  {(!token || error || filteredEvidence.length === 0) && <tr><td colSpan={6}><EmptyState title={query ? "No matching evidence" : "No evidence in this workspace"} detail={query ? "Try a different filename, case ID, or evidence ID." : "Authorized evidence will appear here after a successful registration."} /></td></tr>}
                </tbody></table>
              </div>
              <div className="panel-caption"><span>{evidence.length} records</span><span>Original files remain in object storage; this table contains metadata only.</span></div>
            </div>
            <aside className="panel custody-card" id="custody"><div className="panel-heading"><div><p className="overline">INTEGRITY WORKFLOW</p><h2>Chain of custody</h2></div><Icon name="link" size={20} /></div><div className="custody-empty"><Icon name="shield-check" size={25} /><strong>Verify an evidence record</strong><p>Ledger status and object digest results appear here after an authorized verification request.</p><a href="#evidence" className="text-link">Go to evidence vault <Icon name="arrow-right" size={14} /></a></div></aside>
          </section>

          <section className="lower-grid">
            <div className="panel" id="cases"><div className="panel-heading"><div><p className="overline">ACCESS SCOPE</p><h2>My cases</h2><p>Case enumeration is intentionally not exposed by the current API.</p></div><Icon name="briefcase" size={20} /></div><EmptyState title="Case list unavailable" detail="Use an authorized case ID with the evidence registration or report APIs. The backend does not currently expose a case-list endpoint." /></div>
            <div className="panel" id="system"><div className="panel-heading"><div><p className="overline">SERVICE OBSERVABILITY</p><h2>System status</h2><p>The health proxy checks API availability only.</p></div><SystemStatus /></div><div className="system-row"><span className="status-dot connected" /><span><strong>TRACE API</strong><small>Health endpoint response</small></span><SystemStatus compact /></div><div className="system-footnote">Database and object-storage health are not separately exposed by <code>/healthz</code>.</div></div>
          </section>
          <section className="panel quiet-section" id="notes"><div className="panel-heading"><div><p className="overline">ANALYSIS</p><h2>Forensic notes</h2><p>Analyst-only note endpoints are available through the API. This investigator workspace does not bypass that permission.</p></div><Icon name="document" size={20} /></div></section>
          <section className="panel quiet-section" id="reports"><div className="panel-heading"><div><p className="overline">DERIVED ARTIFACTS</p><h2>Reports</h2><p>Report generation and access are restricted to Analyst and Auditor roles by the backend.</p></div><Icon name="file" size={20} /></div></section>
          <section className="panel quiet-section" id="activity"><div className="panel-heading"><div><p className="overline">AUDITABILITY</p><h2>Activity &amp; audit</h2><p>No activity-feed endpoint is exposed. Custody events remain available on evidence detail and verification responses.</p></div><Icon name="activity" size={20} /></div></section>
          <footer className="trace-footer"><span><strong>TRACE</strong> · Tamper-proof Record Archive for Cryptographic Evidence</span><span>Local development · Not for operational use</span></footer>
        </div>
      </main>

      {uploadOpen && <div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="upload-title"><div className="modal-heading"><div><p className="overline">EVIDENCE REGISTRATION</p><h2 id="upload-title">Register original evidence</h2></div><button className="icon-action" onClick={() => setUploadOpen(false)} aria-label="Close dialog">×</button></div><p className="modal-copy">The server recalculates SHA-256 and records the exact object version. Client-provided hashes are used only for request validation.</p><form onSubmit={registerEvidence}><label htmlFor="case-id">Authorized case ID</label><input id="case-id" value={caseId} onChange={(event) => setCaseId(event.target.value)} placeholder="e.g. CASE-2026-001" /><label htmlFor="evidence-file">Evidence file</label><input id="evidence-file" type="file" onChange={onFileChange} /><label htmlFor="client-hash">Client SHA-256</label><input id="client-hash" value={clientHash} onChange={(event) => setClientHash(event.target.value)} placeholder="64-character hexadecimal digest" /><p className="form-hint">{selectedFile ? `${selectedFile.name} · ${formatBytes(selectedFile.size)}` : "No file selected."}</p>{uploadMessage && <div className="inline-alert">{uploadMessage}</div>}<div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setUploadOpen(false)}>Cancel</button><button type="submit" className="button button-primary" disabled={uploading}>{uploading ? "Registering…" : "Register evidence"}</button></div></form></section></div>}
    </div>
  );
}

function MetricCard({ icon, label, value, detail }: { icon: IconName; label: string; value: string; detail: string }) {
  return <article className="metric-card"><span className="metric-icon"><Icon name={icon} size={17} /></span><div><p>{label}</p><strong>{value}</strong><small>{detail}</small></div></article>;
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="empty-state"><Icon name="folder" size={19} /><strong>{title}</strong><p>{detail}</p></div>;
}
