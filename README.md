# TRACE

TRACE stands for **Tamper-proof Record Archive for Cryptographic Evidence**. It is a digital evidence vault. The initial application includes a Next.js investigator dashboard and a FastAPI backend for authenticated evidence upload, independent server-side SHA-256 calculation, versioned S3-compatible object storage with retention settings, and a per-evidence hash-linked custody ledger with stored-object verification.

> **Development status:** This is an early development build, not a production or legal-compliance certification. The local Compose credentials are for development only. Authentication is a single configured bearer token and actor identity; production requires an identity provider, per-user authorization, security review, database migrations, monitoring, recovery procedures, and jurisdiction-specific legal review.

The current slice does not yet include a web UI, metadata extraction, PDF reports, externally anchored ledger checkpoints, or ingest idempotency/reconciliation. Evidence access is scoped to explicit database-backed case memberships; unassigned users fail closed.

## Run locally

Requirements: Docker Engine and Docker Compose.

```bash
cp .env.example .env
```

Replace `TRACE_API_TOKEN` in `.env` with a secret of at least 32 characters, then start the services:

```bash
docker compose up --build
```

Open the dashboard at `http://localhost:3000`. The API is available at `http://localhost:8000`; interactive API documentation is at `http://localhost:8000/docs`. The dashboard displays live API health and empty states until evidence is added.

### Authentication

The API supports database-backed accounts with Argon2id password hashing and
short-lived bearer sessions. Registration creates an `INVESTIGATOR` account;
role elevation is not available through public registration.

```bash
curl -X POST http://localhost:8000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"investigator@example.test","password":"a-password-at-least-12-characters"}'

curl -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"investigator@example.test","password":"a-password-at-least-12-characters"}'
```

Use the returned `access_token` as a bearer token for `/api/v1/auth/me` and
evidence endpoints. `POST /api/v1/auth/logout` revokes the current session.
The configured `TRACE_API_TOKEN` remains available for local development and
maps to `TRACE_ACTOR_ID`; it is not production authentication. The configured
actor must also have a row in `case_memberships` to access evidence.

### Case authorization

`case_memberships` associates a user UUID with a case ID. Registration never
creates memberships, and `ADMIN` is not an evidence-access bypass. Provision
case memberships through a reviewed administrative/database setup process before
an account can upload, verify, or inspect evidence for that case. Existing
evidence without an established membership is inaccessible through the API.

The development app can still create tables with `Base.metadata.create_all`.
For managed databases, use the forward-only Alembic migrations:

```bash
cd backend
alembic upgrade head
```

For a database created by the earlier `create_all` implementation, back it up,
verify that it matches the baseline schema, then run:

```bash
alembic stamp 0001_initial
alembic upgrade head
```

The case migration creates `Case` rows for existing distinct evidence case
identifiers so the new foreign key can be established, but it does not create
user memberships. Review the schema before stamping; do not stamp an
incompatible or incomplete database.

Migration `0004_evidence_uploader` adds a nullable uploader foreign key so
existing evidence remains migratable without inventing historical ownership.
New uploads record the authenticated submitting user; legacy rows remain
unattributed until they are reviewed and provisioned separately.

Migration `0005_forensic_notes` adds append-only analyst findings. Analysts
with explicit membership in an evidence case can create, list, and retrieve
notes through `/api/v1/evidence/{evidence_id}/notes`; the API derives the
case and author from the authorized evidence and authenticated session. Notes
do not modify evidence hashes or append custody-ledger events.

Migration `0006_case_reports` adds report metadata storage. Analysts and
auditors with case membership can generate, list, retrieve, and download
ReportLab PDF reports through:

```text
POST /api/v1/cases/{case_id}/reports
GET  /api/v1/cases/{case_id}/reports
GET  /api/v1/reports/{report_id}
GET  /api/v1/reports/{report_id}/download
```

PDF bytes are stored in MinIO and metadata plus the final PDF SHA-256 digest
are stored in PostgreSQL. Report generation verifies each exact evidence
object version before including its result. If database persistence fails
after PDF upload, the API attempts to remove the newly uploaded object and
logs cleanup failures.

The local stack uses MinIO with Object Lock enabled to exercise the S3 API. It runs as a single-drive local development instance; it is not a production storage topology or substitute for testing the selected production provider and retention policy. The MinIO console is at `http://localhost:9001`.

## Backend endpoint authorization

| Endpoint | Authentication and authorization | Storage/ledger behavior |
|---|---|---|
| `GET /healthz` | Public health check | No evidence access |
| `POST /api/v1/auth/register` | Public; always creates `INVESTIGATOR` | No ledger event |
| `POST /api/v1/auth/login` | Public; creates a database-backed session | No ledger event |
| `POST /api/v1/auth/logout` | Authenticated current session | Revokes session only |
| `GET /api/v1/auth/me` | Authenticated current session | No ledger event |
| `POST /api/v1/admin/cases` | Authenticated `ADMIN` | Creates case metadata only |
| `POST /api/v1/admin/case-memberships` | Authenticated `ADMIN`; target user and case must exist | Creates membership only |
| `POST /api/v1/evidence` | Authenticated `INVESTIGATOR` with membership in the submitted case | Stores the object, then appends `INGEST` |
| `GET /api/v1/evidence` | Authenticated `INVESTIGATOR`, `ANALYST`, or `AUDITOR` with case membership | Returns authorized metadata only |
| `GET /api/v1/evidence/{evidence_id}` | Authenticated `INVESTIGATOR`, `ANALYST`, or `AUDITOR` with case membership | Returns authorized metadata and custody summaries |
| `GET /api/v1/evidence/{evidence_id}/download` | Authenticated `ANALYST` with case membership; `ADMIN` is denied | Reads the exact object version and records `INITIATED` download audit |
| `GET /api/v1/evidence/{evidence_id}/verify` | Authenticated `INVESTIGATOR`, `ANALYST`, or `AUDITOR` with membership; `ADMIN` is denied | Reads the exact object version, validates the chain, then appends `VERIFY` |

Evidence lookups join against `case_memberships` before object storage reads.
Out-of-scope evidence returns `404` to avoid disclosing its existence.
Membership provisioning is intentionally limited to the explicit admin
endpoints; there is no self-assignment or public role-management path.

## Upload evidence

Calculate the SHA-256 digest locally, then submit it with the file and case ID:

```bash
sha256sum ./sample.bin
curl -X POST http://localhost:8000/api/v1/evidence \
  -H "Authorization: Bearer $TRACE_API_TOKEN" \
  -F "file=@./sample.bin" \
  -F "case_id=case-001" \
  -F "client_sha256=<64-character-sha256>"
```

The API streams the file to a bounded temporary spool, independently checks the digest, and writes the original bytes to a versioned Object-Locked MinIO bucket with configured retention. An `INGEST` event is committed with the evidence record.

## Verify evidence

```bash
curl -H "Authorization: Bearer $TRACE_API_TOKEN" \
  http://localhost:8000/api/v1/evidence/<evidence-id>/verify
```

Verification checks the complete ledger chain and re-hashes the exact object version recorded at ingest. Storage failures return an error rather than a false `PASS` or `FAIL`.

## Run tests

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r backend/requirements.txt
cd backend
PYTHONPATH=. pytest
```

Tests use SQLite and an in-memory object store. The local Compose deployment
uses PostgreSQL and MinIO. Object storage and database writes are not atomic:
if the database commit fails after an object upload, the API reports a
reconciliation-required error and logs the object key/version for an
operator-managed reconciliation process.
