import { Icon, type IconName } from "@/components/icon";
import { SystemStatus } from "@/components/system-status";

const navigation: { label: string; href: string; icon: IconName }[] = [
  { label: "Evidence register", href: "#evidence", icon: "folder" },
  { label: "Cases", href: "#cases", icon: "briefcase" },
  { label: "Chain of custody", href: "#activity", icon: "link" },
];

export default function Home() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#evidence">
          <span className="brand-monogram">T</span>
          <span className="brand-copy">
            <strong>TRACE</strong>
            <span>RECORD ARCHIVE</span>
          </span>
        </a>

        <div className="project-name">
          Tamper-proof Record Archive for Cryptographic Evidence
        </div>

        <div className="workspace-label">LOCAL WORKSPACE</div>
        <nav className="sidebar-nav" aria-label="Main navigation">
          {navigation.map((item, index) => (
            <a
              className={`nav-link${index === 0 ? " active" : ""}`}
              href={item.href}
              key={item.label}
            >
              <Icon name={item.icon} size={16} />
              <span>{item.label}</span>
            </a>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="environment-label">
            <span className="environment-dot" />
            <span>
              <strong>Development environment</strong>
              <small>Do not store real evidence</small>
            </span>
          </div>
          <div className="sidebar-version">PS 18 · TRACE</div>
        </div>
      </aside>

      <main className="main-panel" id="evidence">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Local workspace</span>
            <span className="breadcrumb-divider">/</span>
            <strong>Evidence register</strong>
          </div>
          <a
            className="docs-link"
            href="http://localhost:8000/docs"
            target="_blank"
            rel="noreferrer"
          >
            API documentation <Icon name="arrow-up-right" size={14} />
          </a>
        </header>

        <div className="dashboard">
          <section className="page-heading">
            <div>
              <p className="eyebrow">PS 18 / DIGITAL EVIDENCE VAULT</p>
              <h1>Evidence register</h1>
              <p className="page-subtitle">
                Preserve original files and review their recorded custody.
              </p>
            </div>
            <SystemStatus />
          </section>

          <section className="notice" aria-label="Development notice">
            <Icon name="info" size={17} />
            <p>
              <strong>Development instance.</strong> This workspace is for
              software evaluation only. Do not upload real or sensitive
              evidence.
            </p>
          </section>

          <section className="panel register-panel">
            <div className="section-heading">
              <div>
                <h2>Evidence items</h2>
                <p>Files accepted into this local archive</p>
              </div>
              <a
                className="text-link"
                href="http://localhost:8000/docs"
                target="_blank"
                rel="noreferrer"
              >
                View API documentation
                <Icon name="arrow-up-right" size={14} />
              </a>
            </div>

            <div className="table-scroll">
              <table className="evidence-table">
                <thead>
                  <tr>
                    <th scope="col">Evidence</th>
                    <th scope="col">Case</th>
                    <th scope="col">SHA-256</th>
                    <th scope="col">Status</th>
                    <th scope="col">Received</th>
                  </tr>
                </thead>
              </table>
            </div>
            <div className="empty-register">
              <p className="empty-title">No evidence in this archive</p>
              <p>
                Evidence items will appear here after a successful upload
                through the API.
              </p>
              <a
                className="button button-secondary"
                href="http://localhost:8000/docs#/default/upload_evidence_api_v1_evidence_post"
                target="_blank"
                rel="noreferrer"
              >
                Open upload endpoint <Icon name="arrow-up-right" size={14} />
              </a>
            </div>
            <div className="table-caption">
              <span>0 records</span>
              <span>Original files are stored separately from this register.</span>
            </div>
          </section>

          <div className="lower-grid">
            <section className="panel status-panel" id="cases">
              <div className="section-heading">
                <div>
                  <h2>Service status</h2>
                  <p>Checks available from this application</p>
                </div>
              </div>
              <div className="service-row">
                <span className="service-name">TRACE API</span>
                <span className="service-detail">Health endpoint</span>
                <SystemStatus />
              </div>
              <p className="service-footnote">
                Storage and database health are not yet exposed by the health
                endpoint.
              </p>
            </section>

            <section className="panel custody-panel" id="activity">
              <div className="section-heading">
                <div>
                  <h2>Chain of custody</h2>
                  <p>Recorded actions for evidence in this archive</p>
                </div>
              </div>
              <div className="empty-custody">
                No custody events to display.
              </div>
            </section>
          </div>

          <footer className="page-footer">
            <span>
              <strong>TRACE</strong> — Tamper-proof Record Archive for
              Cryptographic Evidence
            </span>
            <span>Local development · Not for operational use</span>
          </footer>
        </div>
      </main>
    </div>
  );
}
