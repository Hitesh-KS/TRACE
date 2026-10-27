"""Add persistent download audit records.

Revision ID: 0003_download_audits
Revises: 0002_case_authorization
"""

from alembic import op
import sqlalchemy as sa

revision = "0003_download_audits"
down_revision = "0002_case_authorization"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "download_audits",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("evidence_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("object_version_id", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.ForeignKeyConstraint(
            ["evidence_id"], ["evidence.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_download_audits_evidence_timestamp",
        "download_audits",
        ["evidence_id", "timestamp"],
    )
    op.create_index(
        "ix_download_audits_user_timestamp",
        "download_audits",
        ["user_id", "timestamp"],
    )


def downgrade() -> None:
    op.drop_index("ix_download_audits_user_timestamp", table_name="download_audits")
    op.drop_index(
        "ix_download_audits_evidence_timestamp", table_name="download_audits"
    )
    op.drop_table("download_audits")
