import { Icon, type IconName } from "@/components/icon";
import { SystemStatus } from "@/components/system-status";

const navigation: { label: string; href: string; icon: IconName }[] = [
  { label: "Overview", href: "#overview", icon: "grid" },
  { label: "Evidence", href: "#evidence", icon: "folder" },
  { label: "Cases", href: "#cases", icon: "briefcase" },
];

const ledgerNavigation: { label: string; href: string; icon: IconName }[] = [
  { label: "Chain of custody", href: "#activity", icon: "link" },
  { label: "Verification reports", href: "#reports", icon: "document" },
];

const metrics = [
  {
    label: "Evidence items",
    value: "0",
    note: "Original files preserved",
    icon: "folder" as const,
    tone: "mint",
  },
  {
    label: "Active cases",
    value: "0",
    note: "Cases in this workspace",
    icon: "briefcase" as const,
    tone: "violet",
  },
  {
    label: "Integrity checks",
    value: "—",
    note: "No checks performed yet",
    icon: "scan" as const,
    tone: "amber",
  },
  {
    label: "Custody events",
    value: "0",
    note: "Recorded in the ledger",
    icon: "activity" as const,
    tone: "blue",
  },
];

function NavigationGroup({
  title,
  items,
}: {
  title: string;
  items: typeof navigation;
}) {
  return (
    <div className="nav-group">
      <p className="nav-group-title">{title}</p>
      {items.map((item, index) => (
        <a
          className={`nav-link${title === "Workspace" && index === 0 ? " active" : ""}`}
          href={item.href}
          key={item.label}
        >
          <Icon name={item.icon} size={17} />
          <span>{item.label}</span>
          {item.label === "Evidence" && <span className="nav-count">0</span>}
        </a>
      ))}
    </div>
  );
}

export default function Home() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#overview" aria-label="TRACE home">
          <span className="brand-mark">
            <Icon name="trace" size={23} />
          </span>
          <span className="brand-copy">
            <strong>trace</strong>
            <span>EVIDENCE VAULT</span>
          </span>
        </a>

        <div className="workspace-switcher">
          <span className="workspace-avatar">T</span>
          <span className="workspace-copy">
            <span>Workspace</span>
            <strong>Local environment</strong>
          </span>
          <Icon name="chevrons" size={15} />
        </div>

        <nav className="sidebar-nav" aria-label="Main navigation">
          <NavigationGroup title="Workspace" items={navigation} />
          <NavigationGroup title="Verification" items={ledgerNavigation} />
        </nav>

        <div className="sidebar-bottom">
          <div className="storage-mini">
            <div className="storage-mini-icon">
              <Icon name="database" size={17} />
            </div>
            <div className="storage-mini-copy">
              <span>Vault storage</span>
              <SystemStatus compact />
            </div>
            <span className="storage-dot" />
          </div>
          <div className="sidebar-profile">
            <span className="profile-avatar">I</span>
            <span className="profile-copy">
              <strong>Investigator</strong>
              <span>Local development</span>
            </span>
            <Icon name="more" size={18} />
          </div>
        </div>
      </aside>

      <main className="main-panel" id="overview">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Workspace</span>
            <Icon name="chevron-right" size={14} />
            <strong>Overview</strong>
          </div>
          <div className="topbar-actions">
            <span className="environment-badge">
              <span />
              Development
            </span>
            <a className="icon-button help-button" href="http://localhost:8000/docs" target="_blank" rel="noreferrer" aria-label="Open API documentation">
              <Icon name="help" size={18} />
            </a>
            <span className="topbar-divider" />
            <span className="topbar-avatar" aria-label="Investigator">I</span>
          </div>
        </header>

        <div className="dashboard">
          <section className="page-heading">
            <div>
              <p className="eyebrow">YOUR SECURE WORKSPACE</p>
              <h1>Evidence overview</h1>
              <p className="page-subtitle">
                A clear view of your evidence, integrity, and chain of custody.
              </p>
            </div>
            <a
              className="button button-primary"
              href="http://localhost:8000/docs"
              target="_blank"
              rel="noreferrer"
            >
              <Icon name="plus" size={17} />
              Start an intake
              <Icon name="arrow-up-right" size={15} />
            </a>
          </section>

          <section className="welcome-card" aria-label="Vault status">
            <div className="welcome-content">
              <div className="welcome-overline">
                <span className="welcome-sparkle"><Icon name="sparkle" size={14} /></span>
                YOUR EVIDENCE, ACCOUNTED FOR
              </div>
              <h2>Integrity starts<br />with every detail.</h2>
              <p>
                Evidence in TRACE is independently hashed, version-preserved,
                and traceable through a verifiable custody ledger.
              </p>
              <a className="welcome-link" href="#evidence">
                Explore your vault <Icon name="arrow-right" size={15} />
              </a>
            </div>
            <div className="welcome-visual" aria-hidden="true">
              <div className="orbit orbit-one" />
              <div className="orbit orbit-two" />
              <div className="orbit orbit-three" />
              <div className="shield-disc">
                <Icon name="shield-check" size={48} />
              </div>
              <span className="orbit-node node-one"><Icon name="check" size={13} /></span>
              <span className="orbit-node node-two"><Icon name="link" size={13} /></span>
              <span className="orbit-node node-three"><Icon name="fingerprint" size={15} /></span>
            </div>
            <div className="welcome-index">TRACE / 001</div>
          </section>

          <section className="metrics-grid" aria-label="Workspace summary">
            {metrics.map((metric) => (
              <article className="metric-card" key={metric.label}>
                <div className="metric-top">
                  <span>{metric.label}</span>
                  <span className={`metric-icon ${metric.tone}`}>
                    <Icon name={metric.icon} size={17} />
                  </span>
                </div>
                <strong className="metric-value">{metric.value}</strong>
                <span className="metric-note">{metric.note}</span>
              </article>
            ))}
          </section>

          <div className="content-grid">
            <section className="panel evidence-panel" id="evidence">
              <div className="panel-heading">
                <div>
                  <h2>Recent evidence</h2>
                  <p>Your latest ingested evidence items</p>
                </div>
                <a className="text-link" href="http://localhost:8000/docs" target="_blank" rel="noreferrer">
                  API docs <Icon name="arrow-up-right" size={14} />
                </a>
              </div>
              <div className="empty-state">
                <div className="empty-illustration" aria-hidden="true">
                  <span className="empty-file"><Icon name="file" size={26} /></span>
                  <span className="empty-plus"><Icon name="plus" size={15} /></span>
                </div>
                <h3>Your evidence vault is ready</h3>
                <p>
                  Once your first evidence item is ingested, its file hash and
                  custody history will appear here.
                </p>
                <a className="button button-secondary" href="http://localhost:8000/docs" target="_blank" rel="noreferrer">
                  Open upload endpoint <Icon name="arrow-up-right" size={14} />
                </a>
              </div>
            </section>

            <section className="panel system-panel" id="cases">
              <div className="panel-heading">
                <div>
                  <h2>Vault status</h2>
                  <p>Local services at a glance</p>
                </div>
                <span className="status-icon"><Icon name="shield-check" size={17} /></span>
              </div>
              <div className="service-list">
                <div className="service-row">
                  <span className="service-icon api-icon"><Icon name="server" size={16} /></span>
                  <span className="service-copy"><strong>TRACE API</strong><span>Evidence &amp; verification</span></span>
                  <SystemStatus />
                </div>
                <div className="service-row">
                  <span className="service-icon storage-icon"><Icon name="database" size={16} /></span>
                  <span className="service-copy"><strong>Object storage</strong><span>Versioned evidence vault</span></span>
                  <span className="service-tag">RUSTFS</span>
                </div>
                <div className="service-row">
                  <span className="service-icon ledger-icon"><Icon name="link" size={16} /></span>
                  <span className="service-copy"><strong>Custody ledger</strong><span>Hash-linked event records</span></span>
                  <span className="service-tag">POSTGRES</span>
                </div>
              </div>
              <div className="security-note">
                <Icon name="lock" size={15} />
                <span>Local development environment. Not for real evidence.</span>
              </div>
            </section>
          </div>

          <section className="panel activity-panel" id="activity">
            <div className="panel-heading">
              <div>
                <h2>Chain of custody</h2>
                <p>Every action, recorded and verifiable</p>
              </div>
              <span className="ledger-label"><Icon name="link" size={13} /> HASH-LINKED LEDGER</span>
            </div>
            <div className="activity-empty">
              <span className="activity-empty-icon"><Icon name="activity" size={17} /></span>
              <span>No custody events yet. Events will be recorded when evidence is ingested or verified.</span>
            </div>
          </section>

          <footer className="page-footer" id="reports">
            <span><span className="footer-mark">T</span> TRACE <span className="footer-separator">·</span> Digital Evidence Vault</span>
            <span>Built for integrity. Designed for accountability.</span>
          </footer>
        </div>
      </main>
    </div>
  );
}
