import hashlib
import hmac
import logging
import re
import secrets
import tempfile
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Annotated, BinaryIO, Protocol

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from botocore.exceptions import BotoCoreError
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings
from app.database import create_session_factory
from app.ledger import append_event, verify_chain
from app.models import AuthSession, Base, Evidence, EvidenceLedger, User
from app.storage import ObjectStorage, StorageUnavailable

SHA256_PATTERN = re.compile(r"^[0-9a-fA-F]{64}$")
CHUNK_SIZE = 1024 * 1024
bearer_scheme = HTTPBearer(auto_error=False)
logger = logging.getLogger(__name__)
password_hasher = PasswordHasher()


class RegisterRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=12, max_length=256)


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=256)


class Storage(Protocol):
    def put(
        self, *, key: str, body: BinaryIO, content_length: int, content_type: str
    ) -> str: ...

    def get(self, *, key: str, version_id: str) -> BinaryIO: ...


def create_app(
    settings: Settings | None = None,
    *,
    storage: Storage | None = None,
    session_factory: sessionmaker[Session] | None = None,
    create_schema: bool = True,
) -> FastAPI:
    config = settings or Settings.from_env()
    sessions = session_factory or create_session_factory(config.database_url)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        config.validate()
        if app.state.storage is None:
            app.state.storage = ObjectStorage(config)
        if create_schema:
            Base.metadata.create_all(sessions.kw["bind"])
        yield

    app = FastAPI(
        title="TRACE Evidence Vault API",
        version="0.1.0",
        description="Local-development MVP for evidence ingest and integrity verification.",
        lifespan=lifespan,
    )
    app.state.storage = storage

    def token_is_valid(token: str) -> bool:
        if hmac.compare_digest(token, config.api_token):
            return True
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        with sessions() as session:
            auth_session = session.scalar(
                select(AuthSession).where(AuthSession.token_hash == token_hash)
            )
            if auth_session is None or auth_session.revoked_at is not None:
                return False
            expires_at = auth_session.expires_at
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            return expires_at > datetime.now(timezone.utc)

    @app.middleware("http")
    async def authenticate_before_body(request, call_next):
        if request.url.path.startswith("/api/") and not request.url.path.startswith(
            "/api/v1/auth/"
        ):
            authorization = request.headers.get("authorization", "").split()
            if (
                len(authorization) != 2
                or authorization[0].lower() != "bearer"
                or not token_is_valid(authorization[1])
            ):
                return JSONResponse(
                    {"detail": "Invalid or missing bearer token"},
                    status_code=401,
                    headers={"WWW-Authenticate": "Bearer"},
                )
        return await call_next(request)

    def get_db():
        with sessions() as session:
            yield session

    def get_authenticated_user(
        credentials: Annotated[
            HTTPAuthorizationCredentials | None, Depends(bearer_scheme)
        ],
        session: Annotated[Session, Depends(get_db)],
    ) -> User:
        if credentials is None or credentials.scheme.lower() != "bearer":
            raise HTTPException(
                status_code=401,
                detail="Invalid or missing bearer token",
                headers={"WWW-Authenticate": "Bearer"},
            )
        if hmac.compare_digest(credentials.credentials, config.api_token):
            user_id = uuid.UUID(config.actor_id)
            user = session.get(User, user_id)
            if user is not None and user.is_active:
                return user
            return User(
                id=user_id,
                email="configured-actor@local",
                role="ADMIN",
                is_active=True,
                created_at=datetime.now(timezone.utc),
            )
        token_hash = hashlib.sha256(credentials.credentials.encode("utf-8")).hexdigest()
        auth_session = session.scalar(
            select(AuthSession).where(AuthSession.token_hash == token_hash)
        )
        if auth_session is None or auth_session.revoked_at is not None:
            raise HTTPException(
                status_code=401,
                detail="Invalid or missing bearer token",
                headers={"WWW-Authenticate": "Bearer"},
            )
        expires_at = auth_session.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at <= datetime.now(timezone.utc):
            raise HTTPException(
                status_code=401,
                detail="Authentication session has expired",
                headers={"WWW-Authenticate": "Bearer"},
            )
        user = session.get(User, auth_session.user_id)
        if user is None or not user.is_active:
            raise HTTPException(
                status_code=401,
                detail="User account is inactive",
                headers={"WWW-Authenticate": "Bearer"},
            )
        return user

    def require_auth(
        user: Annotated[User, Depends(get_authenticated_user)],
    ) -> uuid.UUID:
        return user.id

    def auth_response(token: str, user: User, expires_at: datetime):
        return {
            "access_token": token,
            "token_type": "bearer",
            "expires_at": expires_at,
            "user": {
                "id": str(user.id),
                "email": user.email,
                "role": user.role,
            },
        }

    @app.post("/api/v1/auth/register", status_code=201)
    def register(request: RegisterRequest, session: Annotated[Session, Depends(get_db)]):
        email = request.email.strip().lower()
        if "@" not in email:
            raise HTTPException(status_code=422, detail="email must be valid")
        user = User(
            email=email,
            password_hash=password_hasher.hash(request.password),
            role="INVESTIGATOR",
            is_active=True,
            created_at=datetime.now(timezone.utc),
        )
        try:
            session.add(user)
            session.commit()
        except IntegrityError as exc:
            session.rollback()
            raise HTTPException(status_code=409, detail="Email is already registered") from exc
        return {"id": str(user.id), "email": user.email, "role": user.role}

    @app.post("/api/v1/auth/login")
    def login(request: LoginRequest, session: Annotated[Session, Depends(get_db)]):
        user = session.scalar(
            select(User).where(User.email == request.email.strip().lower())
        )
        if user is None or not user.is_active:
            raise HTTPException(status_code=401, detail="Invalid email or password")
        try:
            password_hasher.verify(user.password_hash, request.password)
        except (VerifyMismatchError, VerificationError, InvalidHashError) as exc:
            raise HTTPException(status_code=401, detail="Invalid email or password") from exc
        token = secrets.token_urlsafe(32)
        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(days=config.auth_session_days)
        session.add(
            AuthSession(
                user_id=user.id,
                token_hash=hashlib.sha256(token.encode("utf-8")).hexdigest(),
                created_at=now,
                expires_at=expires_at,
            )
        )
        session.commit()
        return auth_response(token, user, expires_at)

    @app.post("/api/v1/auth/logout")
    def logout(
        credentials: Annotated[
            HTTPAuthorizationCredentials | None, Depends(bearer_scheme)
        ],
        _: Annotated[User, Depends(get_authenticated_user)],
        session: Annotated[Session, Depends(get_db)],
    ):
        if credentials is not None and not hmac.compare_digest(
            credentials.credentials, config.api_token
        ):
            token_hash = hashlib.sha256(credentials.credentials.encode("utf-8")).hexdigest()
            auth_session = session.scalar(
                select(AuthSession).where(AuthSession.token_hash == token_hash)
            )
            if auth_session is not None and auth_session.revoked_at is None:
                auth_session.revoked_at = datetime.now(timezone.utc)
                session.commit()
        return {"status": "logged_out"}

    @app.get("/api/v1/auth/me")
    def me(user: Annotated[User, Depends(get_authenticated_user)]):
        return {"id": str(user.id), "email": user.email, "role": user.role}

    @app.get("/healthz")
    def healthz():
        return {"status": "ok"}

    @app.post("/api/v1/evidence", status_code=201)
    def upload_evidence(
        file: Annotated[UploadFile, File()],
        case_id: Annotated[str, Form(min_length=1, max_length=200)],
        client_sha256: Annotated[str, Form()],
        actor_id: Annotated[uuid.UUID, Depends(require_auth)],
        session: Annotated[Session, Depends(get_db)],
    ):
        if not SHA256_PATTERN.fullmatch(client_sha256):
            raise HTTPException(
                status_code=400, detail="client_sha256 must be a SHA-256 hex digest"
            )

        digest = hashlib.sha256()
        byte_size = 0
        with tempfile.SpooledTemporaryFile(max_size=8 * 1024 * 1024, mode="w+b") as staged:
            while chunk := file.file.read(CHUNK_SIZE):
                byte_size += len(chunk)
                if byte_size > config.max_upload_bytes:
                    raise HTTPException(
                        status_code=413, detail="Upload exceeds configured size limit"
                    )
                digest.update(chunk)
                staged.write(chunk)
            server_sha256 = digest.hexdigest()
            if not hmac.compare_digest(server_sha256, client_sha256.lower()):
                raise HTTPException(
                    status_code=409,
                    detail="Client and server SHA-256 digests do not match",
                )
            if byte_size == 0:
                raise HTTPException(status_code=400, detail="Empty evidence files are not accepted")

            evidence_id = uuid.uuid4()
            object_key = f"evidence/{evidence_id}/original"
            staged.seek(0)
            try:
                version_id = app.state.storage.put(
                    key=object_key,
                    body=staged,
                    content_length=byte_size,
                    content_type=file.content_type or "application/octet-stream",
                )
            except (BotoCoreError, StorageUnavailable, RuntimeError) as exc:
                logger.exception("Evidence object upload failed")
                raise HTTPException(
                    status_code=503, detail="Evidence storage is unavailable"
                ) from exc

        evidence = Evidence(
            id=evidence_id,
            case_id=case_id,
            file_name=file.filename or "evidence",
            content_type=file.content_type or "application/octet-stream",
            file_sha256=server_sha256,
            object_key=object_key,
            object_version_id=version_id,
            status="READY",
            byte_size=byte_size,
            created_at=datetime.now(timezone.utc),
        )
        try:
            session.add(evidence)
            session.flush()
            append_event(
                session,
                evidence=evidence,
                action_type="INGEST",
                actor_id=actor_id,
                metadata={
                    "byte_size": byte_size,
                    "case_id": case_id,
                    "object_version_id": version_id,
                },
            )
            session.commit()
        except SQLAlchemyError as exc:
            session.rollback()
            logger.exception("Evidence record commit failed for %s", evidence_id)
            raise HTTPException(
                status_code=503,
                detail="Evidence was stored but its database record could not be committed",
            ) from exc

        return {
            "evidence_id": str(evidence.id),
            "case_id": evidence.case_id,
            "file_sha256": evidence.file_sha256,
            "status": evidence.status,
            "object_version_id": evidence.object_version_id,
            "byte_size": evidence.byte_size,
            "created_at": evidence.created_at,
        }

    @app.get("/api/v1/evidence/{evidence_id}/verify")
    def verify_evidence(
        evidence_id: uuid.UUID,
        actor_id: Annotated[uuid.UUID, Depends(require_auth)],
        session: Annotated[Session, Depends(get_db)],
    ):
        evidence = session.get(Evidence, evidence_id)
        if evidence is None:
            raise HTTPException(status_code=404, detail="Evidence not found")
        blocks = list(
            session.scalars(
                select(EvidenceLedger)
                .where(EvidenceLedger.evidence_id == evidence_id)
                .order_by(EvidenceLedger.sequence)
            )
        )
        chain_valid = verify_chain(blocks, evidence_id)
        if not chain_valid:
            return {
                "evidence_id": str(evidence_id),
                "status": "FAIL",
                "ledger_status": "FAIL",
                "genesis_hash": blocks[0].file_sha256_hash if blocks else None,
                "computed_hash": None,
                "verification_timestamp": datetime.now(timezone.utc),
            }

        try:
            object_body = app.state.storage.get(
                key=evidence.object_key, version_id=evidence.object_version_id
            )
            try:
                file_digest = hashlib.sha256()
                while chunk := object_body.read(CHUNK_SIZE):
                    file_digest.update(chunk)
                computed_hash = file_digest.hexdigest()
            finally:
                object_body.close()
        except (BotoCoreError, StorageUnavailable) as exc:
            logger.exception("Evidence object read failed for %s", evidence_id)
            raise HTTPException(
                status_code=503, detail="Evidence storage is unavailable"
            ) from exc

        genesis_hash = blocks[0].file_sha256_hash
        passed = (
            hmac.compare_digest(computed_hash, evidence.file_sha256)
            and hmac.compare_digest(genesis_hash, evidence.file_sha256)
        )
        verification_time = datetime.now(timezone.utc)
        try:
            append_event(
                session,
                evidence=evidence,
                action_type="VERIFY",
                actor_id=actor_id,
                metadata={
                    "computed_hash": computed_hash,
                    "result": "PASS" if passed else "FAIL",
                },
            )
            session.commit()
        except SQLAlchemyError as exc:
            session.rollback()
            logger.exception("Verification ledger commit failed for %s", evidence_id)
            raise HTTPException(
                status_code=503, detail="Verification completed but could not be recorded"
            ) from exc
        return {
            "evidence_id": str(evidence_id),
            "status": "PASS" if passed else "FAIL",
            "ledger_status": "PASS",
            "genesis_hash": genesis_hash,
            "computed_hash": computed_hash,
            "verification_timestamp": verification_time,
        }

    return app


app = create_app()
