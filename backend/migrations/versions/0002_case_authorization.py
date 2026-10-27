"""Add cases and explicit case memberships.

Revision ID: 0002_case_authorization
Revises: 0001_initial
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0002_case_authorization"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def _has_table(name: str) -> bool:
    return inspect(op.get_bind()).has_table(name)


def _has_foreign_key(table: str, constrained_column: str, referred_table: str) -> bool:
    return any(
        constrained_column in constraint["constrained_columns"]
        and constraint["referred_table"] == referred_table
        for constraint in inspect(op.get_bind()).get_foreign_keys(table)
    )


def upgrade() -> None:
    if not _has_table("cases"):
        op.create_table(
            "cases",
            sa.Column("case_id", sa.String(length=200), nullable=False),
            sa.Column("name", sa.String(length=255), nullable=True),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("case_id"),
        )

    connection = op.get_bind()
    existing_case_ids = connection.execute(
        sa.text("SELECT DISTINCT case_id FROM evidence")
    ).scalars()
    case_table = sa.table(
        "cases",
        sa.column("case_id", sa.String(length=200)),
        sa.column("created_at", sa.DateTime(timezone=True)),
    )
    for case_id in existing_case_ids:
        if connection.execute(
            sa.select(case_table.c.case_id).where(case_table.c.case_id == case_id)
        ).scalar_one_or_none() is None:
            connection.execute(
                sa.insert(case_table).values(
                    case_id=case_id,
                    created_at=sa.func.now(),
                )
            )

    if not _has_table("case_memberships"):
        op.create_table(
            "case_memberships",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("user_id", sa.Uuid(), nullable=False),
            sa.Column("case_id", sa.String(length=200), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["case_id"], ["cases.case_id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "user_id", "case_id", name="uq_case_memberships_user_case"
            ),
        )
        op.create_index(
            "ix_case_memberships_case_user",
            "case_memberships",
            ["case_id", "user_id"],
        )
    elif not _has_foreign_key("case_memberships", "case_id", "cases"):
        if op.get_bind().dialect.name == "sqlite":
            with op.batch_alter_table("case_memberships", recreate="always") as batch:
                batch.create_foreign_key(
                    "fk_case_memberships_case_id_cases",
                    "cases",
                    ["case_id"],
                    ["case_id"],
                    ondelete="CASCADE",
                )
        else:
            op.create_foreign_key(
                "fk_case_memberships_case_id_cases",
                "case_memberships",
                "cases",
                ["case_id"],
                ["case_id"],
                ondelete="CASCADE",
            )

    if not _has_foreign_key("evidence", "case_id", "cases"):
        if op.get_bind().dialect.name == "sqlite":
            with op.batch_alter_table("evidence", recreate="always") as batch:
                batch.create_foreign_key(
                    "fk_evidence_case_id_cases",
                    "cases",
                    ["case_id"],
                    ["case_id"],
                    ondelete="RESTRICT",
                )
        else:
            op.create_foreign_key(
                "fk_evidence_case_id_cases",
                "evidence",
                "cases",
                ["case_id"],
                ["case_id"],
                ondelete="RESTRICT",
            )


def downgrade() -> None:
    if _has_foreign_key("evidence", "case_id", "cases"):
        with op.batch_alter_table("evidence", recreate="always") as batch:
            batch.drop_constraint("fk_evidence_case_id_cases", type_="foreignkey")
    if _has_foreign_key("case_memberships", "case_id", "cases") and (
        op.get_bind().dialect.name != "sqlite"
    ):
        with op.batch_alter_table("case_memberships", recreate="always") as batch:
            batch.drop_constraint(
                "fk_case_memberships_case_id_cases", type_="foreignkey"
            )
    if _has_table("case_memberships"):
        op.drop_index("ix_case_memberships_case_user", table_name="case_memberships")
        op.drop_table("case_memberships")
    if _has_table("cases"):
        op.drop_table("cases")
