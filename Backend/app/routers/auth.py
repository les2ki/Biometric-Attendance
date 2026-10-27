from typing import Annotated  # dependency typing

from fastapi import APIRouter, Depends, HTTPException, status  # routing + errors
from fastapi.security import OAuth2PasswordRequestForm  # username/password form (Swagger-compatible)

from app.auth import CurrentUser, authenticate, create_access_token, hash_password, verify_password  # auth helpers
from app.routers.common import DbSession  # DB session dependency
from app.schemas.auth import ChangePasswordIn, TokenOut, UserOut  # request/response shapes
from app.services.audit import write_audit  # audit trail

router = APIRouter(prefix="/auth", tags=["auth"])  # every route here starts with /auth


@router.post("/login", response_model=TokenOut)  # dashboard login (form fields, not JSON)
def login(form: Annotated[OAuth2PasswordRequestForm, Depends()], db: DbSession) -> TokenOut:  # username = email
    user = authenticate(db, form.username, form.password)  # check credentials
    if user is None:  # wrong email, wrong password or disabled
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid_credentials", headers={"WWW-Authenticate": "Bearer"})  # one error for all cases
    token, expires_in = create_access_token(user)  # signed JWT
    return TokenOut(access_token=token, expires_in=expires_in, user=UserOut.model_validate(user))  # token + who it is


@router.get("/me", response_model=UserOut)  # who am I?
def me(user: CurrentUser) -> UserOut:  # any logged-in user
    return UserOut.model_validate(user)  # no password hash


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)  # user changes their own password (P2)
def change_password(payload: ChangePasswordIn, user: CurrentUser, db: DbSession) -> None:  # validated body
    if not verify_password(payload.current_password, user.password_hash):  # must know the old one
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "wrong_current_password")  # stop
    user.password_hash = hash_password(payload.new_password)  # store the new hash
    write_audit(db, actor=user, action="auth.password_changed", entity="users", entity_id=user.id)  # audit (never the password)
    db.commit()  # change + audit together
