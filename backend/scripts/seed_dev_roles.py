import hashlib
import os
import uuid
from datetime import datetime, timedelta, timezone

from argon2 import PasswordHasher
from sqlalchemy import select

from app.config import Settings
from app.database import create_session_factory
from app.models import AuthSession, Case, CaseMembership, User

CASE_ID = "case-001"
DEV_PASSWORD = os.getenv("TRACE_DEV_PASSWORD", "trace-dev-password")
ROLE_USERS = (
    ("ANALYST", "analyst@local", "00000000-0000-4000-8000-000000000002", "TRACE_ANALYST_TOKEN"),
    ("JUDGE", "judge@local", "00000000-0000-4000-8000-000000000003", "TRACE_JUDGE_TOKEN"),
    ("ADMIN", "admin@local", "00000000-0000-4000-8000-000000000004", "TRACE_ADMIN_TOKEN"),
)


def main() -> None:
    settings = Settings.from_env()
    sessions = create_session_factory(settings.database_url)
    hasher = PasswordHasher()
    now = datetime.now(timezone.utc)
    session_expiry = now + timedelta(days=3650)

    with sessions() as session:
        case = session.get(Case, CASE_ID)
        if case is None:
            case = Case(case_id=CASE_ID, name="Local seeded case", created_at=now)
            session.add(case)
            session.flush()

        investigator_id = uuid.UUID(settings.actor_id)
        investigator = session.get(User, investigator_id)
        if investigator is None:
            investigator = User(
                id=investigator_id,
                email="configured-actor@local",
                password_hash=hasher.hash(DEV_PASSWORD),
                role="INVESTIGATOR",
                is_active=True,
                created_at=now,
            )
            session.add(investigator)
        else:
            investigator.role = "INVESTIGATOR"
            investigator.is_active = True

        if session.scalar(
            select(CaseMembership).where(
                CaseMembership.user_id == investigator_id,
                CaseMembership.case_id == CASE_ID,
            )
        ) is None:
            session.add(
                CaseMembership(
                    user_id=investigator_id,
                    case_id=CASE_ID,
                    created_at=now,
                )
            )

        for role, email, user_id, token_env in ROLE_USERS:
            token = os.getenv(token_env, "")
            if len(token) < 32:
                raise SystemExit(f"{token_env} must contain at least 32 characters")

            user_uuid = uuid.UUID(user_id)
            user = session.get(User, user_uuid)
            if user is None:
                user = User(
                    id=user_uuid,
                    email=email,
                    password_hash=hasher.hash(DEV_PASSWORD),
                    role=role,
                    is_active=True,
                    created_at=now,
                )
                session.add(user)
            else:
                user.email = email
                user.role = role
                user.is_active = True

            if session.scalar(
                select(CaseMembership).where(
                    CaseMembership.user_id == user_uuid,
                    CaseMembership.case_id == CASE_ID,
                )
            ) is None:
                session.add(
                    CaseMembership(
                        user_id=user_uuid,
                        case_id=CASE_ID,
                        created_at=now,
                    )
                )

            session.flush()
            token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
            auth_session = session.scalar(
                select(AuthSession).where(AuthSession.token_hash == token_hash)
            )
            if auth_session is None:
                session.add(
                    AuthSession(
                        user_id=user_uuid,
                        token_hash=token_hash,
                        created_at=now,
                        expires_at=session_expiry,
                    )
                )
            else:
                auth_session.user_id = user_uuid
                auth_session.expires_at = session_expiry
                auth_session.revoked_at = None

        session.commit()

    print(
        "Seeded local roles for case-001: "
        "configured-actor@local (INVESTIGATOR), analyst@local (ANALYST), "
        "judge@local (JUDGE), admin@local (ADMIN)"
    )


if __name__ == "__main__":
    main()
