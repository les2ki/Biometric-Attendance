from datetime import datetime, timedelta, timezone  # token timestamps
from typing import Annotated, Callable  # dependency typing

import jwt  # PyJWT
from fastapi import Depends, HTTPException, status  # FastAPI building blocks
from fastapi.security import OAuth2PasswordBearer  # reads "Authorization: Bearer <token>"
from pwdlib import PasswordHash  # argon2 hashing
from sqlalchemy import func, select  # queries
from sqlalchemy.orm import Session  # DB session type

from app.config import settings  # JWT_secret_key, jwt_expire_minutes
from app.db import get_db  # per-request session
from app.models import Role, User  # dashboard accounts

password_hasher = PasswordHash.recommended()  # argon2id with safe defaults
_DUMMY_HASH = password_hasher.hash("timing-equaliser")  # verified against when the email doesn't exist
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")  # also powers Swagger's "Authorize" button
JWT_ALGORITHM = "HS256"  # symmetric signing with JWT_secret_key


def hash_password(password: str) -> str:  # used when creating/resetting accounts
    return password_hasher.hash(password)  # salted argon2 hash


def verify_password(password: str, password_hash: str) -> bool:  # used by change-password
    return password_hasher.verify(password, password_hash)  # True when the password matches the hash


def authenticate(db: Session, email: str, password: str) -> User | None:  # returns the user only if credentials are valid
    user = db.scalars(select(User).where(func.lower(User.email) == email.strip().lower())).first()  # case-insensitive email match
    if user is None:  # unknown email
        password_hasher.verify(password, _DUMMY_HASH)  # same time cost, so attackers can't probe which emails exist
        return None  # fail
    if not password_hasher.verify(password, user.password_hash):  # wrong password
        return None  # fail
    if not user.is_active:  # disabled account
        return None  # fail (same error as wrong password)
    return user  # success


def create_access_token(user: User) -> tuple[str, int]:  # returns (token, lifetime in seconds)
    expires_in = settings.jwt_expire_minutes * 60  # 30 min by default
    now = datetime.now(timezone.utc)  # issue time
    payload = {"sub": str(user.id), "role": user.role.value, "iat": now, "exp": now + timedelta(seconds=expires_in)}  # standard claims
    return jwt.encode(payload, settings.JWT_secret_key, algorithm=JWT_ALGORITHM), expires_in  # signed token


def _unauthorised(code: str) -> HTTPException:  # 401 with the header browsers/clients expect
    return HTTPException(status.HTTP_401_UNAUTHORIZED, code, headers={"WWW-Authenticate": "Bearer"})  # build error


def get_current_user(token: Annotated[str, Depends(oauth2_scheme)], db: Annotated[Session, Depends(get_db)]) -> User:  # dependency for protected routes
    try:  # decoding can fail in several ways
        payload = jwt.decode(token, settings.JWT_secret_key, algorithms=[JWT_ALGORITHM])  # verifies signature + exp
        user_id = int(payload["sub"])  # user ID from the token
    except jwt.ExpiredSignatureError:  # token older than 30 min
        raise _unauthorised("token_expired")  # dashboard redirects to login
    except (jwt.InvalidTokenError, KeyError, ValueError):  # forged/garbled token
        raise _unauthorised("invalid_token")  # reject
    user = db.get(User, user_id)  # re-load from DB so deactivation/role changes apply immediately
    if user is None or not user.is_active:  # deleted or disabled since login
        raise _unauthorised("inactive_user")  # reject
    return user  # authenticated user


CurrentUser = Annotated[User, Depends(get_current_user)]  # any logged-in user


def require_roles(*roles: Role) -> Callable[..., User]:  # builds a role-checking dependency
    def checker(user: CurrentUser) -> User:  # runs after authentication
        if user.role not in roles:  # role from the DB, not from the token
            raise HTTPException(status.HTTP_403_FORBIDDEN, "forbidden")  # logged in but not allowed
        return user  # allowed
    return checker  # the dependency


AdminUser = Annotated[User, Depends(require_roles(Role.admin))]  # admin-only routes
StaffUser = Annotated[User, Depends(require_roles(Role.admin, Role.lecturer))]  # lecturer routes (admins allowed too)
