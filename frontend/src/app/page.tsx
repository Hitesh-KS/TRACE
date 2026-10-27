"use client";

import Link from "next/link";
import { Icon } from "@/components/icon";

const roles = [
  { label: "Investigator", detail: "Register, download, and verify evidence", href: "/investigator", icon: "folder" as const, available: true },
  { label: "Forensic Analyst", detail: "Upload and deeply examine evidence", href: "/analyst", icon: "scan" as const, available: true },
  { label: "Court / Auditor", detail: "Legal custody and independent review", href: "/judge", icon: "shield-check" as const, available: true },
  { label: "System Admin", detail: "Blind system administration", href: "/admin", icon: "lock" as const, available: true },
];

export default function RoleSelector() {
  return (
    <main className="role-selector-page">
      <section className="role-selector">
        <div className="role-selector-brand"><span className="trace-mark">T</span><span><strong>TRACE</strong><small>FORENSIC EVIDENCE PLATFORM</small></span></div>
        <p className="role-selector-copy">Tamper-proof Record Archive for Cryptographic Evidence</p>
        <p className="overline">LOCAL WORKSPACE / ROLE SELECTION</p>
        <h1>Select a workspace</h1>
        <p className="role-selector-copy">Choose the role workspace you want to inspect. The backend remains the authority for identity, permissions, and case access.</p>
        <div className="role-grid">
          {roles.map((role) => role.available ? (
            <Link className="role-card" href={role.href} key={role.label}><span className="role-icon"><Icon name={role.icon} size={20} /></span><span><strong>{role.label}</strong><small>{role.detail}</small></span><Icon name="arrow-right" size={16} /></Link>
          ) : (
            <div className="role-card unavailable" key={role.label}><span className="role-icon"><Icon name={role.icon} size={20} /></span><span><strong>{role.label}</strong><small>{role.detail}</small></span><span className="role-status">Unavailable</span></div>
          ))}
        </div>
      </section>
    </main>
  );
}
