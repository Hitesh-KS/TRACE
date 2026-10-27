"""Add append-only analyst forensic notes.

Revision ID: 0005_forensic_notes
Revises: 0004_evidence_uploader
"""

from alembic import op
import sqlalchemy as sa

revision = "0005_forensic_notes"
down_revision = "0004_evidence_uploader"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "forensic_notes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("evidence_id", sa.Uuid(), nullable=False),
        sa.Column("case_id", sa.String(length=200), nullable=False),
        sa.Column("analyst_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["evidence_id"], ["evidence.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(["case_id"], ["cases.case_id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["analyst_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_forensic_notes_evidence_created_at",
        "forensic_notes",
        ["evidence_id", "created_at"],
    )
    op.create_index(
        "ix_forensic_notes_case_created_at",
        "forensic_notes",
        ["case_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_forensic_notes_case_created_at", table_name="forensic_notes")
    op.drop_index(
        "ix_forensic_notes_evidence_created_at", table_name="forensic_notes"
    )
    op.drop_table("forensic_notes")
