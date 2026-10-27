"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { SystemStatus } from "@/components/system-status";
import { ReportManager } from "@/components/report-manager";

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
type ApiResult = { items: Evidence[] };

const API_URL = process.env.NEXT_PUBLIC_TRACE_API_URL ?? "http://localhost:8000";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function JudgeDashboard() {
  const [token] = useState(() => typeof window === "undefined" ? "" : window.sessionStorage.getItem("trace-bearer-token") ?? "");
  const [user, setUser] = useState<User | null>(null);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [selected, setSelected] = useState<Evidence | null>(null);
  const [verification, setVerification] = useState<Record<string, Verification>>({});
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(() => Boolean(typeof window !== "undefined" && window.sessionStorage.getItem("trace-bearer-token")));

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    Promise.all([
      fetch(`${API_URL}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal }),
      fetch(`${API_URL}/api/v1/evidence?limit=100`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal }),
    ])
      .then(async ([userResponse, evidenceResponse]) => {
        const nextUser = userResponse.ok ? (await userResponse.json() as User) : null;
        if (!evidenceResponse.ok) {
          throw new Error(evidenceResponse.status === 403
            ? "The backend does not currently authorize the JUDGE role for evidence review."
            : `Evidence review could not be loaded (${evidenceResponse.status}).`);
        }
        setUser(nextUser);
        setEvidence((await evidenceResponse.json() as ApiResult).items);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to load judicial review data.");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [token]);

  const filtered = useMemo(() => evidence.filter((item) =>
    [item.file_name, item.case_id, item.evidence_id, item.file_sha256].join(" ").toLowerCase().includes(query.toLowerCase()),
  ), [evidence, query]);

  async function verify(item: Evidence) {
    setError("");
    const response = await fetch(`${API_URL}/api/v1/evidence/${item.evidence_id}/verify`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      setError(`Integrity verification could not be completed (${response.status}).`);
      return;
    }
    const result = await response.json() as Verification;
    setVerification((current) => ({ ...current, [item.evidence_id]: result }));
  }

  return (
    <div className="trace-shell">
      <aside className="trace-sidebar">
        <Link className="trace-brand" href="/"><span className="trace-mark">T</span><span><strong>TRACE</strong><small>FORENSIC EVIDENCE PLATFORM</small></span></Link>
        <p className="sidebar-intro">Tamper-proof Record Archive for Cryptographic Evidence</p>
        <p className="sidebar-label">JUDICIAL REVIEW</p>
        <nav className="trace-nav" aria-label="Judicial review navigation">
          <a className="trace-nav-link active" href="#overview"><Icon name="grid" size={16} />Overview</a>
          <a className="trace-nav-link" href="#cases"><Icon name="briefcase" size={16} />Cases</a>
          <a className="trace-nav-link" href="#evidence"><Icon name="folder" size={16} />Evidence review</a>
          <a className="trace-nav-link" href="#integrity"><Icon name="shield-check" size={16} />Integrity verification</a>
          <a className="trace-nav-link" href="#reports"><Icon name="file" size={16} />Forensic reports</a>
        </nav>
        <div className="trace-sidebar-footer"><div className="development-note"><span className="status-dot warning" /><span><strong>Read-only workspace</strong><small>Backend authorization applies</small></span></div></div>
      </aside>
      <main className="trace-main">
        <header className="trace-topbar"><div><span className="crumb-muted">Local workspace</span><span className="crumb-divider">/</span><strong>Judge dashboard</strong></div><div className="topbar-actions"><SystemStatus compact /><Link className="topbar-link" href="/">Role selection <Icon name="arrow-up-right" size={13} /></Link></div></header>
        <div className="trace-content">
          <section className="hero-row" id="overview"><div><p className="overline">JUDICIAL REVIEW / READ ONLY</p><h1>Judge Dashboard</h1><p className="hero-copy">Review authorized evidence and integrity results without altering evidence, notes, or custody records.</p></div></section>
          {!token && <div className="inline-alert"><Icon name="lock" size={16} />Connect a bearer session to request authorized judicial review data.</div>}
          {error && <div className="inline-alert error"><Icon name="info" size={16} />{error}</div>}
          {user && user.role !== "JUDGE" && <div className="inline-alert"><Icon name="info" size={16} />The authenticated account is <strong>{user.role}</strong>, not JUDGE. The selected workspace does not change server-side permissions.</div>}
          <section className="metric-grid">
            <Metric label="Accessible cases" value="Unavailable" detail="No case-list endpoint is currently exposed." icon="briefcase" />
            <Metric label="Evidence records" value={token && !error ? String(evidence.length) : "Unavailable"} detail="Calculated from the authorized evidence response." icon="folder" />
            <Metric label="Integrity checks" value={Object.keys(verification).length ? String(Object.keys(verification).length) : "Not run"} detail="Only completed API verification requests count." icon="shield-check" />
            <Metric label="Reports" value="Restricted" detail="Current API permits reports for Analysts and Auditors." icon="file" />
          </section>
          <section className="panel" id="cases"><div className="panel-heading"><div><p className="overline">CASE REVIEW</p><h2>Case access</h2><p>Case discovery is unavailable because the backend exposes no authorized case-list endpoint.</p></div><Icon name="briefcase" size={20} /></div><div className="empty-state"><Icon name="lock" size={19} /><strong>Case API not available</strong><p>A backend case-review endpoint and JUDGE authorization are required for case-level judicial review.</p></div></section>
          <section className="panel" id="evidence"><div className="panel-heading"><div><p className="overline">AUTHORIZED RECORDS</p><h2>Evidence review</h2><p>Records below are displayed only when the current bearer session is authorized by the API.</p></div><div className="search-box"><Icon name="scan" size={15} /><input aria-label="Search evidence" placeholder="Search evidence or case" value={query} onChange={(event) => setQuery(event.target.value)} /></div></div><div className="table-wrap"><table className="trace-table"><thead><tr><th>Evidence</th><th>Case</th><th>Hash</th><th>Size</th><th>Integrity</th></tr></thead><tbody>{filtered.map((item) => <tr key={item.evidence_id} onClick={() => setSelected(item)}><td><strong>{item.file_name}</strong><small>{item.evidence_id} · {formatDate(item.created_at)}</small></td><td><span className="case-chip">{item.case_id}</span></td><td><code title={item.file_sha256}>{item.file_sha256.slice(0, 10)}…{item.file_sha256.slice(-8)}</code></td><td>{formatBytes(item.byte_size)}</td><td>{verification[item.evidence_id] ? <span className={`result ${verification[item.evidence_id].status === "PASS" ? "pass" : "fail"}`}>{verification[item.evidence_id].status}</span> : <button className="table-action" onClick={(event) => { event.stopPropagation(); void verify(item); }} disabled={!token}>Verify</button>}</td></tr>)}{filtered.length === 0 && <tr><td colSpan={5}><div className="empty-state"><Icon name="folder" size={19} /><strong>{loading ? "Loading authorized evidence" : "No evidence available"}</strong><p>{error || "No authorized evidence records were returned."}</p></div></td></tr>}</tbody></table></div></section>
          <section className="lower-grid" id="integrity"><div className="panel"><div className="panel-heading"><div><p className="overline">SELECTED RECORD</p><h2>Evidence details</h2><p>Read-only metadata from the evidence API.</p></div><Icon name="scan" size={20} /></div>{selected ? <div className="detail-list"><div><span>Evidence ID</span><code>{selected.evidence_id}</code></div><div><span>Filename</span><strong>{selected.file_name}</strong></div><div><span>Case</span><strong>{selected.case_id}</strong></div><div><span>SHA-256</span><code className="hash-wrap">{selected.file_sha256}</code></div><div><span>Received</span><strong>{formatDate(selected.created_at)}</strong></div></div> : <p className="panel-placeholder">Select an evidence record to inspect its metadata.</p>}</div><div className="panel" id="reports"><ReportManager role="JUDGE" /></div></section>
        </div>
      </main>
    </div>
  );
}

function Metric({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: "briefcase" | "folder" | "shield-check" | "file" }) {
  return <article className="metric-card"><span className="metric-icon"><Icon name={icon} size={17} /></span><div><p>{label}</p><strong>{value}</strong><small>{detail}</small></div></article>;
}
