from sqlalchemy.orm import Session  # DB session type

from app.models import AuditLog, User  # audit table + actor type


def write_audit(db: Session, *, actor: User | None, action: str, entity: str, entity_id: str | int, details: dict | None = None) -> None:  # queue one audit row
    db.add(AuditLog(  # append-only history row
        actor_user_id=actor.id if actor is not None else None,  # None = system / terminal
        action=action,  # e.g. "attendance.revoked"
        entity=entity,  # table affected
        entity_id=str(entity_id),  # stored as text so any key type fits
        details=details or {},  # before/after values
    ))  # NOT committed here: the caller commits it together with the change
