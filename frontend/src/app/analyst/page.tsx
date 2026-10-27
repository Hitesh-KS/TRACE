"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { SystemStatus } from "@/components/system-status";
import { ReportManager } from "@/components/report-manager";

type Evidence = { evidence_id: string; case_id: string; file_name: string; file_sha256: string; created_at: string };
type Verification = { status: string };
type Note = { id: string; title: string; content: string; analyst_id: string; created_at: string };
const API_URL = process.env.NEXT_PUBLIC_TRACE_API_URL ?? "http://localhost:8000";

export default function AnalystDashboard() {
  const [token] = useState(() => typeof window === "undefined" ? "" : window.sessionStorage.getItem("trace-bearer-token") ?? "");
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [results, setResults] = useState<Record<string, Verification>>({});
  const [selectedEvidence, setSelectedEvidence] = useState<Evidence | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  useEffect(() => {
    if (!token) return;
    fetch(`${API_URL}/api/v1/evidence?limit=100`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => {
        if (!response.ok) throw new Error("The API rejected the current bearer session.");
        setEvidence(((await response.json()) as { items: Evidence[] }).items);
      })
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Unable to load evidence."));
  }, [token]);
  const filtered = useMemo(() => evidence.filter((item) => `${item.file_name} ${item.case_id} ${item.evidence_id}`.toLowerCase().includes(query.toLowerCase())), [evidence, query]);
  async function verify(id: string) {
    const response = await fetch(`${API_URL}/api/v1/evidence/${id}/verify`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) { setMessage(`Verification request failed (${response.status}).`); return; }
    const verification = (await response.json()) as Verification;
    setResults((current) => ({ ...current, [id]: verification }));
  }
  async function selectEvidence(item: Evidence) {
    setSelectedEvidence(item);
    if (!token) return;
    const response = await fetch(`${API_URL}/api/v1/evidence/${item.evidence_id}/notes`, { headers: { Authorization: `Bearer ${token}` } });
    if (response.ok) setNotes(((await response.json()) as { items: Note[] }).items);
  }
  async function createNote(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedEvidence || !token) return;
    const response = await fetch(`${API_URL}/api/v1/evidence/${selectedEvidence.evidence_id}/notes`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ title: noteTitle, content: noteContent }) });
    if (!response.ok) { setMessage(`Note creation failed (${response.status}).`); return; }
    const note = (await response.json()) as Note;
    setNotes((current) => [...current, note]);
    setNoteTitle(""); setNoteContent("");
  }
  return <div className="trace-shell">
    <aside className="trace-sidebar"><Link className="trace-brand" href="/"><span className="trace-mark">T</span><span><strong>TRACE</strong><small>FORENSIC EVIDENCE PLATFORM</small></span></Link><p className="sidebar-intro">Tamper-proof Record Archive for Cryptographic Evidence</p><p className="sidebar-label">ANALYST WORKSPACE</p><nav className="trace-nav"><Link className="trace-nav-link" href="/"><Icon name="grid" size={16} />Role selection</Link><a className="trace-nav-link active" href="#evidence"><Icon name="scan" size={16} />Evidence examination</a><a className="trace-nav-link" href="#notes"><Icon name="document" size={16} />Forensic notes</a><a className="trace-nav-link" href="#reports"><Icon name="file" size={16} />Reports</a><a className="trace-nav-link" href="#custody"><Icon name="link" size={16} />Chain of custody</a></nav><div className="trace-sidebar-footer"><div className="development-note"><span className="status-dot warning" /><span><strong>Development instance</strong><small>Do not store real evidence</small></span></div></div></aside>
    <main className="trace-main"><header className="trace-topbar"><div><span className="crumb-muted">Local workspace</span><span className="crumb-divider">/</span><strong>Analyst dashboard</strong></div><div className="topbar-actions"><SystemStatus compact /><Link className="topbar-link" href="/investigator">Investigator view <Icon name="arrow-up-right" size={13} /></Link></div></header>
      <div className="trace-content"><section className="hero-row"><div><p className="overline">FORENSIC EXAMINATION / ANALYST</p><h1>Evidence examination</h1><p className="hero-copy">Inspect authorized records, run exact-version integrity checks, and review analyst-owned artifacts.</p></div></section>
        {!token && <div className="inline-alert"><Icon name="lock" size={16} />Connect a valid bearer session from the Investigator workspace before requesting analyst data.</div>}
        {message && <div className="inline-alert error"><Icon name="info" size={16} />{message}</div>}
        <section className="metric-grid"><Metric label="Evidence records" value={token ? String(evidence.length) : "Unavailable"} detail="Authorized records returned by the API." icon="folder" /><Metric label="Integrity" value="On demand" detail="Verification is never inferred from metadata." icon="shield-check" /><Metric label="Forensic notes" value="API access" detail="Create and review notes per evidence record." icon="document" /><Metric label="Reports" value="API access" detail="Generate reports for authorized cases." icon="file" /></section>
        <section className="panel" id="evidence"><div className="panel-heading"><div><p className="overline">AUTHORIZED EXAMINATION SET</p><h2>Evidence records</h2><p>Only evidence returned for the authenticated analyst&apos;s memberships is shown.</p></div><div className="search-box"><Icon name="scan" size={15} /><input aria-label="Search evidence" placeholder="Search evidence or case" value={query} onChange={(event) => setQuery(event.target.value)} /></div></div><div className="table-wrap"><table className="trace-table"><thead><tr><th>Evidence</th><th>Case</th><th>Recorded hash</th><th>Verification</th><th>Received</th></tr></thead><tbody>{filtered.map((item) => <tr key={item.evidence_id} onClick={() => selectEvidence(item)}><td><strong>{item.file_name}</strong><small>{item.evidence_id}</small></td><td><span className="case-chip">{item.case_id}</span></td><td><code title={item.file_sha256}>{item.file_sha256.slice(0, 10)}…{item.file_sha256.slice(-8)}</code></td><td>{results[item.evidence_id] ? <span className={`result ${results[item.evidence_id].status === "PASS" ? "pass" : "fail"}`}>{results[item.evidence_id].status}</span> : <button className="table-action" onClick={() => verify(item.evidence_id)} disabled={!token}>Verify</button>}</td><td>{new Date(item.created_at).toLocaleString()}</td></tr>)}{filtered.length === 0 && <tr><td colSpan={5}><div className="empty-state"><Icon name="folder" size={19} /><strong>{token ? "No authorized evidence" : "No analyst session"}</strong><p>{message || "Connect a valid bearer session to load real evidence records."}</p></div></td></tr>}</tbody></table></div></section>
        <section className="lower-grid"><div className="panel" id="custody"><div className="panel-heading"><div><p className="overline">LEDGER REVIEW</p><h2>Chain of custody</h2><p>Ledger history is available through evidence detail and verification responses; no aggregate custody endpoint exists.</p></div><Icon name="link" size={20} /></div></div><div className="panel" id="notes"><div className="panel-heading"><div><p className="overline">ANALYST RECORDS</p><h2>Forensic notes</h2><p>Select an evidence record to review or append an observation.</p></div><Icon name="document" size={20} /></div>{selectedEvidence ? <><p className="selected-record">Selected: <strong>{selectedEvidence.file_name}</strong></p><div className="note-list">{notes.map((note) => <article className="note-item" key={note.id}><strong>{note.title}</strong><small>{new Date(note.created_at).toLocaleString()} · {note.analyst_id}</small><p>{note.content}</p></article>)}</div><form className="note-form" onSubmit={createNote}><input required value={noteTitle} onChange={(event) => setNoteTitle(event.target.value)} placeholder="Finding title" /><textarea required value={noteContent} onChange={(event) => setNoteContent(event.target.value)} placeholder="Detailed forensic observation" /><button className="button button-primary" type="submit">Append note</button></form></> : <p className="panel-placeholder">Choose an evidence row to load its notes.</p>}</div></section>
        <section className="panel quiet-section" id="reports"><ReportManager role="ANALYST" /></section>
      </div></main>
  </div>;
}

function Metric({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: "folder" | "shield-check" | "document" | "file" }) {
  return <article className="metric-card"><span className="metric-icon"><Icon name={icon} size={17} /></span><div><p>{label}</p><strong>{value}</strong><small>{detail}</small></div></article>;
}
