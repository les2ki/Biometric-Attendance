import json
import os
import secrets
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Load the dedicated test database URL before importing the application.
env_file = Path(__file__).resolve().parents[2] / ".env"
lines = env_file.read_text(encoding="utf-8").splitlines()
test_url = next(
    (
        line.split("=", 1)[1].strip()
        for line in lines
        if line.strip().startswith("test_database_url=")
    ),
    None,
)
if not test_url or not test_url.endswith("_test"):
    raise RuntimeError("Add test_database_url=...attendance_test to .env")
os.environ["database_url"] = test_url

from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Course, CourseLecturer, CourseStudent, Device, FingerprintSlot, LectureSession, Role, Student, User  # noqa: E402
from app.security import compute_signature  # noqa: E402
import app.auth as auth_module  # noqa: E402  # to swap in a fast hasher
from pwdlib import PasswordHash  # noqa: E402  # hasher container
from pwdlib.hashers.argon2 import Argon2Hasher  # noqa: E402  # tunable argon2

auth_module.password_hasher = PasswordHash((Argon2Hasher(time_cost=1, memory_cost=1024),))  # cheap argon2 so tests stay fast
PASSWORD = "Passw0rd!"  # every test account uses this


@pytest.fixture(autouse=True)
def fresh_db():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def make_user(email: str, name: str, role: Role) -> int:  # insert an account with the known password
    with SessionLocal() as db:  # own session
        user = User(email=email, full_name=name, password_hash=auth_module.hash_password(PASSWORD), role=role, is_active=True)  # hashed like production
        db.add(user)  # queue insert
        db.commit()  # save
        return user.id  # its ID


@pytest.fixture
def admin_user() -> dict:  # an admin account
    return {"id": make_user("admin@tut.ac.za", "Ada Admin", Role.admin), "email": "admin@tut.ac.za", "password": PASSWORD}  # id + credentials


@pytest.fixture
def lecturer_user() -> dict:  # the lecturer who teaches PD2316D
    return {"id": make_user("lecturer@tut.ac.za", "Lee Lecturer", Role.lecturer), "email": "lecturer@tut.ac.za", "password": PASSWORD}  # id + credentials


@pytest.fixture
def other_lecturer() -> dict:  # a lecturer with no courses
    return {"id": make_user("other@tut.ac.za", "Olive Other", Role.lecturer), "email": "other@tut.ac.za", "password": PASSWORD}  # id + credentials


def login(client, email: str, password: str) -> dict:  # log in and return auth headers
    response = client.post("/auth/login", data={"username": email, "password": password})  # form login
    assert response.status_code == 200, response.text  # must succeed
    return {"Authorization": f"Bearer {response.json()['access_token']}"}  # bearer header


@pytest.fixture
def admin_headers(client, admin_user) -> dict:  # logged-in admin
    return login(client, admin_user["email"], admin_user["password"])  # headers


@pytest.fixture
def lecturer_headers(client, lecturer_user) -> dict:  # logged-in lecturer
    return login(client, lecturer_user["email"], lecturer_user["password"])  # headers


@pytest.fixture
def other_lecturer_headers(client, other_lecturer) -> dict:  # logged-in lecturer without courses
    return login(client, other_lecturer["email"], other_lecturer["password"])  # headers


@pytest.fixture
def world(lecturer_user) -> dict:
    with SessionLocal() as db:
        lecturer = db.get(User, lecturer_user["id"])  # the course lecturer
        device = Device(name="t1", hmac_secret="s" * 64)
        yes = Student(
            student_number="111",
            full_name="Has Consent",
            biometric_consent=True,
        )
        no = Student(
            student_number="222",
            full_name="No Consent",
            biometric_consent=False,
        )
        off = Student(student_number="333", full_name="Off Roster", biometric_consent=True)  # consented but not on the class list
        course = Course(code="PD2316D", name="Project Design III")  # the demo course
        db.add_all([lecturer, device, yes, no, off, course])  # includes the off-roster student and the course
        db.flush()
        db.add(CourseLecturer(course_id=course.id, user_id=lecturer.id))  # lecturer teaches it
        db.add_all([CourseStudent(course_id=course.id, student_id=yes.id), CourseStudent(course_id=course.id, student_id=no.id)])  # 111 + 222 on the roster
        session = LectureSession(
            course_id=course.id,  # sessions belong to a course now
            venue="Lab",
            lecturer_id=lecturer.id,
            device_id=device.id,
        )
        db.add(session)
        db.commit()
        return {
            "device_id": device.id,
            "secret": device.hmac_secret,
            "session_id": session.id,
            "course_id": course.id,  # PD2316D
            "lecturer_id": lecturer.id,  # its lecturer
            "student_yes": yes.id,  # 111 (consent, on roster)
            "student_no": no.id,  # 222 (no consent, on roster)
            "student_off": off.id,  # 333 (consent, NOT on roster)
        }


@pytest.fixture
def call(client, world):
    def _call(
        method,
        path,
        payload=None,
        *,
        timestamp=None,
        nonce=None,
        secret=None,
    ):
        body = json.dumps(payload).encode() if payload is not None else b""
        timestamp_value = timestamp if timestamp is not None else int(time.time())
        nonce_value = nonce or secrets.token_hex(16)
        signature = compute_signature(
            secret or world["secret"],
            method,
            path,
            timestamp_value,
            nonce_value,
            body,
        )
        headers = {
            "X-Device-Id": str(world["device_id"]),
            "X-Timestamp": str(timestamp_value),
            "X-Nonce": nonce_value,
            "X-Signature": signature,
            "Content-Type": "application/json",
        }
        return client.request(method, path, content=body, headers=headers)

    return _call


@pytest.fixture
def enrolled(world) -> dict:  # student 111 already in slot 1 of the test terminal
    with SessionLocal() as db:  # own session
        db.add(FingerprintSlot(device_id=world["device_id"], slot_number=1, student_id=world["student_yes"]))  # direct mapping
        db.commit()  # save
    return world  # same data
