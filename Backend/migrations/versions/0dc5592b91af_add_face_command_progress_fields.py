"""add face command progress fields

Revision ID: 0dc5592b91af
Revises: f7c1a9e2d4b6
Create Date: 2026-11-02 11:30:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0dc5592b91af"
down_revision: Union[str, Sequence[str], None] = "f7c1a9e2d4b6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("attendance", sa.Column("face_score", sa.Float(), nullable=True))
    op.add_column("device_commands", sa.Column("frames_received", sa.Integer(), server_default="0", nullable=False))
    op.add_column("device_commands", sa.Column("face_score", sa.Float(), nullable=True))
    op.alter_column("device_commands", "frames_received", server_default=None)


def downgrade() -> None:
    op.drop_column("device_commands", "face_score")
    op.drop_column("device_commands", "frames_received")
    op.drop_column("attendance", "face_score")
