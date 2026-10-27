import hashlib
import io
import uuid
from dataclasses import replace
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine, event, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import Settings
from app.main import create_app
from app.models import (
    AuthSession,
    Base,
    Case,
    CaseMembership,
    CaseReport,
    DownloadAudit,
    Evidence,
    ForensicNote,
    User,
)
from app.storage import StorageUnavailable


class MemoryStorage:
    def __init__(self):
        self.objects = {}
        self.get_calls = []

    def put(self, *, key, body, content_length, content_type):
        version_id = str(uuid.uuid4())
        self.objects[(key, version_id)] = body.read()
        return version_id

    def get(self, *, key, version_id):
        self.get_calls.append((key, version_id))
        if (key, version_id) not in self.objects:
            raise StorageUnavailable("missing object version")
        return io.BytesIO(self.objects[(key, version_id)])

    def delete(self, *, key, version_id):
        self.objects.pop((key, version_id), None)


def make_client(*, actor_role="INVESTIGATOR"):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    settings = replace(
        Settings.from_env(),
        api_token="test-token-" + ("x" * 32),
        actor_id="00000000-0000-4000-8000-000000000002",
        max_upload_bytes=1024,
    )
    storage = MemoryStorage()
    app = create_app(settings, storage=storage, session_factory=sessions, create_schema=False)
    with sessions() as session:
        session.add(
            Case(
                case_id="case-1",
                created_at=datetime.now(timezone.utc),
            )
        )
        session.add(
            User(
                id=uuid.UUID(settings.actor_id),
                email="configured-actor@local",
                password_hash="not-used",
                role=actor_role,
                is_active=True,
                created_at=datetime.now(timezone.utc),
            )
        )
        session.add(
            CaseMembership(
                user_id=uuid.UUID(settings.actor_id),
                case_id="case-1",
                created_at=datetime.now(timezone.utc),
            )
        )
        session.commit()
    return TestClient(app), storage


def test_upload_requires_authentication_and_hash_match():
    client, _ = make_client()
    payload = b"original evidence"
    digest = hashlib.sha256(payload).hexdigest()

    response = client.post(
        "/api/v1/evidence",
        files={"file": ("sample.bin", payload, "application/octet-stream")},
        data={"case_id": "case-1", "client_sha256": digest},
    )
    assert response.status_code == 401

    response = client.post(
        "/api/v1/evidence",
        headers={"Authorization": "Bearer test-token-" + ("x" * 32)},
        files={"file": ("sample.bin", payload, "application/octet-stream")},
        data={"case_id": "case-1", "client_sha256": "0" * 64},
    )
    assert response.status_code == 409


def test_upload_and_verify_stored_evidence():
    client, storage = make_client()
    payload = b"original evidence"
    digest = hashlib.sha256(payload).hexdigest()
    response = client.post(
        "/api/v1/evidence",
        headers={"Authorization": "Bearer test-token-" + ("x" * 32)},
        files={"file": ("sample.bin", payload, "application/octet-stream")},
        data={"case_id": "case-1", "client_sha256": digest},
    )

    assert response.status_code == 201
    evidence_id = response.json()["evidence_id"]
    with client.app.state.session_factory() as session:
        evidence = session.get(Evidence, uuid.UUID(evidence_id))
        assert evidence.uploader_id == uuid.UUID(
            "00000000-0000-4000-8000-000000000002"
        )
    verification = client.get(
        f"/api/v1/evidence/{evidence_id}/verify",
        headers={"Authorization": "Bearer test-token-" + ("x" * 32)},
    )
    assert verification.status_code == 200
    assert verification.json()["status"] == "PASS"
    assert verification.json()["ledger_status"] == "PASS"

    stored_key = next(iter(storage.objects))
    storage.objects[stored_key] = b"altered evidence"
    verification = client.get(
        f"/api/v1/evidence/{evidence_id}/verify",
        headers={"Authorization": "Bearer test-token-" + ("x" * 32)},
    )
    assert verification.status_code == 200
    assert verification.json()["status"] == "FAIL"


def test_analyst_can_create_list_and_retrieve_forensic_note():
    client, _ = make_client(actor_role="ANALYST")
    headers = {"Authorization": "Bearer " + "test-token-" + ("x" * 32)}
    with client.app.state.session_factory() as session:
        evidence = Evidence(
            id=uuid.uuid4(),
            uploader_id=uuid.UUID("00000000-0000-4000-8000-000000000002"),
            case_id="case-1",
            file_name="sample.bin",
            content_type="application/octet-stream",
            file_sha256=hashlib.sha256(b"evidence").hexdigest(),
            object_key="evidence/test/original",
            object_version_id="version-1",
            status="READY",
            byte_size=8,
            created_at=datetime.now(timezone.utc),
        )
        session.add(evidence)
        session.commit()
        evidence_id = evidence.id

    response = client.post(
        f"/api/v1/evidence/{evidence_id}/notes",
        headers=headers,
        json={"title": "Hash observation", "content": "Observed matching digest."},
    )
    assert response.status_code == 201
    note = response.json()
    assert note["case_id"] == "case-1"
    assert note["analyst_id"] == "00000000-0000-4000-8000-000000000002"

    listed = client.get(
        f"/api/v1/evidence/{evidence_id}/notes",
        headers=headers,
    )
    assert listed.status_code == 200
    assert listed.json()["items"][0]["id"] == note["id"]

    retrieved = client.get(
        f"/api/v1/evidence/{evidence_id}/notes/{note['id']}",
        headers=headers,
    )
    assert retrieved.status_code == 200
    assert retrieved.json()["content"] == "Observed matching digest."

    with client.app.state.session_factory() as session:
        stored_note = session.get(ForensicNote, uuid.UUID(note["id"]))
        stored_evidence = session.get(Evidence, evidence_id)
        assert stored_note.analyst_id == uuid.UUID(
            "00000000-0000-4000-8000-000000000002"
        )
        assert stored_evidence.file_sha256 == hashlib.sha256(b"evidence").hexdigest()


def test_non_analyst_and_unrelated_case_cannot_create_forensic_note():
    investigator, _ = make_client(actor_role="INVESTIGATOR")
    headers = {"Authorization": "Bearer " + "test-token-" + ("x" * 32)}
    evidence_id = uuid.uuid4()
    with investigator.app.state.session_factory() as session:
        session.add(
            Evidence(
                id=evidence_id,
                case_id="case-1",
                file_name="sample.bin",
                content_type="application/octet-stream",
                file_sha256="a" * 64,
                object_key="evidence/test/original",
                object_version_id="version-1",
                status="READY",
                byte_size=1,
                created_at=datetime.now(timezone.utc),
            )
        )
        session.commit()
    assert (
        investigator.post(
            f"/api/v1/evidence/{evidence_id}/notes",
            headers=headers,
            json={"title": "Not allowed", "content": "No analyst role."},
        ).status_code
        == 403
    )

    analyst, _ = make_client(actor_role="ANALYST")
    with analyst.app.state.session_factory() as session:
        session.add(
            Case(case_id="case-2", created_at=datetime.now(timezone.utc))
        )
        session.add(
            Evidence(
                id=evidence_id,
                case_id="case-2",
                file_name="other.bin",
                content_type="application/octet-stream",
                file_sha256="b" * 64,
                object_key="evidence/other/original",
                object_version_id="version-2",
                status="READY",
                byte_size=1,
                created_at=datetime.now(timezone.utc),
            )
        )
        session.commit()
    assert (
        analyst.post(
            f"/api/v1/evidence/{evidence_id}/notes",
            headers=headers,
            json={"title": "Not found", "content": "No access to other database."},
        ).status_code
        == 404
    )


def test_analyst_can_generate_list_retrieve_and_download_report():
    client, storage = make_client(actor_role="ANALYST")
    evidence_id = uuid.uuid4()
    evidence_bytes = b"report evidence"
    evidence_version = str(uuid.uuid4())
    storage.objects[("evidence/report/original", evidence_version)] = evidence_bytes
    with client.app.state.session_factory() as session:
        session.add(
            Evidence(
                id=evidence_id,
                uploader_id=uuid.UUID("00000000-0000-4000-8000-000000000002"),
                case_id="case-1",
                file_name="report.bin",
                content_type="application/octet-stream",
                file_sha256=hashlib.sha256(evidence_bytes).hexdigest(),
                object_key="evidence/report/original",
                object_version_id=evidence_version,
                status="READY",
                byte_size=len(evidence_bytes),
                created_at=datetime.now(timezone.utc),
            )
        )
        session.commit()

    headers = {"Authorization": "Bearer " + "test-token-" + ("x" * 32)}
    response = client.post(
        "/api/v1/cases/case-1/reports",
        headers=headers,
        json={"title": "Case examination report"},
    )
    assert response.status_code == 201
    report = response.json()
    assert report["case_id"] == "case-1"
    assert report["file_sha256"]
    with client.app.state.session_factory() as session:
        stored = session.get(CaseReport, uuid.UUID(report["report_id"]))
        assert stored is not None
        report_bytes = storage.objects[(stored.object_key, stored.object_version_id)]
        assert report_bytes.startswith(b"%PDF-")
        assert hashlib.sha256(report_bytes).hexdigest() == stored.file_sha256
        assert b"Case examination report" in report_bytes
        assert b"report.bin" in report_bytes

    listed = client.get("/api/v1/cases/case-1/reports", headers=headers)
    assert listed.status_code == 200
    assert listed.json()["items"][0]["report_id"] == report["report_id"]
    retrieved = client.get(
        f"/api/v1/reports/{report['report_id']}", headers=headers
    )
    assert retrieved.status_code == 200
    downloaded = client.get(
        f"/api/v1/reports/{report['report_id']}/download", headers=headers
    )
    assert downloaded.status_code == 200
    assert downloaded.headers["content-type"] == "application/pdf"
    assert downloaded.content == report_bytes


def test_report_access_requires_analyst_or_auditor_case_membership():
    investigator, _ = make_client(actor_role="INVESTIGATOR")
    headers = {"Authorization": "Bearer " + "test-token-" + ("x" * 32)}
    assert (
        investigator.post(
            "/api/v1/cases/case-1/reports",
            headers=headers,
            json={"title": "Denied"},
        ).status_code
        == 403
    )
    unauthenticated, _ = make_client(actor_role="ANALYST")
    assert (
        unauthenticated.get("/api/v1/cases/case-1/reports").status_code
        == 401
    )


def test_report_generation_fails_without_evidence_object():
    client, _ = make_client(actor_role="ANALYST")
    with client.app.state.session_factory() as session:
        session.add(
            Evidence(
                id=uuid.uuid4(),
                case_id="case-1",
                file_name="missing.bin",
                content_type="application/octet-stream",
                file_sha256="c" * 64,
                object_key="evidence/missing/original",
                object_version_id="missing-version",
                status="READY",
                byte_size=1,
                created_at=datetime.now(timezone.utc),
            )
        )
        session.commit()
    headers = {"Authorization": "Bearer " + "test-token-" + ("x" * 32)}
    response = client.post(
        "/api/v1/cases/case-1/reports",
        headers=headers,
        json={"title": "Unavailable evidence"},
    )
    assert response.status_code == 503
    with client.app.state.session_factory() as session:
        assert session.query(CaseReport).count() == 0


def test_report_metadata_failure_removes_uploaded_object():
    client, storage = make_client(actor_role="ANALYST")
    headers = {"Authorization": "Bearer " + "test-token-" + ("x" * 32)}

    def fail_insert(*_args):
        raise SQLAlchemyError("forced report persistence failure")

    event.listen(CaseReport, "before_insert", fail_insert)
    try:
        response = client.post(
            "/api/v1/cases/case-1/reports",
            headers=headers,
            json={"title": "Persistence failure"},
        )
    finally:
        event.remove(CaseReport, "before_insert", fail_insert)
    assert response.status_code == 503
    assert not any(key.startswith("reports/") for key, _ in storage.objects)


def test_register_login_me_and_logout():
    client, _ = make_client()
    registration = client.post(
        "/api/v1/auth/register",
        json={"email": "investigator@example.test", "password": "correct horse battery"},
    )
    assert registration.status_code == 201
    assert registration.json()["role"] == "INVESTIGATOR"

    login = client.post(
        "/api/v1/auth/login",
        json={"email": "INVESTIGATOR@example.test", "password": "correct horse battery"},
    )
    assert login.status_code == 200
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    me = client.get("/api/v1/auth/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["email"] == "investigator@example.test"

    logout = client.post("/api/v1/auth/logout", headers=headers)
    assert logout.status_code == 200
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 401


def test_auth_rejects_duplicate_registration_and_bad_password():
    client, _ = make_client()
    body = {"email": "duplicate@example.test", "password": "correct horse battery"}
    assert client.post("/api/v1/auth/register", json=body).status_code == 201
    assert client.post("/api/v1/auth/register", json=body).status_code == 409
    assert client.post(
        "/api/v1/auth/login",
        json={"email": body["email"], "password": "wrong password"},
    ).status_code == 401


def test_expired_session_is_rejected():
    client, _ = make_client()
    registration = client.post(
        "/api/v1/auth/register",
        json={"email": "expired@example.test", "password": "correct horse battery"},
    )
    assert registration.status_code == 201
    token = client.post(
        "/api/v1/auth/login",
        json={"email": "expired@example.test", "password": "correct horse battery"},
    ).json()["access_token"]
    with client.app.state.session_factory() as session:
        auth_session = session.scalar(
            select(AuthSession).where(
                AuthSession.token_hash == hashlib.sha256(token.encode()).hexdigest()
            )
        )
        auth_session.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        session.commit()
    assert (
        client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        ).status_code
        == 401
    )


def test_registered_user_without_case_assignment_cannot_upload():
    client, storage = make_client()
    registration = client.post(
        "/api/v1/auth/register",
        json={"email": "unassigned@example.test", "password": "correct horse battery"},
    )
    assert registration.status_code == 201
    login = client.post(
        "/api/v1/auth/login",
        json={"email": "unassigned@example.test", "password": "correct horse battery"},
    )
    token = login.json()["access_token"]
    response = client.post(
        "/api/v1/evidence",
        headers={"Authorization": f"Bearer {token}"},
        files={"file": ("sample.bin", b"original evidence", "application/octet-stream")},
        data={
            "case_id": "case-without-assignment",
            "client_sha256": hashlib.sha256(b"original evidence").hexdigest(),
        },
    )
    assert response.status_code == 403
    assert storage.objects == {}


def test_evidence_uuid_does_not_bypass_case_membership():
    client, storage = make_client()
    payload = b"original evidence"
    digest = hashlib.sha256(payload).hexdigest()
    response = client.post(
        "/api/v1/evidence",
        headers={"Authorization": "Bearer test-token-" + ("x" * 32)},
        files={"file": ("sample.bin", payload, "application/octet-stream")},
        data={"case_id": "case-1", "client_sha256": digest},
    )
    assert response.status_code == 201
    evidence_id = response.json()["evidence_id"]

    with client as authenticated_client:
        registration = authenticated_client.post(
            "/api/v1/auth/register",
            json={"email": "other@example.test", "password": "correct horse battery"},
        )
        assert registration.status_code == 201
        token = authenticated_client.post(
            "/api/v1/auth/login",
            json={"email": "other@example.test", "password": "correct horse battery"},
        ).json()["access_token"]
        verification = authenticated_client.get(
            f"/api/v1/evidence/{evidence_id}/verify",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert verification.status_code == 404


def test_admin_can_provision_case_membership_but_cannot_verify_evidence():
    client, _ = make_client(actor_role="ADMIN")
    registration = client.post(
        "/api/v1/auth/register",
        json={"email": "assigned@example.test", "password": "correct horse battery"},
    )
    target_id = registration.json()["id"]
    admin_headers = {"Authorization": "Bearer test-token-" + ("x" * 32)}

    case = client.post(
        "/api/v1/admin/cases",
        headers=admin_headers,
        json={"case_id": "case-2", "name": "Second case"},
    )
    assert case.status_code == 201
    membership = client.post(
        "/api/v1/admin/case-memberships",
        headers=admin_headers,
        json={"user_id": target_id, "case_id": "case-2"},
    )
    assert membership.status_code == 201
    duplicate = client.post(
        "/api/v1/admin/case-memberships",
        headers=admin_headers,
        json={"user_id": target_id, "case_id": "case-2"},
    )
    assert duplicate.status_code == 409
    assert (
        client.get(
            f"/api/v1/evidence/{uuid.uuid4()}/verify",
            headers=admin_headers,
        ).status_code
        == 403
    )


def test_non_admin_cannot_provision_membership():
    client, _ = make_client()
    response = client.post(
        "/api/v1/admin/cases",
        headers={"Authorization": "Bearer test-token-" + ("x" * 32)},
        json={"case_id": "case-2"},
    )
    assert response.status_code == 403


@pytest.mark.parametrize(
    ("role", "verify_status", "upload_status"),
    [
        ("INVESTIGATOR", 404, 201),
        ("ANALYST", 404, 403),
        ("AUDITOR", 404, 403),
        ("ADMIN", 403, 403),
    ],
)
def test_role_permissions_are_enforced(role, verify_status, upload_status):
    client, _ = make_client(actor_role=role)
    headers = {"Authorization": "Bearer test-token-" + ("x" * 32)}
    verify = client.get(
        f"/api/v1/evidence/{uuid.uuid4()}/verify",
        headers=headers,
    )
    assert verify.status_code == verify_status

    upload = client.post(
        "/api/v1/evidence",
        headers=headers,
        files={"file": ("sample.bin", b"original evidence", "application/octet-stream")},
        data={
            "case_id": "case-1",
            "client_sha256": hashlib.sha256(b"original evidence").hexdigest(),
        },
    )
    assert upload.status_code == upload_status


def test_evidence_listing_and_details_are_case_scoped():
    client, _ = make_client()
    headers = {"Authorization": "Bearer test-token-" + ("x" * 32)}
    payload = b"original evidence"
    response = client.post(
        "/api/v1/evidence",
        headers=headers,
        files={"file": ("sample.bin", payload, "application/octet-stream")},
        data={
            "case_id": "case-1",
            "client_sha256": hashlib.sha256(payload).hexdigest(),
        },
    )
    evidence_id = response.json()["evidence_id"]

    listing = client.get("/api/v1/evidence?limit=1&offset=0", headers=headers)
    assert listing.status_code == 200
    assert listing.json()["items"][0]["evidence_id"] == evidence_id
    details = client.get(f"/api/v1/evidence/{evidence_id}", headers=headers)
    assert details.status_code == 200
    assert details.json()["file_sha256"] == hashlib.sha256(payload).hexdigest()
    assert details.json()["custody_events"][0]["action"] == "INGEST"


def test_analyst_downloads_exact_version_and_creates_audit():
    client, storage = make_client()
    headers = {"Authorization": "Bearer test-token-" + ("x" * 32)}
    payload = b"original evidence"
    response = client.post(
        "/api/v1/evidence",
        headers=headers,
        files={"file": ("nested/name.bin", payload, "application/octet-stream")},
        data={
            "case_id": "case-1",
            "client_sha256": hashlib.sha256(payload).hexdigest(),
        },
    )
    evidence_id = response.json()["evidence_id"]
    with client.app.state.session_factory() as session:
        user = session.get(User, uuid.UUID("00000000-0000-4000-8000-000000000002"))
        user.role = "ANALYST"
        session.commit()

    download = client.get(f"/api/v1/evidence/{evidence_id}/download", headers=headers)
    assert download.status_code == 200
    assert download.content == payload
    assert "attachment" in download.headers["content-disposition"]
    assert storage.get_calls[0][1] == response.json()["object_version_id"]
    with client.app.state.session_factory() as session:
        audit = session.query(DownloadAudit).one()
        assert audit.status == "INITIATED"
        assert audit.object_version_id == response.json()["object_version_id"]


def test_admin_and_investigator_cannot_download_and_storage_is_not_read():
    client, storage = make_client()
    headers = {"Authorization": "Bearer test-token-" + ("x" * 32)}
    payload = b"original evidence"
    response = client.post(
        "/api/v1/evidence",
        headers=headers,
        files={"file": ("sample.bin", payload, "application/octet-stream")},
        data={
            "case_id": "case-1",
            "client_sha256": hashlib.sha256(payload).hexdigest(),
        },
    )
    evidence_id = response.json()["evidence_id"]
    denied = client.get(f"/api/v1/evidence/{evidence_id}/download", headers=headers)
    assert denied.status_code == 403
    assert storage.get_calls == []
    with client.app.state.session_factory() as session:
        assert session.query(DownloadAudit).count() == 0


def test_missing_object_version_fails_without_download_audit():
    client, storage = make_client()
    headers = {"Authorization": "Bearer test-token-" + ("x" * 32)}
    payload = b"original evidence"
    response = client.post(
        "/api/v1/evidence",
        headers=headers,
        files={"file": ("sample.bin", payload, "application/octet-stream")},
        data={
            "case_id": "case-1",
            "client_sha256": hashlib.sha256(payload).hexdigest(),
        },
    )
    evidence_id = response.json()["evidence_id"]
    with client.app.state.session_factory() as session:
        user = session.get(User, uuid.UUID("00000000-0000-4000-8000-000000000002"))
        user.role = "ANALYST"
        evidence = session.get(Evidence, uuid.UUID(evidence_id))
        object_key = evidence.object_key
        object_version_id = evidence.object_version_id
        session.commit()
    storage.objects.pop((object_key, object_version_id))

    download = client.get(f"/api/v1/evidence/{evidence_id}/download", headers=headers)
    assert download.status_code == 503
    with client.app.state.session_factory() as session:
        assert session.query(DownloadAudit).count() == 0
