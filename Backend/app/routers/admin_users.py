from fastapi import APIRouter, HTTPException, status  # routing + errors
from sqlalchemy import func, or_, select  # query builders
from sqlalchemy.exc import IntegrityError  # unique email clash

from app.auth import AdminUser, hash_password  # admin guard + hashing
from app.models import Role, User  # users table
from app.routers.common import DbSession, PageParams, page_rows  # shared dependencies
from app.schemas.admin import PasswordResetIn, UserCreate, UserUpdate  # request shapes
from app.schemas.auth import UserOut  # response shape
from app.schemas.common import Page  # paged list
from app.services.audit import write_audit  # audit trail

router = APIRouter(prefix="/admin/users", tags=["admin"])  # every route here starts with /admin/users


def _snapshot(user: User) -> dict:  # fields an admin can change, for before/after audit
    return {"full_name": user.full_name, "role": user.role.value, "is_active": user.is_active}  # JSON-safe


@router.get("", response_model=Page[UserOut])  # list accounts
def list_users(admin: AdminUser, db: DbSession, page: PageParams, role: Role | None = None, search: str | None = None) -> Page[UserOut]:  # optional filters
    stmt = select(User).order_by(User.full_name, User.id)  # alphabetical
    if role is not None:  # filter by role
        stmt = stmt.where(User.role == role)  # admin / lecturer
    if search:  # free-text filter
        stmt = stmt.where(or_(User.email.ilike(f"%{search}%"), User.full_name.ilike(f"%{search}%")))  # email or name contains
    rows, total = page_rows(db, stmt, page)  # one page
    return Page[UserOut](items=[UserOut.model_validate(u) for u in rows], total=total)  # no password hashes


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)  # create an admin or lecturer
def create_user(payload: UserCreate, admin: AdminUser, db: DbSession) -> UserOut:  # validated body
    email = payload.email.lower()  # emails stored lower-case
    if db.scalars(select(User).where(func.lower(User.email) == email)).first():  # already used
        raise HTTPException(status.HTTP_409_CONFLICT, "email_taken")  # stop
    user = User(email=email, full_name=payload.full_name, role=payload.role, password_hash=hash_password(payload.password), is_active=True)  # new account
    db.add(user)  # queue insert
    try:  # unique email is the final guard
        db.flush()  # get user.id
    except IntegrityError:  # raced with another create
        db.rollback()  # undo
        raise HTTPException(status.HTTP_409_CONFLICT, "email_taken")  # stop
    write_audit(db, actor=admin, action="user.created", entity="users", entity_id=user.id, details={"email": email, "role": payload.role.value})  # audit (never the password)
    db.commit()  # user + audit together
    return UserOut.model_validate(user)  # no hash


@router.patch("/{user_id}", response_model=UserOut)  # change name/role/active (P2)
def update_user(user_id: int, payload: UserUpdate, admin: AdminUser, db: DbSession) -> UserOut:  # validated body
    user = db.get(User, user_id)  # look it up
    if user is None:  # bad ID
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user_not_found")  # stop
    new_role = payload.role if payload.role is not None else user.role  # role after the change
    new_active = payload.is_active if payload.is_active is not None else user.is_active  # active flag after the change
    if user.id == admin.id and (new_role != user.role or new_active != user.is_active):  # admin changing their own role/active
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "cannot_modify_self")  # stop (avoids self lock-out)
    if user.role == Role.admin and user.is_active and (new_role != Role.admin or not new_active):  # removing an active admin
        others = db.scalar(select(func.count()).select_from(User).where(User.role == Role.admin, User.is_active.is_(True), User.id != user.id))  # other active admins
        if not others:  # this is the last one
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "last_admin")  # stop
    before = _snapshot(user)  # for the audit row
    if payload.full_name is not None:  # name change
        user.full_name = payload.full_name  # apply
    user.role = new_role  # apply (course_lecturers rows stay, inert if no longer a lecturer)
    user.is_active = new_active  # apply
    write_audit(db, actor=admin, action="user.updated", entity="users", entity_id=user.id, details={"before": before, "after": _snapshot(user)})  # audit
    db.commit()  # change + audit together
    return UserOut.model_validate(user)  # updated account


@router.post("/{user_id}/reset-password", status_code=status.HTTP_204_NO_CONTENT)  # admin sets a new password (P2)
def reset_password(user_id: int, payload: PasswordResetIn, admin: AdminUser, db: DbSession) -> None:  # validated body
    user = db.get(User, user_id)  # look it up
    if user is None:  # bad ID
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user_not_found")  # stop
    user.password_hash = hash_password(payload.new_password)  # store the new hash
    write_audit(db, actor=admin, action="user.password_reset", entity="users", entity_id=user.id)  # audit (never the password)
    db.commit()  # change + audit together
