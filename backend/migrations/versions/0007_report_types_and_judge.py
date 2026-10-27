"""Add report types and the JUDGE role."""

from alembic import op
import sqlalchemy as sa

revision = "0007_report_types_and_judge"
down_revision = "0006_case_reports"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_constraint("ck_users_role", type_="check")
        batch_op.create_check_constraint(
            "ck_users_role",
            "role IN ('INVESTIGATOR', 'ANALYST', 'JUDGE', 'AUDITOR', 'ADMIN')",
        )
    op.add_column(
        "case_reports",
        sa.Column(
            "report_type",
            sa.String(length=64),
            nullable=False,
            server_default="FORENSIC_EXAMINATION",
        ),
    )
    op.alter_column("case_reports", "report_type", server_default=None)


def downgrade() -> None:
    op.drop_column("case_reports", "report_type")
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_constraint("ck_users_role", type_="check")
        batch_op.create_check_constraint(
            "ck_users_role",
            "role IN ('INVESTIGATOR', 'ANALYST', 'AUDITOR', 'ADMIN')",
        )
