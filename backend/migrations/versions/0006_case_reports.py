"""Add stored forensic case reports.

Revision ID: 0006_case_reports
Revises: 0005_forensic_notes
"""

from alembic import op
import sqlalchemy as sa

revision = "0006_case_reports"
down_revision = "0005_forensic_notes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "case_reports",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("case_id", sa.String(length=200), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("creator_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("file_sha256", sa.String(length=64), nullable=False),
        sa.Column("object_key", sa.Text(), nullable=False),
        sa.Column("object_version_id", sa.Text(), nullable=False),
        sa.Column("byte_size", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["case_id"], ["cases.case_id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["creator_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("object_key", name="uq_case_reports_object_key"),
    )
    op.create_index(
        "ix_case_reports_case_created_at",
        "case_reports",
        ["case_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_case_reports_case_created_at", table_name="case_reports")
    op.drop_table("case_reports")
