"use client";

import { useEffect, useState } from "react";

type Status = "checking" | "connected" | "unavailable";

export function SystemStatus({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/health", { cache: "no-store", signal: controller.signal })
      .then((response) => {
        setStatus(response.ok ? "connected" : "unavailable");
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus("unavailable");
      });

    return () => controller.abort();
  }, []);

  const label =
    status === "checking"
      ? "Checking API"
      : status === "connected"
        ? compact
          ? "API available"
          : "API available"
        : compact
          ? "API unavailable"
          : "API unavailable";

  return (
    <span className={`system-status ${status}${compact ? " compact" : ""}`} aria-live="polite">
      <span />
      {label}
    </span>
  );
}
