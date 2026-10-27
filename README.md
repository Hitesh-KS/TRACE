# TRACE

TRACE stands for **Tamper-proof Record Archive for Cryptographic Evidence**. It is a digital evidence vault. The initial application includes a Next.js investigator dashboard and a FastAPI backend for authenticated evidence upload, independent server-side SHA-256 calculation, versioned S3-compatible object storage with retention settings, and a per-evidence hash-linked custody ledger with stored-object verification.

> **Development status:** This is an early development build, not a production or legal-compliance certification. The local Compose credentials are for development only. Authentication is a single configured bearer token and actor identity; production requires an identity provider, per-user authorization, security review, database migrations, monitoring, recovery procedures, and jurisdiction-specific legal review.

The current slice does not yet include a web UI, per-user/case authorization, metadata extraction, PDF reports, externally anchored ledger checkpoints, or ingest idempotency/reconciliation.

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
maps to `TRACE_ACTOR_ID`; it is not production authentication.

The local stack uses RustFS with Object Lock enabled to exercise the S3 API. It runs as a single-drive local development instance with disk checks bypassed; it is not a production storage topology or substitute for testing the selected production provider and retention policy. The RustFS console is at `http://localhost:9001`.

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

The API streams the file to a bounded temporary spool, independently checks the digest, and writes the original bytes to a versioned Object-Locked RustFS bucket with configured retention. An `INGEST` event is committed with the evidence record.

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

Tests use SQLite and an in-memory object store. The local Compose deployment uses PostgreSQL and RustFS. The app currently creates the initial database schema on startup; replace this with versioned migrations before production.
