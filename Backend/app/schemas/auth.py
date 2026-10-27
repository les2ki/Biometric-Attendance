from datetime import datetime  # timestamp fields
from typing import Literal  # fixed token type

from pydantic import BaseModel, ConfigDict, Field  # validation

from app.models import Role  # admin / lecturer


class UserOut(BaseModel):  # a dashboard account as the API shows it (never the hash)
    model_config = ConfigDict(from_attributes=True)  # build straight from a User row
    id: int  # user ID
    email: str  # login name
    full_name: str  # display name
    role: Role  # admin / lecturer
    is_active: bool  # disabled accounts can't log in
    created_at: datetime  # when the account was made


class TokenOut(BaseModel):  # login response
    access_token: str  # the JWT
    token_type: Literal["bearer"] = "bearer"  # OAuth2 convention
    expires_in: int  # lifetime in seconds
    user: UserOut  # who logged in (saves a /auth/me call)


class ChangePasswordIn(BaseModel):  # body of /auth/change-password
    current_password: str = Field(min_length=1, max_length=128)  # proves it's really the user
    new_password: str = Field(min_length=8, max_length=128)  # the new password
