from datetime import datetime, timedelta, timezone  # forging an expired token

import jwt  # build tokens by hand

from app.config import settings  # JWT secret
from app.db import SessionLocal  # direct DB access
from app.models import User  # deactivate users
from tests.conftest import login  # login helper


def form(email, password):  # login form body
    return {"username": email, "password": password}  # OAuth2 field names


def test_login_and_me(client, admin_user):  # login returns a working token
    response = client.post("/auth/login", data=form(admin_user["email"], admin_user["password"]))  # good credentials
    assert response.status_code == 200  # logged in
    body = response.json()  # token payload
    assert body["token_type"] == "bearer" and body["expires_in"] == settings.jwt_expire_minutes * 60  # bearer token, lifetime in seconds
    assert body["user"]["email"] == admin_user["email"] and "password_hash" not in body["user"]  # right user, hash never leaked
    me = client.get("/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"})  # use the token
    assert me.status_code == 200 and me.json()["role"] == "admin"  # token accepted


def test_wrong_password_and_unknown_email(client, admin_user):  # bad logins look identical
    for data in (form(admin_user["email"], "wrong-password"), form("nobody@tut.ac.za", "whatever1")):  # both cases
        response = client.post("/auth/login", data=data)  # try to log in
        assert response.status_code == 401 and response.json()["detail"] == "invalid_credentials"  # same answer


def test_inactive_user(client, lecturer_user):  # deactivated users are locked out
    headers = login(client, lecturer_user["email"], lecturer_user["password"])  # token issued while active
    with SessionLocal() as db:  # deactivate afterwards
        db.get(User, lecturer_user["id"]).is_active = False  # disabled
        db.commit()  # save
    response = client.post("/auth/login", data=form(lecturer_user["email"], lecturer_user["password"]))  # fresh login
    assert response.status_code == 401 and response.json()["detail"] == "invalid_credentials"  # refused
    response = client.get("/auth/me", headers=headers)  # old token
    assert response.status_code == 401 and response.json()["detail"] == "inactive_user"  # also refused


def test_expired_and_garbage_tokens(client, admin_user):  # bad tokens are rejected
    past = datetime.now(timezone.utc) - timedelta(hours=1)  # an hour ago
    expired = jwt.encode({"sub": str(admin_user["id"]), "role": "admin", "iat": past, "exp": past + timedelta(minutes=30)}, settings.JWT_secret_key, algorithm="HS256")  # expired 30 min ago
    response = client.get("/auth/me", headers={"Authorization": f"Bearer {expired}"})  # use the expired token
    assert response.status_code == 401 and response.json()["detail"] == "token_expired"  # refused as expired
    response = client.get("/auth/me", headers={"Authorization": "Bearer not.a.token"})  # use garbage
    assert response.status_code == 401 and response.json()["detail"] == "invalid_token"  # refused as invalid
    forged = jwt.encode({"sub": str(admin_user["id"]), "exp": datetime.now(timezone.utc) + timedelta(minutes=5)}, "wrong-secret-wrong-secret-wrong-secret", algorithm="HS256")  # bad signature
    assert client.get("/auth/me", headers={"Authorization": f"Bearer {forged}"}).json()["detail"] == "invalid_token"  # forged token refused


def test_role_guards(client, lecturer_headers):  # admin routes need an admin
    assert client.get("/admin/users").status_code == 401  # no token
    response = client.get("/admin/users", headers=lecturer_headers)  # lecturer tries an admin route
    assert response.status_code == 403 and response.json()["detail"] == "forbidden"  # wrong role


def test_email_is_case_insensitive(client, admin_user):  # email is trimmed and lower-cased
    assert client.post("/auth/login", data=form("  ADMIN@Tut.AC.za ", admin_user["password"])).status_code == 200  # messy email still logs in


def test_change_password(client, lecturer_user, lecturer_headers):  # users can change their own password
    wrong = client.post("/auth/change-password", json={"current_password": "nope", "new_password": "NewPassw0rd"}, headers=lecturer_headers)  # wrong current password
    assert wrong.status_code == 400 and wrong.json()["detail"] == "wrong_current_password"  # refused
    assert client.post("/auth/change-password", json={"current_password": lecturer_user["password"], "new_password": "NewPassw0rd"}, headers=lecturer_headers).status_code == 204  # changed
    assert client.post("/auth/login", data=form(lecturer_user["email"], "NewPassw0rd")).status_code == 200  # new password works
    assert client.post("/auth/login", data=form(lecturer_user["email"], lecturer_user["password"])).status_code == 401  # old one does not
