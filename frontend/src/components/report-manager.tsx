"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/icon";

type ReportRole = "INVESTIGATOR" | "ANALYST" | "JUDGE";
type Report = { report_id: string; case_id: string; title: string; report_type: string; creator_id: string; created_at: string; file_sha256: string; byte_size: number };
type CaseRecord = { case_id: string; name: string | null };
const TYPES: Record<ReportRole, string[]> = {
  INVESTIGATOR: ["CHAIN_OF_CUSTODY"],
  ANALYST: ["FORENSIC_EXAMINATION"],
  JUDGE: ["JUDICIAL_REVIEW"],
};
const REPORT_LABELS: Record<string, string> = {
  CHAIN_OF_CUSTODY: "Standard custody report",
  FORENSIC_EXAMINATION: "Detailed technical log",
  JUDICIAL_REVIEW: "Legal custody export",
};
const REPORT_HELP: Record<ReportRole, string> = {
  INVESTIGATOR: "Standard chain-of-custody report for the authorized case.",
  ANALYST: "Detailed technical log with evidence metadata and ledger analysis.",
  JUDGE: "Legal custody export with an embedded verification QR code.",
};

export function ReportManager({ role }: { role: ReportRole }) {
  const API_URL = useMemo(() => `/api/trace/${role.toLowerCase()}`, [role]);
  const [caseId, setCaseId] = useState("");
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [title, setTitle] = useState("");
  const [reportType, setReportType] = useState(TYPES[role][0]);
  const [reports, setReports] = useState<Report[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingCases, setLoadingCases] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_URL}/api/v1/cases`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Authorized cases could not be loaded (${response.status}).`);
        const result = await response.json() as { items: CaseRecord[] };
        setCases(result.items);
        setCaseId((current) => current || result.items[0]?.case_id || "");
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setMessage(reason instanceof Error ? reason.message : "Authorized cases could not be loaded.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingCases(false);
      });
    return () => controller.abort();
  }, [API_URL]);

  const loadReports = useCallback(async (forCaseId: string) => {
    if (!forCaseId) {
      setReports([]);
      return;
    }
    try {
      const response = await fetch(`${API_URL}/api/v1/cases/${encodeURIComponent(forCaseId)}/reports`);
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { detail?: string };
        setReports([]);
        setMessage(payload.detail ?? `Reports could not be loaded (${response.status}).`);
        return;
      }
      setReports(((await response.json()) as { items: Report[] }).items);
      setMessage("");
    } catch (reason) {
      setReports([]);
      setMessage(reason instanceof Error ? reason.message : "Reports could not be loaded.");
    }
  }, [API_URL]);

  useEffect(() => {
    if (!caseId) return;
    void Promise.resolve().then(() => loadReports(caseId));
  }, [caseId, loadReports]);

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!caseId.trim() || !title.trim()) { setMessage("Enter a case ID and report title."); return; }
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`${API_URL}/api/v1/cases/${encodeURIComponent(caseId.trim())}/reports`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: title.trim(), report_type: reportType }) });
      const payload = await response.json().catch(() => ({})) as { detail?: string };
      if (!response.ok) { setMessage(payload.detail ?? `Report generation failed (${response.status}).`); return; }
      setTitle(""); setMessage("Report generated from the current authorized records."); await loadReports(caseId);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Report generation failed.");
    } finally {
      setBusy(false);
    }
  }

  async function download(report: Report) {
    try {
      const response = await fetch(`${API_URL}/api/v1/reports/${report.report_id}/download`);
      if (!response.ok) { setMessage(`Report download failed (${response.status}).`); return; }
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = objectUrl; link.download = `trace-report-${report.report_id}.pdf`; link.click(); URL.revokeObjectURL(objectUrl);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Report download failed.");
    }
  }

  return <div className="report-manager"><div className="report-manager-heading"><div><p className="overline">REPORT GENERATION</p><h2>Case reports</h2><p>{REPORT_HELP[role]}</p></div><Icon name="file" size={20} /></div><form className="report-form" onSubmit={generate}><label>Authorized case<select required value={caseId} onChange={(event) => setCaseId(event.target.value)} disabled={loadingCases || cases.length === 0}><option value="">{loadingCases ? "Loading cases…" : "Select an assigned case"}</option>{cases.map((item) => <option key={item.case_id} value={item.case_id}>{item.name ? `${item.name} (${item.case_id})` : item.case_id}</option>)}</select></label><label>Report title<input required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Report title" /></label><label>Report type<select value={reportType} onChange={(event) => setReportType(event.target.value)}>{TYPES[role].map((type) => <option key={type} value={type}>{REPORT_LABELS[type] ?? type}</option>)}</select></label><div className="report-form-actions"><button className="button button-primary" disabled={busy || !caseId}>{busy ? "Generating…" : "Generate PDF"}</button><button className="button button-quiet" type="button" onClick={() => void loadReports(caseId)} disabled={!caseId}>Refresh reports</button></div></form>{message && <p className="report-message">{message}</p>}<div className="report-list">{reports.map((report) => <article className="report-row" key={report.report_id}><div><strong>{report.title}</strong><small>{REPORT_LABELS[report.report_type] ?? report.report_type} · {new Date(report.created_at).toLocaleString()} · {report.file_sha256.slice(0, 10)}…</small></div><button className="table-action" onClick={() => void download(report)}>Download PDF</button></article>)}{!loadingCases && caseId && reports.length === 0 && !message && <p className="panel-placeholder">No reports exist for this case yet.</p>}{!loadingCases && cases.length === 0 && <p className="panel-placeholder">No assigned cases are available for report generation.</p>}</div></div>;
}
