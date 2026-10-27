import hashlib
import hmac
import logging
import re
import secrets
import tempfile
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from io import BytesIO
from typing import Annotated, BinaryIO, Protocol
from os.path import basename
from urllib.parse import quote

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from botocore.exceptions import BotoCoreError
from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings
from app.database import create_session_factory
from app.ledger import append_event, verify_chain
from app.models import (
    AuthSession,
    Base,
    Case,
    CaseMembership,
    DownloadAudit,
    Evidence,
    EvidenceLedger,
    ForensicNote,
    CaseReport,
    User,
)
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


class CaseRequest(BaseModel):
    case_id: str = Field(min_length=1, max_length=200)
    name: str | None = Field(default=None, max_length=255)
    description: str | None = Field(default=None, max_length=5000)


class CaseMembershipRequest(BaseModel):
    user_id: uuid.UUID
    case_id: str = Field(min_length=1, max_length=200)


class ForensicNoteRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    content: str = Field(min_length=1, max_length=50000)


class ReportRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)


class Storage(Protocol):
    def put(
        self, *, key: str, body: BinaryIO, content_length: int, content_type: str
    ) -> str: ...

    def get(self, *, key: str, version_id: str) -> BinaryIO: ...

    def delete(self, *, key: str, version_id: str) -> None: ...


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
    app.state.session_factory = sessions

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

    def require_roles(*roles: str):
        def dependency(
            user: Annotated[User, Depends(get_authenticated_user)],
        ) -> User:
            if user.role not in roles:
                raise HTTPException(
                    status_code=403, detail="Insufficient permissions"
                )
            return user

        return dependency

    def user_has_case_access(
        session: Session, *, user_id: uuid.UUID, case_id: str
    ) -> bool:
        return (
            session.scalar(
                select(CaseMembership.id).where(
                    CaseMembership.user_id == user_id,
                    CaseMembership.case_id == case_id,
                )
            )
            is not None
        )

    def get_authorized_evidence(
        evidence_id: uuid.UUID, user: User, session: Session
    ) -> Evidence:
        evidence = session.scalar(
            select(Evidence)
            .join(
                CaseMembership,
                CaseMembership.case_id == Evidence.case_id,
            )
            .where(
                Evidence.id == evidence_id,
                CaseMembership.user_id == user.id,
            )
        )
        if evidence is None:
            raise HTTPException(status_code=404, detail="Evidence not found")
        return evidence

    def evidence_response(evidence: Evidence) -> dict:
        return {
            "evidence_id": str(evidence.id),
            "case_id": evidence.case_id,
            "file_name": evidence.file_name,
            "content_type": evidence.content_type,
            "file_sha256": evidence.file_sha256,
            "byte_size": evidence.byte_size,
            "status": evidence.status,
            "object_version_id": evidence.object_version_id,
            "created_at": evidence.created_at,
        }

    def forensic_note_response(note: ForensicNote) -> dict:
        return {
            "id": str(note.id),
            "evidence_id": str(note.evidence_id),
            "case_id": note.case_id,
            "analyst_id": str(note.analyst_id),
            "title": note.title,
            "content": note.content,
            "created_at": note.created_at,
        }

    def report_response(report: CaseReport) -> dict:
        return {
            "report_id": str(report.id),
            "case_id": report.case_id,
            "title": report.title,
            "creator_id": str(report.creator_id),
            "created_at": report.created_at,
            "file_sha256": report.file_sha256,
            "object_version_id": report.object_version_id,
            "byte_size": report.byte_size,
        }

    def build_report_pdf(
        *,
        report_id: uuid.UUID,
        title: str,
        creator: User,
        case: Case,
        evidence: list[Evidence],
        notes: list[ForensicNote],
        ledger_events: list[EvidenceLedger],
        verification_results: dict[uuid.UUID, str],
    ) -> bytes:
        buffer = BytesIO()
        styles = getSampleStyleSheet()
        body = styles["BodyText"]
        body.leading = 11
        story = [
            Paragraph(title, styles["Title"]),
            Paragraph(f"Report ID: {report_id}", body),
            Paragraph(f"Created by: {creator.email} ({creator.id})", body),
            Paragraph(f"Created at: {datetime.now(timezone.utc).isoformat()}", body),
            Spacer(1, 0.18 * inch),
            Paragraph("Case", styles["Heading2"]),
            Paragraph(
                f"{case.case_id} - {case.name or 'Unnamed case'}<br/>{case.description or 'No description available.'}",
                body,
            ),
            Spacer(1, 0.12 * inch),
            Paragraph("Evidence inventory", styles["Heading2"]),
        ]
        evidence_rows = [["Evidence ID", "Filename", "SHA-256", "Verification"]]
        for item in evidence:
            evidence_rows.append(
                [
                    str(item.id),
                    item.file_name,
                    item.file_sha256,
                    verification_results.get(item.id, "NOT CHECKED"),
                ]
            )
        evidence_table = Table(evidence_rows, repeatRows=1, colWidths=[1.35 * inch, 1.15 * inch, 2.15 * inch, 1.05 * inch])
        evidence_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#d9e2f3")),
                    ("GRID", (0, 0), (-1, -1), 0.35, colors.grey),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("FONTSIZE", (0, 0), (-1, -1), 7),
                ]
            )
        )
        story.extend([evidence_table, Spacer(1, 0.12 * inch)])
        story.append(Paragraph("Custody ledger entries", styles["Heading2"]))
        ledger_rows = [["Timestamp", "Action", "Actor", "Hash"]]
        for event in ledger_events:
            ledger_rows.append(
                [
                    event.timestamp.isoformat(),
                    event.action_type,
                    str(event.actor_id),
                    event.current_block_hash,
                ]
            )
        ledger_table = Table(ledger_rows, repeatRows=1, colWidths=[1.25 * inch, 0.85 * inch, 1.55 * inch, 2.05 * inch])
        ledger_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#d9e2f3")),
                    ("GRID", (0, 0), (-1, -1), 0.35, colors.grey),
                    ("FONTSIZE", (0, 0), (-1, -1), 7),
                ]
            )
        )
        story.extend([ledger_table, Spacer(1, 0.12 * inch)])
        story.append(Paragraph("Forensic notes", styles["Heading2"]))
        if notes:
            for note in notes:
                story.extend(
                    [
                        Paragraph(f"{note.title} - {note.created_at.isoformat()}", styles["Heading3"]),
                        Paragraph(f"Author: {note.analyst_id}", body),
                        Paragraph(note.content.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\n", "<br/>"), body),
                        Spacer(1, 0.08 * inch),
                    ]
                )
        else:
            story.append(Paragraph("No forensic notes are recorded.", body))
        story.append(Paragraph("Report integrity", styles["Heading2"]))
        story.append(
            Paragraph(
                "The SHA-256 value returned with the report metadata is calculated over the final PDF bytes. It is not embedded here to avoid a circular hash dependency.",
                body,
            )
        )
        SimpleDocTemplate(
            buffer,
            pagesize=letter,
            pageCompression=0,
            rightMargin=0.45 * inch,
            leftMargin=0.45 * inch,
            topMargin=0.5 * inch,
            bottomMargin=0.5 * inch,
        ).build(story)
        return buffer.getvalue()

    def get_authorized_case(
        case_id: str, user: User, session: Session
    ) -> Case:
        case = session.get(Case, case_id)
        if case is None or not user_has_case_access(
            session, user_id=user.id, case_id=case_id
        ):
            raise HTTPException(status_code=404, detail="Case not found")
        return case

    def get_authorized_report(
        report_id: uuid.UUID, user: User, session: Session
    ) -> CaseReport:
        report = session.get(CaseReport, report_id)
        if report is None:
            raise HTTPException(status_code=404, detail="Report not found")
        get_authorized_case(report.case_id, user, session)
        return report

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

    @app.get("/api/v1/evidence")
    def list_evidence(
        user: Annotated[
            User, Depends(require_roles("INVESTIGATOR", "ANALYST", "AUDITOR"))
        ],
        session: Annotated[Session, Depends(get_db)],
        limit: Annotated[int, Query(ge=1, le=100)] = 50,
        offset: Annotated[int, Query(ge=0)] = 0,
        case_id: Annotated[str | None, Query(min_length=1, max_length=200)] = None,
    ):
        query = (
            select(Evidence)
            .join(CaseMembership, CaseMembership.case_id == Evidence.case_id)
            .where(CaseMembership.user_id == user.id)
            .order_by(Evidence.created_at.desc(), Evidence.id.desc())
            .limit(limit)
            .offset(offset)
        )
        if case_id is not None:
            query = query.where(Evidence.case_id == case_id.strip())
        return {
            "items": [
                evidence_response(evidence) for evidence in session.scalars(query)
            ],
            "limit": limit,
            "offset": offset,
        }

    @app.get("/api/v1/evidence/{evidence_id}")
    def get_evidence(
        evidence_id: uuid.UUID,
        user: Annotated[
            User, Depends(require_roles("INVESTIGATOR", "ANALYST", "AUDITOR"))
        ],
        session: Annotated[Session, Depends(get_db)],
    ):
        evidence = get_authorized_evidence(evidence_id, user, session)
        events = list(
            session.execute(
                select(
                    EvidenceLedger.sequence,
                    EvidenceLedger.action_type,
                    EvidenceLedger.timestamp,
                )
                .where(EvidenceLedger.evidence_id == evidence.id)
                .order_by(EvidenceLedger.sequence)
            )
        )
        response = evidence_response(evidence)
        response["custody_events"] = [
            {
                "sequence": sequence,
                "action": action_type,
                "timestamp": timestamp,
            }
            for sequence, action_type, timestamp in events
        ]
        return response

    @app.post("/api/v1/evidence/{evidence_id}/notes", status_code=201)
    def create_forensic_note(
        evidence_id: uuid.UUID,
        request: ForensicNoteRequest,
        analyst: Annotated[User, Depends(require_roles("ANALYST"))],
        session: Annotated[Session, Depends(get_db)],
    ):
        evidence = get_authorized_evidence(evidence_id, analyst, session)
        title = request.title.strip()
        if not title:
            raise HTTPException(status_code=422, detail="title must not be blank")
        note = ForensicNote(
            evidence_id=evidence.id,
            case_id=evidence.case_id,
            analyst_id=analyst.id,
            title=title,
            content=request.content,
            created_at=datetime.now(timezone.utc),
        )
        try:
            session.add(note)
            session.commit()
        except SQLAlchemyError as exc:
            session.rollback()
            logger.exception("Forensic note creation failed for %s", evidence_id)
            raise HTTPException(
                status_code=503, detail="Forensic note could not be saved"
            ) from exc
        return forensic_note_response(note)

    @app.get("/api/v1/evidence/{evidence_id}/notes")
    def list_forensic_notes(
        evidence_id: uuid.UUID,
        analyst: Annotated[User, Depends(require_roles("ANALYST"))],
        session: Annotated[Session, Depends(get_db)],
    ):
        evidence = get_authorized_evidence(evidence_id, analyst, session)
        notes = session.scalars(
            select(ForensicNote)
            .where(ForensicNote.evidence_id == evidence.id)
            .order_by(ForensicNote.created_at, ForensicNote.id)
        )
        return {"items": [forensic_note_response(note) for note in notes]}

    @app.get("/api/v1/evidence/{evidence_id}/notes/{note_id}")
    def get_forensic_note(
        evidence_id: uuid.UUID,
        note_id: uuid.UUID,
        analyst: Annotated[User, Depends(require_roles("ANALYST"))],
        session: Annotated[Session, Depends(get_db)],
    ):
        evidence = get_authorized_evidence(evidence_id, analyst, session)
        note = session.scalar(
            select(ForensicNote).where(
                ForensicNote.id == note_id,
                ForensicNote.evidence_id == evidence.id,
            )
        )
        if note is None:
            raise HTTPException(status_code=404, detail="Forensic note not found")
        return forensic_note_response(note)

    @app.post("/api/v1/cases/{case_id}/reports", status_code=201)
    def create_report(
        case_id: str,
        request: ReportRequest,
        creator: Annotated[User, Depends(require_roles("ANALYST", "AUDITOR"))],
        session: Annotated[Session, Depends(get_db)],
    ):
        case = get_authorized_case(case_id.strip(), creator, session)
        evidence = list(
            session.scalars(
                select(Evidence)
                .where(Evidence.case_id == case.case_id)
                .order_by(Evidence.created_at, Evidence.id)
            )
        )
        evidence_ids = [item.id for item in evidence]
        notes = list(
            session.scalars(
                select(ForensicNote)
                .where(ForensicNote.case_id == case.case_id)
                .order_by(ForensicNote.created_at, ForensicNote.id)
            )
        )
        ledger_events = list(
            session.scalars(
                select(EvidenceLedger)
                .where(EvidenceLedger.evidence_id.in_(evidence_ids))
                .order_by(EvidenceLedger.timestamp, EvidenceLedger.sequence)
            )
        ) if evidence_ids else []
        verification_results: dict[uuid.UUID, str] = {}
        for item in evidence:
            try:
                body = app.state.storage.get(
                    key=item.object_key, version_id=item.object_version_id
                )
                digest = hashlib.sha256()
                while chunk := body.read(CHUNK_SIZE):
                    digest.update(chunk)
                body.close()
                verification_results[item.id] = (
                    "PASS"
                    if hmac.compare_digest(digest.hexdigest(), item.file_sha256)
                    else "FAIL"
                )
            except (BotoCoreError, StorageUnavailable, RuntimeError) as exc:
                logger.exception("Report evidence verification failed for %s", item.id)
                raise HTTPException(
                    status_code=503, detail="Evidence storage is unavailable"
                ) from exc

        report_id = uuid.uuid4()
        pdf_bytes = build_report_pdf(
            report_id=report_id,
            title=request.title.strip(),
            creator=creator,
            case=case,
            evidence=evidence,
            notes=notes,
            ledger_events=ledger_events,
            verification_results=verification_results,
        )
        object_key = f"reports/{case.case_id}/{report_id}.pdf"
        try:
            version_id = app.state.storage.put(
                key=object_key,
                body=BytesIO(pdf_bytes),
                content_length=len(pdf_bytes),
                content_type="application/pdf",
            )
        except (BotoCoreError, StorageUnavailable, RuntimeError) as exc:
            logger.exception("Report PDF upload failed for %s", report_id)
            raise HTTPException(
                status_code=503, detail="Report storage is unavailable"
            ) from exc

        report = CaseReport(
            id=report_id,
            case_id=case.case_id,
            title=request.title.strip(),
            creator_id=creator.id,
            created_at=datetime.now(timezone.utc),
            file_sha256=hashlib.sha256(pdf_bytes).hexdigest(),
            object_key=object_key,
            object_version_id=version_id,
            byte_size=len(pdf_bytes),
        )
        try:
            session.add(report)
            session.commit()
        except SQLAlchemyError as exc:
            session.rollback()
            try:
                app.state.storage.delete(key=object_key, version_id=version_id)
            except (BotoCoreError, StorageUnavailable, RuntimeError):
                logger.exception("Report orphan cleanup failed for %s", report_id)
            logger.exception("Report metadata commit failed for %s", report_id)
            raise HTTPException(
                status_code=503, detail="Report metadata could not be saved"
            ) from exc
        return report_response(report)

    @app.get("/api/v1/cases/{case_id}/reports")
    def list_reports(
        case_id: str,
        user: Annotated[User, Depends(require_roles("ANALYST", "AUDITOR"))],
        session: Annotated[Session, Depends(get_db)],
    ):
        case = get_authorized_case(case_id.strip(), user, session)
        reports = session.scalars(
            select(CaseReport)
            .where(CaseReport.case_id == case.case_id)
            .order_by(CaseReport.created_at.desc(), CaseReport.id.desc())
        )
        return {"items": [report_response(report) for report in reports]}

    @app.get("/api/v1/reports/{report_id}")
    def get_report(
        report_id: uuid.UUID,
        user: Annotated[User, Depends(require_roles("ANALYST", "AUDITOR"))],
        session: Annotated[Session, Depends(get_db)],
    ):
        return report_response(get_authorized_report(report_id, user, session))

    @app.get("/api/v1/reports/{report_id}/download")
    def download_report(
        report_id: uuid.UUID,
        user: Annotated[User, Depends(require_roles("ANALYST", "AUDITOR"))],
        session: Annotated[Session, Depends(get_db)],
    ):
        report = get_authorized_report(report_id, user, session)
        try:
            object_body = app.state.storage.get(
                key=report.object_key, version_id=report.object_version_id
            )
        except (BotoCoreError, StorageUnavailable, RuntimeError) as exc:
            logger.exception("Report download failed for %s", report_id)
            raise HTTPException(
                status_code=503, detail="Report storage is unavailable"
            ) from exc

        def stream():
            try:
                while chunk := object_body.read(CHUNK_SIZE):
                    yield chunk
            finally:
                object_body.close()

        return StreamingResponse(
            stream(),
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="report-{report.id}.pdf"',
                "Content-Length": str(report.byte_size),
                "X-Content-Type-Options": "nosniff",
            },
        )

    @app.get("/api/v1/evidence/{evidence_id}/download")
    def download_evidence(
        evidence_id: uuid.UUID,
        user: Annotated[User, Depends(require_roles("ANALYST"))],
        session: Annotated[Session, Depends(get_db)],
    ):
        evidence = get_authorized_evidence(evidence_id, user, session)
        try:
            object_body = app.state.storage.get(
                key=evidence.object_key, version_id=evidence.object_version_id
            )
        except (BotoCoreError, StorageUnavailable) as exc:
            logger.exception("Evidence download read failed for %s", evidence_id)
            raise HTTPException(
                status_code=503, detail="Evidence storage is unavailable"
            ) from exc

        audit = DownloadAudit(
            evidence_id=evidence.id,
            user_id=user.id,
            timestamp=datetime.now(timezone.utc),
            object_version_id=evidence.object_version_id,
            status="INITIATED",
        )
        try:
            session.add(audit)
            session.commit()
        except SQLAlchemyError as exc:
            session.rollback()
            object_body.close()
            logger.exception("Evidence download audit commit failed for %s", evidence_id)
            raise HTTPException(
                status_code=503, detail="Download could not be audited"
            ) from exc

        filename = basename(evidence.file_name).replace("\r", "").replace("\n", "")
        if not filename or filename in {".", ".."}:
            filename = f"{evidence.id}.bin"
        encoded_filename = quote(filename, safe="")

        def stream():
            try:
                while chunk := object_body.read(CHUNK_SIZE):
                    yield chunk
            finally:
                object_body.close()

        return StreamingResponse(
            stream(),
            media_type=evidence.content_type or "application/octet-stream",
            headers={
                "Content-Disposition": (
                    f'attachment; filename="{quote(filename, safe="._-")}"'
                    f"; filename*=UTF-8''{encoded_filename}"
                ),
                "Content-Length": str(evidence.byte_size),
            },
        )

    @app.post("/api/v1/admin/cases", status_code=201)
    def create_case(
        request: CaseRequest,
        _: Annotated[User, Depends(require_roles("ADMIN"))],
        session: Annotated[Session, Depends(get_db)],
    ):
        case_id = request.case_id.strip()
        if session.get(Case, case_id) is not None:
            raise HTTPException(status_code=409, detail="Case already exists")
        case = Case(
            case_id=case_id,
            name=request.name,
            description=request.description,
            created_at=datetime.now(timezone.utc),
        )
        try:
            session.add(case)
            session.commit()
        except IntegrityError as exc:
            session.rollback()
            raise HTTPException(status_code=409, detail="Case already exists") from exc
        return {
            "case_id": case.case_id,
            "name": case.name,
            "description": case.description,
            "created_at": case.created_at,
        }

    @app.post("/api/v1/admin/case-memberships", status_code=201)
    def create_case_membership(
        request: CaseMembershipRequest,
        _: Annotated[User, Depends(require_roles("ADMIN"))],
        session: Annotated[Session, Depends(get_db)],
    ):
        case_id = request.case_id.strip()
        if session.get(Case, case_id) is None:
            raise HTTPException(status_code=404, detail="Case not found")
        user = session.get(User, request.user_id)
        if user is None or not user.is_active:
            raise HTTPException(status_code=404, detail="User not found")
        membership = CaseMembership(
            user_id=user.id,
            case_id=case_id,
            created_at=datetime.now(timezone.utc),
        )
        try:
            session.add(membership)
            session.commit()
        except IntegrityError as exc:
            session.rollback()
            raise HTTPException(
                status_code=409, detail="Case membership already exists"
            ) from exc
        return {
            "id": str(membership.id),
            "user_id": str(membership.user_id),
            "case_id": membership.case_id,
            "created_at": membership.created_at,
        }

    @app.post("/api/v1/evidence", status_code=201)
    def upload_evidence(
        file: Annotated[UploadFile, File()],
        case_id: Annotated[str, Form(min_length=1, max_length=200)],
        client_sha256: Annotated[str, Form()],
        user: Annotated[User, Depends(require_roles("INVESTIGATOR"))],
        session: Annotated[Session, Depends(get_db)],
    ):
        if not user_has_case_access(
            session, user_id=user.id, case_id=case_id.strip()
        ):
            raise HTTPException(status_code=403, detail="Case access is required")
        case_id = case_id.strip()
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
            uploader_id=user.id,
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
                actor_id=user.id,
                metadata={
                    "byte_size": byte_size,
                    "case_id": case_id,
                    "object_version_id": version_id,
                },
            )
            session.commit()
        except SQLAlchemyError as exc:
            session.rollback()
            logger.exception(
                "Evidence database commit failed after object storage write: "
                "evidence_id=%s object_key=%s object_version_id=%s",
                evidence_id,
                object_key,
                version_id,
            )
            raise HTTPException(
                status_code=503,
                detail=(
                    "Evidence storage succeeded but its database record could not "
                    "be committed; reconciliation is required"
                ),
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
        user: Annotated[
            User, Depends(require_roles("INVESTIGATOR", "ANALYST", "AUDITOR"))
        ],
        session: Annotated[Session, Depends(get_db)],
    ):
        evidence = get_authorized_evidence(evidence_id, user, session)
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
                actor_id=user.id,
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
