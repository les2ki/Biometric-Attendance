from fastapi import APIRouter  # routing
from pydantic import AwareDatetime  # timezone-aware query params
from sqlalchemy import func, select  # query builders

from app.auth import AdminUser  # admin guard
from app.models import AuditLog, User  # audit table + actor names
from app.routers.common import DbSession, PageParams  # shared dependencies
from app.schemas.admin import AuditOut  # response shape
from app.schemas.common import Page  # paged list

router = APIRouter(prefix="/admin/audit", tags=["admin"])  # read-only: no update/delete routes exist (append-only)


@router.get("", response_model=Page[AuditOut])  # browse the audit trail, newest first
def list_audit(admin: AdminUser, db: DbSession, page: PageParams, action: str | None = None, entity: str | None = None, actor_user_id: int | None = None, since: AwareDatetime | None = None, until: AwareDatetime | None = None) -> Page[AuditOut]:  # optional filters
    stmt = select(AuditLog, User.full_name).outerjoin(User, User.id == AuditLog.actor_user_id)  # row + actor name (None for system)
    if action:  # prefix match, e.g. "attendance."
        stmt = stmt.where(AuditLog.action.startswith(action, autoescape=True))  # LIKE 'action%' with wildcards escaped
    if entity:  # table filter
        stmt = stmt.where(AuditLog.entity == entity)  # exact match
    if actor_user_id is not None:  # who did it
        stmt = stmt.where(AuditLog.actor_user_id == actor_user_id)  # exact match
    if since is not None:  # from
        stmt = stmt.where(AuditLog.created_at >= since)  # inclusive
    if until is not None:  # to
        stmt = stmt.where(AuditLog.created_at < until)  # exclusive
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))  # rows matching the filter
    rows = db.execute(stmt.order_by(AuditLog.created_at.desc(), AuditLog.id.desc()).limit(page.limit).offset(page.offset)).all()  # newest first
    items = [AuditOut(id=a.id, created_at=a.created_at, actor_user_id=a.actor_user_id, actor_name=name, action=a.action, entity=a.entity, entity_id=a.entity_id, details=a.details or {}) for a, name in rows]  # build responses
    return Page[AuditOut](items=items, total=total)  # response
