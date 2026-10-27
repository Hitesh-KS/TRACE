import hashlib
import io
import uuid
from dataclasses import replace

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import Settings
from app.main import create_app
from app.models import Base


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
