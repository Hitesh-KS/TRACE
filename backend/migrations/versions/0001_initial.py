"""Create the existing TRACE schema.

Revision ID: 0001_initial
Revises:
"""

from alembic import op
import sqlalchemy as sa

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email", name="uq_users_email"),
        sa.CheckConstraint(
            "role IN ('INVESTIGATOR', 'ANALYST', 'AUDITOR', 'ADMIN')",
            name="ck_users_role",
        ),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=False)
    op.create_table(
        "auth_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index("ix_auth_sessions_token_hash", "auth_sessions", ["token_hash"])
    op.create_table(
        "evidence",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("case_id", sa.String(length=200), nullable=False),
        sa.Column("file_name", sa.Text(), nullable=False),
        sa.Column("content_type", sa.String(length=255), nullable=False),
        sa.Column("file_sha256", sa.String(length=64), nullable=False),
        sa.Column("object_key", sa.Text(), nullable=False),
        sa.Column("object_version_id", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("byte_size", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("object_key"),
    )
    op.create_index("ix_evidence_case_id", "evidence", ["case_id"])
    op.create_table(
        "evidence_ledger",
        sa.Column("block_id", sa.Uuid(), nullable=False),
        sa.Column("evidence_id", sa.Uuid(), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("previous_block_hash", sa.String(length=64), nullable=False),
        sa.Column("action_type", sa.String(length=50), nullable=False),
        sa.Column("actor_id", sa.Uuid(), nullable=False),
        sa.Column("file_sha256_hash", sa.String(length=64), nullable=False),
        sa.Column("metadata", sa.JSON(), nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("hash_version", sa.SmallInteger(), nullable=False),
        sa.Column("current_block_hash", sa.String(length=64), nullable=False),
        sa.ForeignKeyConstraint(["evidence_id"], ["evidence.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("block_id"),
        sa.UniqueConstraint("current_block_hash"),
        sa.UniqueConstraint(
            "evidence_id", "sequence", name="uq_ledger_evidence_sequence"
        ),
        sa.CheckConstraint("length(previous_block_hash) = 64"),
        sa.CheckConstraint("length(current_block_hash) = 64"),
    )
    op.create_index(
        "ix_ledger_evidence_sequence",
        "evidence_ledger",
        ["evidence_id", "sequence"],
    )


def downgrade() -> None:
    op.drop_index("ix_ledger_evidence_sequence", table_name="evidence_ledger")
    op.drop_table("evidence_ledger")
    op.drop_index("ix_evidence_case_id", table_name="evidence")
    op.drop_table("evidence")
    op.drop_index("ix_auth_sessions_token_hash", table_name="auth_sessions")
    op.drop_table("auth_sessions")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
