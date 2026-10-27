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
      ? "Checking"
      : status === "connected"
        ? compact
          ? "API connected"
          : "Connected"
        : compact
          ? "API offline"
          : "Unavailable";

  return (
    <span className={`system-status ${status}${compact ? " compact" : ""}`} aria-live="polite">
      <span />
      {label}
    </span>
  );
}
