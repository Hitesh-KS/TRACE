"use client";

import { sha256 } from "@noble/hashes/sha2.js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/icon";
import styles from "./records-room.module.css";

type Role = "investigator" | "analyst" | "judge" | "admin";
type User = { id: string; email: string; role: string };
type CaseRecord = { case_id: string; name: string | null; description: string | null; created_at: string };
type AdminUser = { id: string; email: string; role: string; is_active: boolean };
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
type CustodyEvent = {
  sequence: number;
  action: string;
  timestamp: string;
};
type EvidenceDetail = Evidence & { custody_events?: CustodyEvent[] };
type Verification = {
  status: string;
  ledger_status: string;
  computed_hash?: string | null;
  verification_timestamp?: string;
};
type ApiResult = { items: Evidence[] };

const roles: { id: Role; label: string; description: string; backendRole: string }[] = [
  { id: "investigator", label: "Investigator", description: "Register evidence and verify intake", backendRole: "INVESTIGATOR" },
  { id: "analyst", label: "Forensic analyst", description: "Examine, download and document", backendRole: "ANALYST" },
  { id: "judge", label: "Court / legal auditor", description: "Review records and verify integrity", backendRole: "JUDGE" },
  { id: "admin", label: "System administrator", description: "Manage cases; no evidence access", backendRole: "ADMIN" },
];

const rolePermissions: Record<Role, { upload: boolean; download: boolean; verify: boolean }> = {
  investigator: { upload: true, download: false, verify: true },
  analyst: { upload: true, download: true, verify: true },
  judge: { upload: false, download: false, verify: true },
  admin: { upload: false, download: false, verify: false },
};

function apiPath(role: Role, path: string) {
  return `/api/trace/${role}${path}`;
}

async function responseError(response: Response) {
  try {
    const body: unknown = await response.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "detail" in body &&
      typeof body.detail === "string"
    ) return body.detail;
  } catch {
    // Fall through to the HTTP status.
  }
  return `Request failed (${response.status})`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown date"
    : new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function shortHash(value: string) {
  return value.length > 28 ? `${value.slice(0, 14)}…${value.slice(-10)}` : value;
}

async function hashFile(file: File, onProgress: (progress: number) => void) {
  const hash = sha256.create();
  const reader = file.stream().getReader();
  let read = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      read += value.byteLength;
      onProgress(file.size ? Math.min(100, Math.round((read / file.size) * 100)) : 100);
    }
  } finally {
    reader.releaseLock();
  }
  return Array.from(hash.digest(), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export default function RecordsRoomPage() {
  const [role, setRole] = useState<Role>("investigator");
  const [user, setUser] = useState<User | null>(null);
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [records, setRecords] = useState<Evidence[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<EvidenceDetail | null>(null);
  const [verification, setVerification] = useState<Verification | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [intakeStep, setIntakeStep] = useState<1 | 2>(1);
  const [caseId, setCaseId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [clientHash, setClientHash] = useState("");
  const [hashProgress, setHashProgress] = useState<number | null>(null);
  const [adminCaseId, setAdminCaseId] = useState("");
  const [adminCaseName, setAdminCaseName] = useState("");
  const [memberCaseId, setMemberCaseId] = useState("");
  const [memberUserId, setMemberUserId] = useState("");

  const selectedRole = roles.find((item) => item.id === role)!;
  const permissions = rolePermissions[role];
  const filteredRecords = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return records;
    return records.filter((item) =>
      [item.file_name, item.case_id, item.evidence_id, item.file_sha256]
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [records, query]);

  const loadWorkspace = useCallback(async (signal?: AbortSignal) => {
    try {
      const identityResponse = await fetch(apiPath(role, "/api/v1/auth/me"), {
        cache: "no-store",
        signal,
      });
      if (!identityResponse.ok) throw new Error(await responseError(identityResponse));
      const identity = await identityResponse.json() as User;
      setUser(identity);
      if (identity.role !== selectedRole.backendRole) {
        throw new Error(
          `This demo slot is configured for ${selectedRole.backendRole}, but the API token resolved to ${identity.role}.`,
        );
      }

      if (role === "admin") {
        const [casesResponse, usersResponse] = await Promise.all([
          fetch(apiPath(role, "/api/v1/admin/cases"), { cache: "no-store", signal }),
          fetch(apiPath(role, "/api/v1/admin/users"), { cache: "no-store", signal }),
        ]);
        if (!casesResponse.ok) throw new Error(await responseError(casesResponse));
        if (!usersResponse.ok) throw new Error(await responseError(usersResponse));
        const adminCases = ((await casesResponse.json()) as { items: CaseRecord[] }).items;
        setCases(adminCases);
        setAdminUsers(((await usersResponse.json()) as { items: AdminUser[] }).items);
        setRecords([]);
        setSelectedId("");
        return;
      }
      const [evidenceResponse, casesResponse] = await Promise.all([
        fetch(apiPath(role, "/api/v1/evidence?limit=100"), { cache: "no-store", signal }),
        fetch(apiPath(role, "/api/v1/cases"), { cache: "no-store", signal }),
      ]);
      if (!evidenceResponse.ok) throw new Error(await responseError(evidenceResponse));
      if (!casesResponse.ok) throw new Error(await responseError(casesResponse));
      const result = await evidenceResponse.json() as ApiResult;
      const authorizedCases = ((await casesResponse.json()) as { items: CaseRecord[] }).items;
      setCases(authorizedCases);
      setCaseId((current) =>
        authorizedCases.some((item) => item.case_id === current)
          ? current
          : authorizedCases[0]?.case_id ?? "",
      );
      setError("");
      setDetail(null);
      setRecords(result.items);
      setSelectedId((current) =>
        result.items.some((item) => item.evidence_id === current)
          ? current
          : result.items[0]?.evidence_id ?? "",
      );
    } catch (reason) {
      if (signal?.aborted) return;
      setError(reason instanceof Error ? reason.message : "Could not load this workspace.");
      setUser(null);
      setRecords([]);
      setCases([]);
      setAdminUsers([]);
      setSelectedId("");
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [role, selectedRole.backendRole]);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => loadWorkspace(controller.signal));
    return () => controller.abort();
  }, [loadWorkspace]);

  useEffect(() => {
    if (!selectedId || role === "admin") {
      return;
    }
    const controller = new AbortController();
    void fetch(apiPath(role, `/api/v1/evidence/${encodeURIComponent(selectedId)}`), {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response));
        setDetail(await response.json() as EvidenceDetail);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setDetail(null);
          setError(reason instanceof Error ? reason.message : "Could not load evidence details.");
        }
      });
    return () => controller.abort();
  }, [role, selectedId]);

  async function selectFile(nextFile: File | null) {
    setFile(nextFile);
    setClientHash("");
    setHashProgress(null);
    setError("");
    if (!nextFile) return;
    setHashProgress(0);
    try {
      setClientHash(await hashFile(nextFile, setHashProgress));
      setHashProgress(100);
    } catch {
      setError("Could not calculate the file digest in this browser.");
      setHashProgress(null);
    }
  }

  function openIntake() {
    setError("");
    setNotice("");
    setIntakeStep(1);
    setIntakeOpen(true);
  }

  async function submitIntake(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (intakeStep === 1) {
      if (!caseId.trim() || !file || !clientHash) return;
      setIntakeStep(2);
      return;
    }
    if (!file || !caseId.trim() || !clientHash) return;
    setWorking("intake");
    setError("");
    const formData = new FormData();
    formData.set("case_id", caseId.trim());
    formData.set("client_sha256", clientHash);
    formData.set("file", file, file.name);
    try {
      const response = await fetch(apiPath(role, "/api/v1/evidence"), {
        method: "POST",
        body: formData,
      });
      if (!response.ok) throw new Error(await responseError(response));
      setNotice("Evidence registered. The server independently calculated its digest.");
      setIntakeOpen(false);
      setFile(null);
      setClientHash("");
      setCaseId("");
      setRefreshing(true);
      await loadWorkspace();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Evidence intake failed.");
    } finally {
      setWorking("");
    }
  }

  async function verifySelected() {
    if (!detail || !permissions.verify) return;
    setWorking("verify");
    setError("");
    setVerification(null);
    try {
      const response = await fetch(
        apiPath(role, `/api/v1/evidence/${encodeURIComponent(detail.evidence_id)}/verify`),
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error(await responseError(response));
      setVerification(await response.json() as Verification);
      setRefreshing(true);
      await loadWorkspace();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Integrity verification failed.");
    } finally {
      setWorking("");
    }
  }

  async function submitAdmin(event: React.FormEvent<HTMLFormElement>, kind: "case" | "membership") {
    event.preventDefault();
    setWorking(kind);
    setError("");
    setNotice("");
    const path = kind === "case" ? "/api/v1/admin/cases" : "/api/v1/admin/case-memberships";
    const payload = kind === "case"
      ? { case_id: adminCaseId.trim(), name: adminCaseName.trim() || null }
      : { case_id: memberCaseId.trim(), user_id: memberUserId.trim() };
    try {
      const response = await fetch(apiPath(role, path), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(await responseError(response));
      setNotice(kind === "case" ? "Case created." : "Case membership assigned.");
      if (kind === "case") {
        setAdminCaseId("");
        setAdminCaseName("");
      } else {
        setMemberCaseId("");
        setMemberUserId("");
      }
      const casesResponse = await fetch(apiPath(role, "/api/v1/admin/cases"));
      if (!casesResponse.ok) throw new Error(await responseError(casesResponse));
      setCases(((await casesResponse.json()) as { items: CaseRecord[] }).items);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Administrative request failed.");
    } finally {
      setWorking("");
    }
  }

  return (
    <main className={styles.page}>
      <aside className={styles.sidebar}>
        <a className={styles.brand} href="/records-room" aria-label="TRACE records room home">
          <span className={styles.brandMark}>T</span>
          <span className={styles.brandText}><strong>TRACE</strong><small>RECORDS ROOM</small></span>
        </a>
        <div className={styles.caseLabel}>DIGITAL EVIDENCE ARCHIVE</div>
        <nav className={styles.navigation} aria-label="Records room navigation">
          <a className={`${styles.navItem} ${styles.navActive}`} href="#register"><Icon name="folder" size={17} />Evidence register</a>
          <a className={styles.navItem} href="#record"><Icon name="document" size={17} />Record details</a>
          <a className={styles.navItem} href="#custody"><Icon name="link" size={17} />Custody history</a>
        </nav>
        <div className={styles.sidebarBottom}>
          <span className={styles.localFlag}><span />LOCAL DEMONSTRATION</span>
          <p>Prototype interface. Do not upload real or sensitive evidence.</p>
        </div>
      </aside>

      <section className={styles.main}>
        <header className={styles.topbar}>
          <div className={styles.breadcrumb}><span>TRACE</span><span>/</span><strong>Evidence workspace</strong></div>
          <label className={styles.rolePicker}>
            <span>Demo role</span>
            <select
              aria-label="Select demo role"
              onChange={(event) => {
                setRole(event.target.value as Role);
                setUser(null);
                setCases([]);
                setAdminUsers([]);
                setRecords([]);
                setSelectedId("");
                setDetail(null);
                setVerification(null);
                setNotice("");
                setLoading(true);
                setError("");
              }}
              value={role}
            >
              {roles.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
        </header>

        <div className={styles.content}>
          <div className={styles.demoNotice}>
            <Icon name="info" size={17} />
            <p><strong>Demo role selector</strong> routes requests through configured role tokens. It is not authentication; the API still decides access for the configured account.</p>
          </div>

          <section className={styles.heading}>
            <div>
              <p className={styles.eyebrow}>CASEWORK / {selectedRole.backendRole}</p>
              <h1>{role === "admin" ? "System administration" : "Evidence register"}</h1>
              <p className={styles.intro}>{role === "admin" ? "Manage case boundaries without viewing evidence files." : "Register, inspect and verify evidence within the cases assigned to this workspace."}</p>
            </div>
            {permissions.upload && (
              <button className={styles.primaryButton} onClick={openIntake} type="button">
                <Icon name="plus" size={16} /> New intake
              </button>
            )}
          </section>

          {error && <div className={`${styles.message} ${styles.messageError}`} role="alert"><Icon name="info" size={16} /><span>{error}</span><button onClick={() => { setRefreshing(true); void loadWorkspace(); }} type="button">Retry</button></div>}
          {notice && <div className={`${styles.message} ${styles.messageSuccess}`} role="status"><Icon name="check" size={16} /><span>{notice}</span><button aria-label="Dismiss message" onClick={() => setNotice("")} type="button">×</button></div>}

          <div className={styles.identityLine}>
            <div className={styles.identityMark}>{user?.email?.slice(0, 1).toUpperCase() ?? "—"}</div>
            <div><strong>{user?.email ?? (loading ? "Connecting to TRACE…" : "Role identity unavailable")}</strong><span>{user?.role ?? selectedRole.backendRole} · {selectedRole.description}</span></div>
            <button className={styles.refreshButton} disabled={loading || refreshing} onClick={() => { setRefreshing(true); void loadWorkspace(); }} type="button"><Icon name="activity" size={15} />{refreshing ? "Refreshing…" : "Refresh"}</button>
          </div>

          {role === "admin" ? (
            <section className={styles.adminGrid}>
              <article className={styles.panel}>
                <div className={styles.panelHeading}><div><p className={styles.eyebrow}>CASE REGISTER</p><h2>Create a case</h2><p>Case administration only; this view has no evidence access.</p></div><Icon name="briefcase" size={19} /></div>
                <form className={styles.form} onSubmit={(event) => void submitAdmin(event, "case")}>
                  <label>Case identifier<input maxLength={200} onChange={(event) => setAdminCaseId(event.target.value)} required value={adminCaseId} placeholder="CASE-2026-001" /></label>
                  <label>Case name <span>Optional</span><input maxLength={255} onChange={(event) => setAdminCaseName(event.target.value)} value={adminCaseName} placeholder="Short case title" /></label>
                  <button className={styles.primaryButton} disabled={working === "case"} type="submit">{working === "case" ? "Creating…" : "Create case"}</button>
                </form>
              </article>
              <article className={styles.panel}>
                <div className={styles.panelHeading}><div><p className={styles.eyebrow}>ACCESS ADMINISTRATION</p><h2>Assign case membership</h2><p>Requires an existing case and user UUID.</p></div><Icon name="lock" size={19} /></div>
                <form className={styles.form} onSubmit={(event) => void submitAdmin(event, "membership")}>
                  <label>Case<select onChange={(event) => setMemberCaseId(event.target.value)} required value={memberCaseId}><option value="">Select a case</option>{cases.map((item) => <option key={item.case_id} value={item.case_id}>{item.name ? `${item.name} (${item.case_id})` : item.case_id}</option>)}</select></label>
                  <label>Active user<select onChange={(event) => setMemberUserId(event.target.value)} required value={memberUserId}><option value="">Select a user</option>{adminUsers.filter((item) => item.is_active).map((item) => <option key={item.id} value={item.id}>{item.email} · {item.role}</option>)}</select></label>
                  <button className={styles.primaryButton} disabled={working === "membership" || !cases.length || !adminUsers.some((item) => item.is_active)} type="submit">{working === "membership" ? "Assigning…" : "Assign membership"}</button>
                </form>
              </article>
              <div className={styles.blindNotice}><Icon name="lock" size={18} /><p><strong>Evidence access is not available in this role.</strong><span>The backend does not authorize administrators to list, inspect, download or verify evidence.</span></p></div>
            </section>
          ) : (
            <>
              <section className={styles.registerPanel} id="register">
                <div className={styles.panelHeading}>
                  <div><p className={styles.eyebrow}>AUTHORIZED RECORDS</p><h2>Evidence items</h2><p>Only evidence in cases accessible to the configured API identity appears here.</p></div>
                  <div className={styles.panelTools}>
                    <label className={styles.search}><Icon name="scan" size={15} /><input aria-label="Search evidence" onChange={(event) => setQuery(event.target.value)} placeholder="Search records" value={query} /></label>
                    <span className={styles.recordCount}>{filteredRecords.length} {filteredRecords.length === 1 ? "record" : "records"}</span>
                  </div>
                </div>
                <div className={styles.tableScroller}>
                  <table className={styles.table}>
                    <thead><tr><th>Evidence record</th><th>Case</th><th>SHA-256</th><th>Received</th><th>Status</th></tr></thead>
                    <tbody>
                      {filteredRecords.map((record) => (
                        <tr className={record.evidence_id === selectedId ? styles.selectedRow : ""} key={record.evidence_id}>
                              <td><button className={styles.recordSelect} onClick={() => { setSelectedId(record.evidence_id); setDetail(null); setVerification(null); }} type="button"><strong>{record.file_name}</strong><span>{record.evidence_id}</span></button></td>
                          <td><span className={styles.caseTag}>{record.case_id}</span></td>
                          <td><code title={record.file_sha256}>{shortHash(record.file_sha256)}</code></td>
                          <td>{formatDate(record.created_at)}</td>
                          <td><span className={styles.statusTag}>{record.status}</span></td>
                        </tr>
                      ))}
                      {loading && <tr><td className={styles.tableMessage} colSpan={5}>Loading records from the assigned case register…</td></tr>}
                      {!loading && filteredRecords.length === 0 && <tr><td className={styles.tableMessage} colSpan={5}>{error ? "Records could not be loaded." : query ? "No records match that search." : "No evidence is registered in the cases available to this role."}</td></tr>}
                    </tbody>
                  </table>
                </div>
                <div className={styles.tableFooter}><span>Original files remain in object storage.</span><span>Showing up to 100 records</span></div>
              </section>

              <section className={styles.detailGrid} id="record">
                <article className={styles.panel}>
                  <div className={styles.panelHeading}><div><p className={styles.eyebrow}>RECORD SUMMARY</p><h2>Selected evidence</h2></div>
                    {detail && <div className={styles.actions}>
                      {permissions.verify && <button className={styles.secondaryButton} disabled={working === "verify"} onClick={() => void verifySelected()} type="button"><Icon name="shield-check" size={15} />{working === "verify" ? "Verifying…" : "Verify integrity"}</button>}
                      {permissions.download && <a className={styles.secondaryButton} href={apiPath(role, `/api/v1/evidence/${encodeURIComponent(detail.evidence_id)}/download`)}><Icon name="arrow-up-right" size={15} />Download original</a>}
                    </div>}
                  </div>
                  {!selectedId ? <div className={styles.emptyDetails}><Icon name="document" size={21} /><strong>Select a record to inspect</strong><span>Evidence metadata and recorded custody events will appear here.</span></div>
                    : !detail ? <div className={styles.emptyDetails}>Loading evidence details…</div>
                    : <dl className={styles.details}>
                      <div><dt>File name</dt><dd>{detail.file_name}</dd></div>
                      <div><dt>Case ID</dt><dd>{detail.case_id}</dd></div>
                      <div><dt>Evidence ID</dt><dd><code>{detail.evidence_id}</code></dd></div>
                      <div><dt>File size</dt><dd>{formatBytes(detail.byte_size)}</dd></div>
                      <div><dt>Media type</dt><dd>{detail.content_type || "Not recorded"}</dd></div>
                      <div className={styles.hashDetail}><dt>Recorded SHA-256</dt><dd><code>{detail.file_sha256}</code></dd></div>
                      <div><dt>Received</dt><dd>{formatDate(detail.created_at)}</dd></div>
                    </dl>}
                  {verification && <div className={`${styles.verification} ${verification.status === "PASS" ? styles.verificationPass : styles.verificationFail}`} role="status">
                    <Icon name={verification.status === "PASS" ? "check" : "info"} size={17} />
                    <span><strong>Integrity {verification.status}</strong><small>Ledger {verification.ledger_status} · {verification.verification_timestamp ? formatDate(verification.verification_timestamp) : "just now"}</small></span>
                  </div>}
                </article>

                <article className={styles.panel} id="custody">
                  <div className={styles.panelHeading}><div><p className={styles.eyebrow}>AUDIT TRAIL</p><h2>Chain of custody</h2><p>Chronological events recorded for this evidence item.</p></div><Icon name="link" size={19} /></div>
                  {!detail ? <div className={styles.emptyDetails}>Select an evidence record to view its custody history.</div>
                    : detail.custody_events?.length ? <ol className={styles.timeline}>
                      {detail.custody_events.map((event) => <li key={`${event.sequence}-${event.action}`}>
                        <span className={styles.timelineMarker}><Icon name={event.action === "INGEST" ? "folder" : "activity"} size={15} /></span>
                        <div><strong>{event.action.replaceAll("_", " ")}</strong><span>Event {String(event.sequence).padStart(2, "0")}</span></div>
                        <time dateTime={event.timestamp}>{formatDate(event.timestamp)}</time>
                      </li>)}
                    </ol> : <div className={styles.emptyDetails}>No custody events were returned for this record.</div>}
                  <div className={styles.roleNote}><Icon name="info" size={14} /><span>{role === "judge" ? "Read-only review. Integrity checks do not modify evidence bytes." : role === "analyst" ? "Analysis downloads are recorded by the API." : "Intake and verification actions are enforced by the API."}</span></div>
                </article>
              </section>
            </>
          )}

          <footer className={styles.footer}><span>TRACE · Tamper-proof Record Archive for Cryptographic Evidence</span><span>Prototype interface · Local development only</span></footer>
        </div>
      </section>

      {intakeOpen && <div className={styles.overlay} onMouseDown={(event) => { if (event.target === event.currentTarget && working !== "intake") setIntakeOpen(false); }}>
        <section aria-labelledby="intake-title" aria-modal="true" className={styles.intakeDialog} role="dialog">
          <div className={styles.dialogHeader}>
            <div><p className={styles.eyebrow}>NEW EVIDENCE / STEP {intakeStep} OF 2</p><h2 id="intake-title">{intakeStep === 1 ? "Evidence intake" : "Review before registration"}</h2></div>
            <button aria-label="Close intake" className={styles.closeButton} disabled={working === "intake"} onClick={() => setIntakeOpen(false)} type="button">×</button>
          </div>
          <div className={styles.stepTrack}><span className={styles.stepDone}>1 · File &amp; case</span><span className={intakeStep === 2 ? styles.stepDone : ""}>2 · Review</span></div>
          <form className={styles.intakeForm} onSubmit={(event) => void submitIntake(event)}>
            {intakeStep === 1 ? <>
              <label>Assigned case<select onChange={(event) => setCaseId(event.target.value)} required value={caseId}><option value="">Select an assigned case</option>{cases.map((item) => <option key={item.case_id} value={item.case_id}>{item.name ? `${item.name} (${item.case_id})` : item.case_id}</option>)}</select></label>
              <label className={styles.fileDrop}>Original evidence file<input onChange={(event) => void selectFile(event.target.files?.[0] ?? null)} required type="file" />
                <span>{file ? <><strong>{file.name}</strong><small>{formatBytes(file.size)}</small></> : <><strong>Choose a file</strong><small>Use synthetic or non-sensitive data in this local prototype.</small></>}</span>
              </label>
              {hashProgress !== null && <div className={styles.hashProgress}><span>{hashProgress === 100 ? "Client SHA-256 calculated" : `Calculating client SHA-256 · ${hashProgress}%`}</span><progress max="100" value={hashProgress} /></div>}
              <p className={styles.formFootnote}>The browser calculates SHA-256 as a transfer check; the server independently calculates its own digest during intake.</p>
            </> : <>
              <div className={styles.reviewRow}><span>Case</span><strong>{caseId}</strong></div>
              <div className={styles.reviewRow}><span>Original file</span><strong>{file?.name}</strong></div>
              <div className={styles.reviewRow}><span>Size</span><strong>{file ? formatBytes(file.size) : ""}</strong></div>
              <div className={styles.reviewHash}><span>Client SHA-256</span><code>{clientHash}</code></div>
              <p className={styles.formFootnote}>Registering stores the original in versioned object storage and records an intake event. The API must authorize the configured user for this case.</p>
            </>}
            {error && <p className={styles.formError} role="alert">{error}</p>}
            <div className={styles.dialogActions}>
              {intakeStep === 2 && <button className={styles.secondaryButton} disabled={working === "intake"} onClick={() => setIntakeStep(1)} type="button">Back</button>}
              <button className={styles.primaryButton} disabled={working === "intake" || hashProgress !== 100 || !file || !caseId.trim() || !clientHash || !cases.length} type="submit">
                {working === "intake" ? "Registering…" : intakeStep === 1 ? "Review intake" : "Register evidence"}
                {intakeStep === 1 && <Icon name="arrow-right" size={15} />}
              </button>
            </div>
          </form>
        </section>
      </div>}
    </main>
  );
}
