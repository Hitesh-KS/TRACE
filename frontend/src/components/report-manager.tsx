"use client";

import { FormEvent, useState } from "react";
import { Icon } from "@/components/icon";

type ReportRole = "INVESTIGATOR" | "ANALYST" | "JUDGE";
type Report = { report_id: string; case_id: string; title: string; report_type: string; creator_id: string; created_at: string; file_sha256: string; byte_size: number };
const API_URL = process.env.NEXT_PUBLIC_TRACE_API_URL ?? "http://localhost:8000";
const TYPES: Record<ReportRole, string[]> = {
  INVESTIGATOR: ["EVIDENCE_REGISTRATION", "CHAIN_OF_CUSTODY", "INTEGRITY_VERIFICATION"],
  ANALYST: ["FORENSIC_EXAMINATION", "CHAIN_OF_CUSTODY", "INTEGRITY_VERIFICATION"],
  JUDGE: ["JUDICIAL_REVIEW", "CHAIN_OF_CUSTODY", "INTEGRITY_VERIFICATION"],
};

export function ReportManager({ role }: { role: ReportRole }) {
  const [token] = useState(() => typeof window === "undefined" ? "" : window.sessionStorage.getItem("trace-bearer-token") ?? "");
  const [caseId, setCaseId] = useState("");
  const [title, setTitle] = useState("");
  const [reportType, setReportType] = useState(TYPES[role][0]);
  const [reports, setReports] = useState<Report[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadReports() {
    if (!token || !caseId.trim()) return;
    const response = await fetch(`${API_URL}/api/v1/cases/${encodeURIComponent(caseId.trim())}/reports`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) { setMessage(`Reports could not be loaded (${response.status}).`); return; }
    setReports(((await response.json()) as { items: Report[] }).items);
  }
  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !caseId.trim() || !title.trim()) { setMessage("Enter a case ID and report title, then connect a bearer session."); return; }
    setBusy(true); setMessage("");
    const response = await fetch(`${API_URL}/api/v1/cases/${encodeURIComponent(caseId.trim())}/reports`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ title: title.trim(), report_type: reportType }) });
    const payload = await response.json().catch(() => ({})) as { detail?: string };
    setBusy(false);
    if (!response.ok) { setMessage(payload.detail ?? `Report generation failed (${response.status}).`); return; }
    setTitle(""); setMessage("Report generated from the current authorized records."); await loadReports();
  }

  async function download(report: Report) {
    if (!token) return;
    const response = await fetch(`${API_URL}/api/v1/reports/${report.report_id}/download`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) { setMessage(`Report download failed (${response.status}).`); return; }
    const objectUrl = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = objectUrl; link.download = `trace-report-${report.report_id}.pdf`; link.click(); URL.revokeObjectURL(objectUrl);
  }

  return <div className="report-manager"><div className="report-manager-heading"><div><p className="overline">REPORT GENERATION</p><h2>Case reports</h2><p>Generated from authorized case records and stored as a versioned PDF artifact.</p></div><Icon name="file" size={20} /></div><form className="report-form" onSubmit={generate}><label>Case ID<input required value={caseId} onChange={(event) => setCaseId(event.target.value)} placeholder="Enter an authorized case ID" /></label><label>Report title<input required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Report title" /></label><label>Report type<select value={reportType} onChange={(event) => setReportType(event.target.value)}>{TYPES[role].map((type) => <option key={type}>{type}</option>)}</select></label><div className="report-form-actions"><button className="button button-primary" disabled={busy}>{busy ? "Generating…" : "Generate PDF"}</button><button className="button button-quiet" type="button" onClick={() => void loadReports()} disabled={!token || !caseId.trim()}>Load reports</button></div></form>{message && <p className="report-message">{message}</p>}<div className="report-list">{reports.map((report) => <article className="report-row" key={report.report_id}><div><strong>{report.title}</strong><small>{report.report_type} · {new Date(report.created_at).toLocaleString()} · {report.file_sha256.slice(0, 10)}…</small></div><button className="table-action" onClick={() => void download(report)}>Download PDF</button></article>)}{caseId && reports.length === 0 && <p className="panel-placeholder">No reports loaded for this case.</p>}</div></div>;
}
