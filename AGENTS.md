# TRACE contributor guide

This file is for human contributors and coding agents working in this repository.

## Project direction

TRACE means **Tamper-proof Record Archive for Cryptographic Evidence**. It is a digital evidence vault. Read `SOLUTION_ARCHITECTURE.md` before changing system boundaries or evidence-handling behavior. The current implementation is an early development build, not a production-ready forensic or legal-compliance system.

## Current structure

- `backend/app/`: FastAPI API, persistence models, object storage, and ledger hashing.
- `backend/tests/`: focused API and ledger tests.
- `compose.yaml`: local PostgreSQL, RustFS S3, and API services.
- `README.md`: local setup and API examples.

## Development

- Copy `.env.example` to `.env` and replace `TRACE_API_TOKEN` before starting local services.
- Start the stack with `docker compose up --build`.
- Run backend tests with `cd backend && PYTHONPATH=. pytest`.
- Keep credentials and evidence out of source control, test output, and logs.

## Evidence-handling requirements

- Never modify the original evidence bytes. Derived metadata and reports are separate artifacts.
- Independently calculate server-side SHA-256; do not treat a client digest or an S3 ETag as authoritative.
- Read and verify the exact object version recorded at ingest.
- Fail closed on ledger-chain or digest mismatches. Do not report storage errors as successful verification.
- Hash ledger events using the versioned canonical serialization in `backend/app/ledger.py`; changes require compatibility tests and an explicit hash-version strategy.
- Do not claim that a hash, WORM setting, generated report, or database-only hash chain proves legal admissibility or defeats every privileged operator.
- Preserve access controls and audit sensitive actions. The current shared bearer token is development-only; do not present it as production authentication.

## Change expectations

- Make focused changes, add regression tests for new behavior, and run the relevant test suite.
- Do not ship generic AI-generated-looking UI. Avoid decorative gradients, glowing/orbiting illustrations, invented metrics or activity, boilerplate marketing slogans, and repeated cards without a user need. Design from actual investigator tasks and verified system data; prefer a restrained, readable evidence-workbench aesthetic with clear labels, useful empty states, and functional controls.
- Use database migrations for production schema changes; automatic table creation is currently a development convenience.
- Keep storage-provider behavior behind the storage interface and test retention/version behavior against each supported provider. The single-drive RustFS Compose setup is for local development only and is not a production storage topology.
- Do not commit `.env`, secrets, real evidence, or generated test evidence.
