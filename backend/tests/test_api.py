import hashlib
import io
import uuid
from dataclasses import replace
from datetime import datetime, timezone

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import Settings
from app.main import create_app
from app.models import Base, CaseMembership, User


class MemoryStorage:
    def __init__(self):
        self.objects = {}

    def put(self, *, key, body, content_length, content_type):
        version_id = str(uuid.uuid4())
        self.objects[(key, version_id)] = body.read()
        return version_id

    def get(self, *, key, version_id):
        return io.BytesIO(self.objects[(key, version_id)])


def make_client():
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
            User(
                id=uuid.UUID(settings.actor_id),
                email="configured-actor@local",
                password_hash="not-used",
                role="INVESTIGATOR",
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


def test_registered_user_without_case_assignment_cannot_upload():
    client, _ = make_client()
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
