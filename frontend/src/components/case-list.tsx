"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icon";

type CaseRecord = {
  case_id: string;
  name: string | null;
  description: string | null;
  created_at: string;
};

export function CaseList({ role }: { role: "investigator" | "analyst" | "judge" }) {
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/trace/${role}/api/v1/cases`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => ({})) as { detail?: string };
          throw new Error(payload.detail ?? `Cases could not be loaded (${response.status}).`);
        }
        const result = await response.json() as { items: CaseRecord[] };
        setCases(result.items);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : "Cases could not be loaded.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [role]);

  return (
    <section className="panel" id="cases">
      <div className="panel-heading">
        <div>
          <p className="overline">AUTHORIZED CASES</p>
          <h2>My cases</h2>
          <p>Only cases assigned to this account are listed.</p>
        </div>
        <Icon name="briefcase" size={20} />
      </div>
      {error ? <div className="inline-alert error">{error}</div> : null}
      {loading ? (
        <p className="panel-placeholder">Loading authorized cases…</p>
      ) : cases.length ? (
        <div className="case-list">
          {cases.map((item) => (
            <article className="case-list-item" key={item.case_id}>
              <span className="metric-icon"><Icon name="briefcase" size={16} /></span>
              <div>
                <strong>{item.name || item.case_id}</strong>
                <small>{item.case_id}{item.description ? ` · ${item.description}` : ""}</small>
              </div>
            </article>
          ))}
        </div>
      ) : !error ? (
        <div className="empty-state">
          <Icon name="folder" size={19} />
          <strong>No assigned cases</strong>
          <p>An administrator must assign this account to a case.</p>
        </div>
      ) : null}
    </section>
  );
}
