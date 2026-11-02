"""face templates and face commands

Revision ID: f7c1a9e2d4b6
Revises: c483c59c3d50
Create Date: 2026-11-02 10:00:00

"""
from typing import Sequence, Union

from alembic import op  # migration helpers
import sqlalchemy as sa  # column types


# revision identifiers, used by Alembic.
revision: str = 'f7c1a9e2d4b6'
down_revision: Union[str, Sequence[str], None] = 'c483c59c3d50'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.get_context().autocommit_block():  # Postgres adds enum values outside a transaction
        op.execute("ALTER TYPE command_type ADD VALUE IF NOT EXISTS 'face_enrol'")  # admin: store a face
        op.execute("ALTER TYPE command_type ADD VALUE IF NOT EXISTS 'face_verify'")  # admin/lecturer: check a face
    op.add_column("device_commands", sa.Column("session_id", sa.Integer(), nullable=True))  # session to mark present after a lecturer's verify
    op.create_foreign_key("fk_device_commands_session_id_sessions", "device_commands", "sessions", ["session_id"], ["id"], ondelete="SET NULL")  # link
    op.create_table(  # one face template per student
        "face_templates",
        sa.Column("id", sa.Integer(), nullable=False),  # primary key
        sa.Column("student_id", sa.Integer(), nullable=False),  # owner
        sa.Column("embedding", sa.LargeBinary(), nullable=False),  # 128 float32 = 512 bytes
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),  # enrolled at
        sa.ForeignKeyConstraint(["student_id"], ["students.id"], name="fk_face_templates_student_id_students", ondelete="CASCADE"),  # deleted with the student
        sa.PrimaryKeyConstraint("id", name="pk_face_templates"),  # primary key
        sa.UniqueConstraint("student_id", name="uq_face_templates_student_id"),  # one per student
    )


def downgrade() -> None:
    op.drop_table("face_templates")  # templates
    op.drop_constraint("fk_device_commands_session_id_sessions", "device_commands", type_="foreignkey")  # link
    op.drop_column("device_commands", "session_id")  # column
    op.execute("DELETE FROM device_commands WHERE type IN ('face_enrol', 'face_verify')")  # rows using the new values
    # Postgres can't drop single enum values; 'face_enrol'/'face_verify' stay in command_type (harmless).
