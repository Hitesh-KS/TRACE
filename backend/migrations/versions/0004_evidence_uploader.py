"""Record the authenticated evidence uploader.

Revision ID: 0004_evidence_uploader
Revises: 0003_download_audits
"""

from alembic import op
import sqlalchemy as sa

revision = "0004_evidence_uploader"
down_revision = "0003_download_audits"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("evidence", recreate="always") as batch_op:
            batch_op.add_column(sa.Column("uploader_id", sa.Uuid(), nullable=True))
            batch_op.create_foreign_key(
                "fk_evidence_uploader_id_users",
                "users",
                ["uploader_id"],
                ["id"],
                ondelete="RESTRICT",
            )
    else:
        op.add_column(
            "evidence",
            sa.Column("uploader_id", sa.Uuid(), nullable=True),
        )
        op.create_foreign_key(
            "fk_evidence_uploader_id_users",
            "evidence",
            "users",
            ["uploader_id"],
            ["id"],
            ondelete="RESTRICT",
        )
    op.create_index("ix_evidence_uploader_id", "evidence", ["uploader_id"])


def downgrade() -> None:
    op.drop_index("ix_evidence_uploader_id", table_name="evidence")
    if op.get_bind().dialect.name == "sqlite":
        with op.batch_alter_table("evidence", recreate="always") as batch_op:
            batch_op.drop_constraint(
                "fk_evidence_uploader_id_users",
                type_="foreignkey",
            )
            batch_op.drop_column("uploader_id")
    else:
        op.drop_constraint(
            "fk_evidence_uploader_id_users",
            "evidence",
            type_="foreignkey",
        )
        op.drop_column("evidence", "uploader_id")
