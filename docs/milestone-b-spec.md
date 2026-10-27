# Milestone B — Dashboard API (backend) — Implementation Spec

Project: Biometric Student Attendance and Verification System
Audience: the coding agent implementing this, plus Bubbles reviewing it
Prerequisite: Milestone A complete (terminal API, HMAC, 9 passing tests)
Output of this milestone: every endpoint the Next.js dashboard needs, protected by login + roles, with tests.
The Next.js dashboard itself is a separate spec (Milestone B-UI) written after this one passes.

---

## 0. Read this first (agent instructions)

### 0.1 Environment

- OS: Windows, PowerShell. Python **3.10.4** (do not use 3.11+ syntax such as `typing.Self` or `except*`).
- Project root: `C:\Users\ACER\OneDrive\Desktop\Biometric attendance\Biometrics Project folder`
- Virtual env: `<root>\.venv`. Activate from `Backend` with `..\.venv\Scripts\Activate.ps1`.
- **Run every command from `<root>\Backend`** (`alembic.ini`, `app/`, `tests/` live there).
- Settings come from `<root>\.env`, loaded by the custom loader in `app/config.py` (not pydantic-settings). Keys are lower-case except `JWT_secret_key`.
- Databases: dev = `attendance`, tests = `attendance_test` (wiped every test). Never point tests at `attendance`.
- `<root>\migrations` and `<root>\alembic.ini` must NOT exist (move to `archive/` if present). Only `Backend\migrations` is valid.

### 0.2 Coding conventions (mandatory — the owner's standing rules)

1. **Every new line of code gets a short explanatory end-of-line comment** (the owner learns from the code). Blank lines and closing brackets excepted.
2. **When editing an existing file, do not rewrite, restyle, reorder or reword existing code or comments.** Only add the lines needed, and change only the lines that must change for the feature. Match the existing terse comment style.
3. Timestamps: always timezone-aware UTC (`datetime.now(timezone.utc)`). Never naive datetimes.
4. Errors: `HTTPException(status, "<snake_case_code>")`. The `detail` is a machine-readable code the dashboard/terminal switches on (list in §11).
5. Every state-changing admin/lecturer action writes an `AuditLog` row **in the same transaction** as the change (one `db.commit()`).
6. Response models never contain `password_hash` or `hmac_secret` (except the one-time secret on device create/rotate).
7. Use SQLAlchemy 2.0 style (`select()`, `db.scalars()`, `db.get()`), sync sessions (existing `get_db`).
8. Keep business logic in `app/services/*`; routers stay thin (validate → call service/query → return).
9. After each work package, run `python -m pytest -q` — all tests (old + new) must pass before moving on.

### 0.3 Locked decisions (agreed with the owner — do not change)

| # | Decision |
|---|---|
| D1 | Roles that log in: **admin** and **lecturer** only. **Students never log in**; they interact only via the terminal. |
| D2 | **Class lists exist**: `courses`, `course_lecturers` (many-to-many), `course_students` (roster). Every session belongs to a course. Attendance from students not on the roster is rejected (`not_in_course`). Reports show present **and absent**. |
| D3 | **Enrolment and biometric deletion are admin-initiated** and delivered to the terminal through a **command queue the terminal polls** (terminal has no keypad). The old free-form `POST /device/enrolments` is **removed**. |
| D4 | Auth = **JWT bearer token** (HS256, 30 min, `Authorization: Bearer <token>`). Dashboard keeps it in memory/sessionStorage. No cookies, no refresh tokens. |
| D5 | **Lecturers see only courses they are assigned to.** Admins see everything and may also call lecturer endpoints. A lecturer requesting another course's data gets **404** (not 403 — don't leak existence). |
| D6 | Manual (non-biometric) attendance and corrections are done by the **lecturer on the dashboard**, always with a reason, always audited. Corrections never delete rows: they **revoke** (soft-delete) or **reinstate**. |
| D7 | The server assigns fingerprint slot numbers (lowest free slot per terminal). The terminal stores the template in exactly the slot it is told. |

### 0.4 Priority / scope cut line

Time is short (mock presentation ~20 Oct, final 3–4 Nov). Implement **P1 first, end-to-end, tests green**, then P2.

- **P1 (must have for demo):** auth, users (create/list), students (create/list/detail/consent), courses + rosters + lecturer assignment, devices (create/list), enrol + delete commands, terminal command protocol, sessions open/close/list, live attendance roster, manual mark, revoke, CSV export, audit log list, CORS, seed, tests.
- **P2 (nice to have):** user PATCH/reset-password, device rotate-secret, command cancel, roster CSV import, course attendance report, student PATCH, change-password.

---

## 1. Work packages and order

| WP | Content | Checkpoint |
|---|---|---|
| B0 | Dependencies + new settings | `python -c "import jwt, pwdlib, multipart, tzdata"` succeeds |
| B1 | Models + Alembic migration (with data backfill) | `alembic upgrade head` OK; `alembic downgrade -1` then `upgrade head` OK |
| B2 | Auth (`app/auth.py`, `/auth/*`), `create_admin` script | Login works in Swagger "Authorize" |
| B3 | Services: audit, access, commands | Unit-covered via B9 tests |
| B4 | Terminal protocol changes (`/device/*`) | Updated device tests pass |
| B5 | Admin endpoints (`/admin/*`) | Admin tests pass |
| B6 | Lecturer endpoints (`/lecturer/*`) | Lecturer tests pass |
| B7 | `main.py`: CORS + routers | `/docs` shows auth, admin, lecturer, device tags |
| B8 | Seed + fake terminal updates | Manual walkthrough §10 works |
| B9 | Tests (full list §9) | `python -m pytest -q` all green |
| B10 | Update design doc notes (§12) | Owner reviews |

---

## 2. B0 — Dependencies and settings

```powershell
..\.venv\Scripts\Activate.ps1
pip install pyjwt "pwdlib[argon2]" python-multipart tzdata email-validator
pip freeze > requirements.txt
```

- `python-multipart`: required for the OAuth2 login form and CSV upload.
- `tzdata`: Windows has no IANA timezone database; needed for `zoneinfo.ZoneInfo("Africa/Johannesburg")` in CSV export.
- `email-validator`: required by pydantic `EmailStr`.

### 2.1 `.env` — add these keys (do not touch existing values)

```
cors_origins=http://localhost:3000,http://127.0.0.1:3000
fp_slot_capacity=127
command_ttl_minutes=10
device_online_seconds=30
display_timezone=Africa/Johannesburg
```

Also add the same keys (with these defaults) to `.env.example`, plus placeholder lines for every existing key.

### 2.2 `app/config.py` — add lines only

Inside `Settings.__init__`, after the existing `fp_accept_confidence` line, add:

```python
        self.cors_origins = [o.strip() for o in os.getenv("cors_origins", "http://localhost:3000").split(",") if o.strip()]  # dashboard URLs allowed by CORS
        self.fp_slot_capacity = int(os.getenv("fp_slot_capacity", "127"))  # highest sensor slot the server may assign
        self.command_ttl_minutes = int(os.getenv("command_ttl_minutes", "10"))  # how long an enrol command stays valid
        self.device_online_seconds = int(os.getenv("device_online_seconds", "30"))  # last_seen within this = "online"
        self.display_timezone = os.getenv("display_timezone", "Africa/Johannesburg")  # timezone used in CSV exports
```

And matching class-level annotations at the bottom with the existing ones:

```python
    #dashboard settings
    cors_origins: list[str]  # allowed browser origins
    fp_slot_capacity: int = 127  # R307 slots the server hands out (1..capacity)
    command_ttl_minutes: int = 10  # enrol command lifetime
    device_online_seconds: int = 30  # online threshold for the dashboard
    display_timezone: str = "Africa/Johannesburg"  # CSV export timezone
```

---

## 3. B1 — Data model changes

### 3.1 New enums and tables (append to `app/models.py`)

Add `Index` and `true` to the existing sqlalchemy import line, and `relationship` to the `sqlalchemy.orm` import line (edit only those import lines).

```python
class CommandType(str, enum.Enum):  # what the terminal is asked to do
    enrol = "enrol"  # capture a finger into slot_number for student_id
    delete_slot = "delete_slot"  # wipe slot_number from the sensor (POPIA deletion)


class CommandStatus(str, enum.Enum):  # life cycle of a terminal command
    pending = "pending"  # queued, terminal hasn't picked it up
    in_progress = "in_progress"  # terminal claimed it (e.g. LCD shows "Place finger")
    done = "done"  # terminal reported success
    failed = "failed"  # terminal reported failure
    cancelled = "cancelled"  # admin or server cancelled it
    expired = "expired"  # deadline passed before completion


class Course(Base):  # a module/class, e.g. PD2316D
    __tablename__ = "courses"  # table name
    id: Mapped[int] = mapped_column(primary_key=True)  # primary key
    code: Mapped[str] = mapped_column(String(20), unique=True)  # e.g. "PD2316D"
    name: Mapped[str] = mapped_column(String(120))  # e.g. "Project Design III"
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())  # archived courses hidden from session creation
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())  # set by the DB


class CourseLecturer(Base):  # which lecturers teach which course (many-to-many)
    __tablename__ = "course_lecturers"  # table name
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), primary_key=True)  # part 1 of composite key
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)  # part 2 of composite key


class CourseStudent(Base):  # class list / roster
    __tablename__ = "course_students"  # table name
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), primary_key=True)  # part 1 of composite key
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), primary_key=True)  # part 2 of composite key
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())  # when added to the roster


class DeviceCommand(Base):  # work queued for a terminal (enrol a finger / wipe a slot)
    __tablename__ = "device_commands"  # table name
    __table_args__ = (Index("ix_device_commands_device_status", "device_id", "status"),)  # fast "next command for this device" lookup
    id: Mapped[int] = mapped_column(primary_key=True)  # command ID the terminal reports back on
    device_id: Mapped[int] = mapped_column(ForeignKey("devices.id"))  # target terminal
    type: Mapped[CommandType] = mapped_column(Enum(CommandType, name="command_type"))  # enrol / delete_slot
    status: Mapped[CommandStatus] = mapped_column(Enum(CommandStatus, name="command_status"), default=CommandStatus.pending)  # life cycle state
    slot_number: Mapped[int]  # sensor slot to fill or wipe
    student_id: Mapped[int | None] = mapped_column(ForeignKey("students.id", ondelete="SET NULL"))  # student being enrolled (NULL for wipes after deletion)
    requested_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))  # admin who asked (NULL = system)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())  # queued at
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # deadline; NULL = never expires (wipes)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # when the terminal picked it up
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # when it finished (done/failed/cancelled/expired)
    result_detail: Mapped[str | None] = mapped_column(String(255))  # terminal error text or cancel reason
```

### 3.2 Changes to existing models (minimal edits)

**`Student`** — add one column:

```python
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())  # inactive students can't be enrolled or marked
```

**`LectureSession`** — replace the `course_code` column line with a `course_id` FK, and add a relationship:

```python
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id"))  # the course this session belongs to
    course: Mapped["Course"] = relationship()  # convenience access: session.course.code
```

(`lecturer_id` stays = the lecturer who opened the session.)

**`Attendance`** — add five nullable columns:

```python
    recorded_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))  # lecturer who entered a manual/reinstated record
    note: Mapped[str | None] = mapped_column(String(255))  # reason given for a manual entry
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # soft delete: set when a lecturer invalidates the record
    revoked_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))  # who revoked it
    revoke_reason: Mapped[str | None] = mapped_column(String(255))  # why it was revoked
```

Rule everywhere: an attendance row **counts as present only if `revoked_at IS NULL`**. The unique `(student_id, session_id)` constraint stays: there is at most one row per student per session, revoked or not.

### 3.3 Migration (autogenerate, then hand-edit — REQUIRED)

```powershell
python -m alembic revision --autogenerate -m "milestone b courses rosters commands revocation"
```

Autogenerate will produce a non-nullable `sessions.course_id` and drop `course_code`, which **fails on existing rows**. Rewrite `upgrade()` in this order:

1. `op.create_table("courses", ...)`, `course_lecturers`, `course_students`, `device_commands` (+ index). Enum types `command_type`, `command_status` are created by `sa.Enum(..., name=...)`.
2. `op.add_column("students", sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False))`
3. Add the 5 attendance columns (all nullable) + their FKs.
4. `op.add_column("sessions", sa.Column("course_id", sa.Integer(), nullable=True))`
5. Backfill with `op.execute(...)`:
   ```sql
   INSERT INTO courses (code, name, is_active) SELECT DISTINCT course_code, course_code, true FROM sessions;
   UPDATE sessions s SET course_id = c.id FROM courses c WHERE c.code = s.course_code;
   INSERT INTO course_lecturers (course_id, user_id) SELECT DISTINCT course_id, lecturer_id FROM sessions;
   INSERT INTO course_students (course_id, student_id) SELECT DISTINCT s.course_id, a.student_id FROM attendance a JOIN sessions s ON s.id = a.session_id ON CONFLICT DO NOTHING;
   ```
6. `op.alter_column("sessions", "course_id", nullable=False)` + `op.create_foreign_key(...)` using the naming convention name `fk_sessions_course_id_courses`.
7. `op.drop_column("sessions", "course_code")`

`downgrade()` must reverse it: add `course_code` back (nullable), fill it from `courses.code`, set NOT NULL, drop `course_id`, drop the attendance/student columns, drop the four tables, then **explicitly drop the enum types** (`sa.Enum(name="command_status").drop(op.get_bind(), checkfirst=True)`, same for `command_type`) — autogenerate does not do this.

Checkpoint: `python -m alembic upgrade head`, then `python -m alembic downgrade -1`, then `python -m alembic upgrade head` — all succeed. Check in pgAdmin that the seed session now has a `course_id`.

---

## 4. B2 — Authentication

### 4.1 `app/auth.py` (new)

```python
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
```

### 4.2 `/auth` router (`app/routers/auth.py`)

| Method | Path | Auth | Body | Success | Errors |
|---|---|---|---|---|---|
| POST | `/auth/login` | none | **form** (`OAuth2PasswordRequestForm`): `username` (=email), `password` | 200 `TokenOut` | 401 `invalid_credentials` |
| GET | `/auth/me` | CurrentUser | — | 200 `UserOut` | 401 |
| POST | `/auth/change-password` (P2) | CurrentUser | `{current_password, new_password}` (new ≥ 8 chars) | 204 | 400 `wrong_current_password` |

- `TokenOut = {access_token: str, token_type: "bearer", expires_in: int, user: UserOut}`
- Login uses form fields (not JSON) so Swagger's Authorize button works. The dashboard sends `application/x-www-form-urlencoded`.
- Audit: `auth.password_changed` on change-password. (Login attempts are not audited in B; rate limiting is Milestone D.)

### 4.3 `scripts/create_admin.py` (new)

- Usage: `python -m scripts.create_admin --email admin@tut.ac.za --name "System Admin"`
- Prompts for the password twice with `getpass` (never a CLI argument), min 8 chars, must match.
- Lower-cases the email. Exits with a clear message if the email already exists.
- Writes audit `user.created` with `actor_user_id=None`, details `{"role": "admin", "via": "create_admin"}`.

---

## 5. B3 — Services

### 5.1 `app/services/__init__.py` (empty)

### 5.2 `app/services/audit.py`

`write_audit(db, *, actor: User | None, action: str, entity: str, entity_id: str | int, details: dict | None = None) -> None`
Adds an `AuditLog` row. **Does not commit** (caller commits with the change). Action names used in this milestone: see §11.2.

### 5.3 `app/services/access.py`

- `lecturer_course_ids(db, user) -> set[int] | None` — `None` means "all" (admin); otherwise the IDs from `course_lecturers`.
- `get_course_for_user(db, user, course_id) -> Course` — 404 `course_not_found` if missing or the lecturer isn't assigned.
- `get_session_for_user(db, user, session_id) -> LectureSession` — 404 `session_not_found` if missing or its course isn't accessible.

### 5.4 `app/services/commands.py`

- `expire_stale(db, device_id, now) -> None` — commands with status `pending`/`in_progress` and `expires_at < now` → `expired`, `completed_at=now`. (Wipes have `expires_at=NULL`, so they never expire.)
- `reserved_slots(db, device_id) -> set[int]` — union of: slots in `fingerprint_slots` for the device; slots of `pending`/`in_progress` commands (any type) for the device.
- `next_free_slot(db, device_id) -> int | None` — `min(set(range(1, settings.fp_slot_capacity + 1)) - reserved_slots(...))`, or `None` when full.
- `queue_enrol(db, *, student, device, admin) -> DeviceCommand` — validations in §6.4; creates `type=enrol, slot_number=next_free_slot, expires_at=now+command_ttl_minutes`; audit `fingerprint.enrol_requested`.
- `queue_wipe(db, *, device_id, slot_number, student_id, requested_by) -> DeviceCommand` — `type=delete_slot, expires_at=None`.
- `delete_student_biometrics(db, *, student, device_id: int | None, admin) -> list[DeviceCommand]` — for each `FingerprintSlot` of the student (one device or all): delete the mapping row **immediately** (the server stops linking that template to the student right away), then `queue_wipe(...)`. Also cancel the student's `pending`/`in_progress` **enrol** commands on those devices (`status=cancelled`, `result_detail="biometrics_deleted"`). Audit `fingerprint.deleted` with details `{"device_id", "slots": [...]}`.

---

## 6. B4 — Terminal protocol changes (`app/routers/device.py`, `app/schemas`)

### 6.1 Schemas package refactor

Turn `app/schemas.py` into a package without changing existing content:

- Move the current file **unchanged** to `app/schemas/device.py`.
- Create `app/schemas/__init__.py` that re-exports the device schemas (`from app.schemas.device import *` plus `__all__`), so `from app.schemas import AttendanceIn` keeps working.
- New modules: `app/schemas/auth.py`, `app/schemas/admin.py`, `app/schemas/lecturer.py`, `app/schemas/common.py` (`Page[T]` = `{items: list[T], total: int}` generic).

### 6.2 Remove

- `POST /device/enrolments`, `EnrolmentIn`, `EnrolmentOut`, the enrol helpers in tests and the `enrol` command in `fake_terminal.py`.

### 6.3 Change

- `GET /device/session` — `course_code` now comes from `session.course.code`. Response shape unchanged.
- `POST /device/attendance` — `AttendanceOut.status` Literal gains `"not_in_course"`. New check order:
  1. idempotency key seen → return original result (unchanged)
  2. session exists + belongs to device; closed-session rule (unchanged)
  3. slot → student (unchanged; `unknown_slot` 404)
  4. **NEW:** student `is_active` and present in `course_students` for `session.course_id`, else return `not_in_course` (200, nothing saved)
  5. confidence threshold → `low_confidence` (unchanged)
  6. any existing row for (student, session), **revoked or not** → `duplicate` (a revoked record is not re-activated by a scan; only the lecturer can reinstate)
  7. insert (unchanged)

### 6.4 Add — command protocol (HMAC-authenticated like all `/device` routes)

**`GET /device/commands/next`** — terminal polls this every ~3 s when idle.

Logic:
1. `expire_stale(db, device.id, now)`.
2. Pick the device's oldest `in_progress` command (resume after reboot); if none, oldest `pending` (`ORDER BY created_at, id`).
3. None → return **204 No Content** (empty body).
4. If `pending`: set `in_progress`, `claimed_at=now`; for `enrol` also renew `expires_at=now+ttl`.
5. For `enrol`: if the student is missing, inactive or `biometric_consent` is false → `cancelled`, `result_detail="consent_withdrawn"`, `completed_at=now`, commit, and go back to step 2 (loop at most 10 times).
6. Commit and return 200 `DeviceCommandOut`:
   `{command_id, type: "enrol"|"delete_slot", slot_number, student_number: str|None, full_name: str|None, expires_at: AwareDatetime|None}`

**`POST /device/commands/{command_id}/result`** — body `CommandResultIn {success: bool, detail: str|None (≤255)}`

Logic:
1. Command must exist and belong to this device, else 404 `unknown_command`.
2. Already `done`/`failed` → return 200 `{command_id, status}` unchanged (idempotent retry).
3. Not `in_progress` (pending/cancelled/expired) → 409 `command_not_active`.
4. `success=false` → `failed`, `result_detail=detail`, `completed_at`; audit `device.command_failed`; return.
5. `enrol` + success:
   - Re-check the student is active and consented. If not → `cancelled` (`consent_withdrawn`) and `queue_wipe` the same slot (the sensor now holds an unwanted template). Return `{status: "cancelled"}`.
   - Delete any stale `fingerprint_slots` row for (device, slot), then insert `FingerprintSlot(device, slot, student)`.
   - `IntegrityError` (student already has another slot on this device) → rollback, mark `failed` (`student_already_enrolled`), `queue_wipe` the slot, commit, return.
   - Else `done`, `completed_at`; audit `fingerprint.enrolled` (actor = `requested_by_user_id`).
6. `delete_slot` + success → `done`; audit `fingerprint.slot_wiped`.
7. Response: 200 `CommandResultOut {command_id, status}`.

### 6.5 Housekeeping — nonce cleanup (edit `app/security.py`, add lines only)

Polling every 3 s fills `device_nonces` (~1,200 rows/hour). In `verify_device`, **after** the successful nonce commit, add:

```python
    db.execute(delete(DeviceNonce).where(DeviceNonce.device_id == device.id, DeviceNonce.received_at < datetime.now(timezone.utc) - timedelta(seconds=2 * settings.hmac_max_skew_seconds)))  # old nonces can't be replayed anyway (timestamp check)
    db.commit()  # keep the table small
```

(Add `delete` and `timedelta` to the imports.) This is safe because any request old enough to reuse a purged nonce already fails the timestamp check.

### 6.6 Terminal state machine (for the ESP32 milestone — no code here)

Idle loop: `GET /device/session` on boot and every 30 s; `GET /device/commands/next` every 3 s. A 200 `enrol` command interrupts attendance mode: LCD "Enrol: <full_name>", run the Adafruit enrol routine into `slot_number`, POST result. `delete_slot`: `deleteModel(slot_number)`, POST result. Then back to attendance.

---

## 7. B5 — Admin API (`/admin/*`, all require `AdminUser`)

Pagination for list endpoints: query `limit` (1–200, default 50), `offset` (≥0, default 0). Response `Page[T]`.

### 7.1 Users — `app/routers/admin_users.py`

| Pri | Method | Path | Body / query | Success | Errors | Audit |
|---|---|---|---|---|---|---|
| P1 | GET | `/admin/users` | `role?`, `search?` (email/name ilike), limit, offset | `Page[UserOut]` | | |
| P1 | POST | `/admin/users` | `UserCreate {email: EmailStr, full_name (1–120), role: admin\|lecturer, password (≥8)}` | 201 `UserOut` | 409 `email_taken` | `user.created` |
| P2 | PATCH | `/admin/users/{id}` | `UserUpdate {full_name?, role?, is_active?}` | `UserOut` | 404 `user_not_found`; 400 `cannot_modify_self` (own role/active); 400 `last_admin` (would leave zero active admins) | `user.updated` (before/after) |
| P2 | POST | `/admin/users/{id}/reset-password` | `{new_password (≥8)}` | 204 | 404 | `user.password_reset` |

`UserOut = {id, email, full_name, role, is_active, created_at}`. Emails stored lower-case. Demoting a lecturer to admin is fine; removing the lecturer role does **not** delete `course_lecturers` rows (they become inert).

### 7.2 Students — `app/routers/admin_students.py`

| Pri | Method | Path | Body / query | Success | Errors | Audit |
|---|---|---|---|---|---|---|
| P1 | GET | `/admin/students` | `search?` (number/name), `course_id?`, `active?`, limit, offset | `Page[StudentOut]` | | |
| P1 | POST | `/admin/students` | `StudentCreate {student_number: ^[0-9]{6,12}$, full_name (1–120)}` | 201 `StudentOut` | 409 `student_number_taken` | `student.created` |
| P1 | GET | `/admin/students/{id}` | | `StudentDetail` | 404 `student_not_found` | |
| P2 | PATCH | `/admin/students/{id}` | `{full_name?, is_active?}` | `StudentOut` | 404 | `student.updated`; deactivating also runs `delete_student_biometrics` (all devices) |
| P1 | PUT | `/admin/students/{id}/consent` | `ConsentUpdate {consent: bool}` | `StudentOut` | 404 | `consent.granted` / `consent.withdrawn` |
| P1 | POST | `/admin/students/{id}/enrol` | `{device_id}` | 201 `CommandOut` | see below | `fingerprint.enrol_requested` |
| P1 | DELETE | `/admin/students/{id}/fingerprints` | query `device_id?` (omit = all devices) | 200 `list[CommandOut]` (the queued wipes) | 404 | `fingerprint.deleted` |

- New students start with `biometric_consent=false`.
- Consent `true` sets `consent_at=now`. Consent `false` (withdrawal) sets `consent_at=None` **and** runs `delete_student_biometrics` for all devices (POPIA).
- `StudentOut = {id, student_number, full_name, is_active, biometric_consent, consent_at, enrolled_device_ids: list[int]}`
- `StudentDetail = StudentOut + {courses: [{id, code, name}], fingerprint_slots: [{device_id, device_name, slot_number}], open_commands: list[CommandOut]}`
- Enrol validations (in `queue_enrol`), in order:
  - 404 `student_not_found` / 404 `device_not_found`
  - 400 `student_inactive` / 400 `device_inactive`
  - 403 `no_consent`
  - 409 `already_enrolled` (slot exists for this student on this device)
  - 409 `enrolment_pending` (pending/in_progress enrol for this student on this device)
  - 409 `sensor_full` (no free slot)
- `CommandOut = {id, device_id, type, status, slot_number, student_id, student_number, created_at, expires_at, completed_at, result_detail}`

### 7.3 Courses and rosters — `app/routers/admin_courses.py`

| Pri | Method | Path | Body / query | Success | Errors | Audit |
|---|---|---|---|---|---|---|
| P1 | GET | `/admin/courses` | `active?` | `list[CourseOut]` | | |
| P1 | POST | `/admin/courses` | `{code (1–20, stored upper-case), name (1–120)}` | 201 `CourseOut` | 409 `course_code_taken` | `course.created` |
| P1 | GET | `/admin/courses/{id}` | | `CourseDetail` | 404 `course_not_found` | |
| P2 | PATCH | `/admin/courses/{id}` | `{name?, is_active?}` | `CourseOut` | 404 | `course.updated` |
| P1 | PUT | `/admin/courses/{id}/lecturers` | `{user_ids: list[int]}` (replaces the set) | `CourseDetail` | 404; 400 `not_a_lecturer` (any ID not an active lecturer) | `course.lecturers_set` (before/after IDs) |
| P1 | POST | `/admin/courses/{id}/students` | `{student_numbers: list[str]}` (1–500) | `RosterChange {added: [..], already_present: [..], unknown: [..]}` | 404 | `course.students_added` |
| P1 | DELETE | `/admin/courses/{id}/students/{student_id}` | | 204 | 404 `not_on_roster` | `course.student_removed` |
| P2 | POST | `/admin/courses/{id}/students/import` | multipart CSV file, header `student_number,full_name` | `RosterChange` + `created: [..]` | 400 `bad_csv` (with row number in a `row` field) | `course.students_imported` |

- `CourseOut = {id, code, name, is_active, lecturer_count, student_count}`
- `CourseDetail = CourseOut + {lecturers: [UserOut], students: [StudentOut]}`
- CSV import: creates missing students (consent false), adds all to the roster, skips duplicates. Validate every row first; if any row is invalid, import nothing (all-or-nothing).

### 7.4 Devices and commands — `app/routers/admin_devices.py`

| Pri | Method | Path | Body | Success | Errors | Audit |
|---|---|---|---|---|---|---|
| P1 | GET | `/admin/devices` | | `list[DeviceOut]` | | |
| P1 | POST | `/admin/devices` | `{name (1–50)}` | 201 `DeviceCreated` (includes `hmac_secret` **once**) | 409 `device_name_taken` | `device.created` (never log the secret) |
| P1 | PATCH | `/admin/devices/{id}` | `{is_active?}` | `DeviceOut` | 404 `device_not_found` | `device.updated` |
| P2 | POST | `/admin/devices/{id}/rotate-secret` | | `DeviceCreated` | 404 | `device.secret_rotated` |
| P1 | GET | `/admin/devices/{id}/commands` | query `status?`, limit, offset | `Page[CommandOut]` | 404 | |
| P2 | POST | `/admin/commands/{id}/cancel` | | `CommandOut` | 404 `unknown_command`; 409 `command_not_active` | `device.command_cancelled` |

- `DeviceOut = {id, name, is_active, last_seen_at, online: bool, open_session_id: int|None, enrolled_count, pending_commands}`
- `online = last_seen_at is not None and now - last_seen_at <= device_online_seconds`.
- Secret = `secrets.token_hex(32)`. Cancelling a `delete_slot` command is **refused** (409 `wipe_cannot_be_cancelled`): POPIA deletion must eventually complete.

### 7.5 Audit — `app/routers/admin_audit.py`

| Pri | Method | Path | Query | Success |
|---|---|---|---|---|
| P1 | GET | `/admin/audit` | `action?` (prefix match, e.g. `attendance.`), `entity?`, `actor_user_id?`, `since?`, `until?`, limit, offset | `Page[AuditOut]` newest first |

`AuditOut = {id, created_at, actor_user_id, actor_name, action, entity, entity_id, details}`. **No update or delete endpoint for audit rows exists anywhere** (append-only, per the design).

---

## 8. B6 — Lecturer API (`/lecturer/*`, `StaffUser`; access per D5 via `services/access.py`)

| Pri | Method | Path | Body / query | Success | Errors | Audit |
|---|---|---|---|---|---|---|
| P1 | GET | `/lecturer/courses` | | `list[CourseOut]` (assigned only; admin = all active) | | |
| P1 | GET | `/lecturer/devices` | | `list[DeviceSummary {id, name, online, busy}]` (active devices; `busy` = has an open session) | | |
| P1 | POST | `/lecturer/sessions` | `SessionCreate {course_id, device_id, venue (1–50)}` | 201 `SessionOut` | 404 `course_not_found`; 400 `course_inactive`; 404 `device_not_found`; 400 `device_inactive`; 409 `device_busy` | `session.opened` |
| P1 | GET | `/lecturer/sessions` | `course_id?`, `open_only?` (bool), limit, offset | `Page[SessionOut]` newest first | | |
| P1 | GET | `/lecturer/sessions/{id}` | | `SessionOut` | 404 `session_not_found` | |
| P1 | POST | `/lecturer/sessions/{id}/close` | | `SessionOut` | 404; 409 `session_already_closed` | `session.closed` |
| P1 | GET | `/lecturer/sessions/{id}/attendance` | | `RosterView` | 404 | |
| P1 | POST | `/lecturer/sessions/{id}/manual` | `ManualMark {student_number, reason (3–255)}` | 201 `RosterEntry` | 404; 404 `unknown_student`; 400 `not_in_course`; 409 `already_present` | `attendance.manual` or `attendance.reinstated` |
| P1 | POST | `/lecturer/attendance/{attendance_id}/revoke` | `{reason (3–255)}` | `RosterEntry` | 404 `attendance_not_found` (also when the course isn't accessible); 409 `already_revoked` | `attendance.revoked` (before/after) |
| P1 | GET | `/lecturer/sessions/{id}/export.csv` | | `text/csv` download | 404 | `attendance.exported` |
| P2 | GET | `/lecturer/courses/{id}/report` | | `CourseReport` | 404 | |

### 8.1 Shapes

- `SessionOut = {id, course_id, course_code, course_name, venue, device_id, device_name, lecturer_id, lecturer_name, opened_at, closed_at, is_open, counts: {roster, present, absent}}`
- `RosterView = {session: SessionOut, entries: list[RosterEntry]}`, sorted by `full_name`, one entry **per roster student**.
- `RosterEntry = {student_id, student_number, full_name, status: "present"|"absent"|"revoked", attendance_id|None, method|None, recorded_at|None, device_time|None, fp_confidence|None, note|None, revoked_at|None, revoke_reason|None, recorded_by_name|None}`
- `CourseReport = {course: CourseOut, closed_sessions: int, students: [{student_id, student_number, full_name, attended, percentage}]}` — counts only closed sessions and non-revoked rows; `percentage` rounded to 1 decimal (0 when there are no sessions).

### 8.2 Business rules

- Opening a session: `lecturer_id = current user` (also when an admin opens it). One open session per device (`device_busy`). A lecturer may have several open sessions on different devices.
- The terminal picks up the new session on its next `GET /device/session` (≤ 30 s).
- **Manual mark** is allowed on open **and** closed sessions (late corrections). Rules:
  - The student must be on the course roster (`not_in_course`).
  - Active row exists → 409 `already_present`.
  - Revoked row exists → reinstate: clear the `revoked_*` fields, set `recorded_by_user_id=current`, `note=reason`; audit `attendance.reinstated`.
  - Otherwise insert `method=manual`, `device_id=None`, `idempotency_key=None`, `recorded_by_user_id=current`, `note=reason`.
  - Manual marking does **not** require biometric consent. This is the POPIA non-biometric fallback.
- **Revoke** sets `revoked_at=now`, `revoked_by_user_id`, `revoke_reason`. It never deletes the row.
- **Live view**: the dashboard polls `/attendance` every 3–5 s. No websockets in this milestone.
- **CSV export**:
  - Filename: `attendance_<COURSECODE>_<YYYY-MM-DD>_session<ID>.csv`, sent with `Content-Disposition: attachment`.
  - Columns: `student_number,full_name,status,method,recorded_at,device_time,note,revoked_reason`.
  - Times are converted to `settings.display_timezone` and written in ISO 8601 with offset.
  - Write a UTF-8 BOM so Excel opens it cleanly.

---

## 9. B9 — Tests

Keep `tests/conftest.py`'s safety check exactly as is. Add fixtures:

- `admin_user`, `lecturer_user`, `other_lecturer` (known passwords, created through `hash_password`).
- `login(client, email, password) -> headers` helper returning `{"Authorization": "Bearer ..."}`.
- `admin_headers`, `lecturer_headers`, `other_lecturer_headers`.
- Extend `world`: course `PD2316D` with `lecturer_user` assigned; student 111 (consent) and 222 (no consent) both on the roster; student 333 (consent) **not** on the roster; the session uses `course_id`.
- `enrolled(world)` fixture: inserts the `FingerprintSlot` (device, slot 1, student 111) directly in the DB (replaces the removed `/device/enrolments` helper).

Argon2 is slow in tests. Optionally monkeypatch `app.auth.password_hasher` with a fast `PasswordHash((Argon2Hasher(time_cost=1, memory_cost=1024),))` in conftest.

### 9.1 `tests/test_device.py` (update existing)

Keep the 4 security tests and `test_health` unchanged. Rewrite the enrol-dependent tests to use the `enrolled` fixture. Add:

- `test_student_not_on_roster_is_rejected` (slot mapped to 333 → `not_in_course`, 0 rows)
- `test_revoked_record_is_not_reactivated_by_scan`

### 9.2 `tests/test_device_commands.py` (new)

1. No commands → 204.
2. Admin queues enrol → terminal `next` returns it with `slot_number=1` and the student name; status becomes `in_progress`.
3. Calling `next` again returns the **same** in-progress command (resume).
4. Result success → `fingerprint_slots` row exists, command `done`, audit `fingerprint.enrolled`.
5. Result retried → 200, still one slot row (idempotent).
6. Result on a cancelled/expired command → 409 `command_not_active`.
7. Consent withdrawn while pending → `next` skips it (cancelled `consent_withdrawn`) and returns 204.
8. Consent withdrawn after enrolment → mapping removed, `delete_slot` queued; terminal `next` returns the wipe; result → `done`.
9. Expired enrol (`expires_at` in the past) → `next` marks it `expired`, returns 204.
10. Command belonging to another device → 404 `unknown_command`.
11. Second enrol for the same student/device while pending → 409 `enrolment_pending`; after done → 409 `already_enrolled`.
12. Slot allocation: two different students queued → slots 1 and 2; with `fp_slot_capacity=2`, a third gets 409 `sensor_full`.

### 9.3 `tests/test_auth.py` (new)

1. Login OK returns a token and the user; `/auth/me` works with it.
2. Wrong password → 401 `invalid_credentials`; unknown email → same 401.
3. Inactive user → 401 on login; an existing token for a user deactivated afterwards → 401 `inactive_user`.
4. Expired token (create one with a past `exp`) → 401 `token_expired`; garbage token → 401 `invalid_token`.
5. No token on an admin route → 401; lecturer token on an admin route → 403 `forbidden`.
6. Email login is case-insensitive.

### 9.4 `tests/test_admin.py` (new)

1. Create a lecturer; duplicate email → 409 `email_taken`; the response has no `password_hash`.
2. Create a student; bad number format → 422; duplicate → 409.
3. Consent grant sets `consent_at`; withdrawal removes slots and queues wipes (asserts DB + audit).
4. Enrol without consent → 403 `no_consent`.
5. Courses: create (code upper-cased), assign lecturers (a non-lecturer ID → 400 `not_a_lecturer`), add students (reports `added`/`already_present`/`unknown`), remove a student.
6. Device create returns the secret once; GET list never includes `hmac_secret`; `online` flag true right after a signed device call.
7. Audit list returns newest first, filters by action prefix. No `PUT`/`PATCH`/`DELETE` routes exist under `/admin/audit` (assert 405).
8. P2 if implemented: `last_admin` and `cannot_modify_self` guards; CSV import is all-or-nothing on a bad row.

### 9.5 `tests/test_lecturer.py` (new)

1. A lecturer lists only assigned courses; the admin sees all.
2. Open a session → 201; a second open on the same device → 409 `device_busy`; the terminal `GET /device/session` returns the new session.
3. Another lecturer opening on a course they don't teach → 404 `course_not_found`; reading the first lecturer's session → 404.
4. Roster view: after one fingerprint scan, `present=1`, `absent=roster-1`, entries sorted by name.
5. Manual mark for 222 (no consent) works (`method=manual`, `note` saved, audit written); again → 409 `already_present`; for 333 (not on roster) → 400 `not_in_course`.
6. Revoke → status `revoked` and the row still exists; revoke again → 409; manual mark after revoke → reinstated (same row ID), audit `attendance.reinstated`.
7. Close the session → closed; close again → 409; a terminal scan with `device_time` after `closed_at` → 409 `session_closed`.
8. CSV export: status 200, `text/csv`, BOM present, header row correct, one line per roster student, audit `attendance.exported`.

Target: all Milestone A tests + ~40 new tests green.

---

## 10. B7/B8 — Wiring, seed, manual walkthrough

### 10.1 `app/main.py` (add lines only, keep the existing `import_module` style)

- `from fastapi.middleware.cors import CORSMiddleware` and `app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"], allow_headers=["Authorization", "Content-Type"], allow_credentials=False, expose_headers=["Content-Disposition"])`. `expose_headers` lets the dashboard read the CSV filename.
- Include routers: `auth`, `admin_users`, `admin_students`, `admin_courses`, `admin_devices`, `admin_audit`, `lecturer` (`device` already included).
- Router tags: `auth`, `admin`, `lecturer`, `device`.

### 10.2 `scripts/seed.py` (edit)

Get-or-create, safe to rerun:

- Admin `admin@tut.ac.za` and lecturer `lecturer@tut.ac.za`, both with password `ChangeMe123` (dev only).
- Device `terminal-01`.
- Course `PD2316D` "Project Design III" with the lecturer assigned.
- Students `220000001`, `220000002` (consent true) and `220000003` (consent false, to demo the manual fallback), all on the roster.
- An open session for the course on `terminal-01` if none is open.
- Print the admin/lecturer logins, `DEVICE_ID`, `DEVICE_SECRET` and `SESSION_ID`.

The old `lecturer@demo.local` row may remain; it's harmless. Don't use `.local` emails, because `EmailStr` rejects special-use domains.

### 10.3 `scripts/fake_terminal.py` (edit)

- Remove `enrol`.
- Add `next` → `GET /device/commands/next` (prints "no commands" on 204).
- Add `result <command_id> ok|fail [detail]` → `POST /device/commands/{id}/result`.

### 10.4 Manual walkthrough (acceptance demo, Swagger + fake terminal)

1. `python -m alembic upgrade head`, then `python -m scripts.seed`, then `fastapi dev app/main.py`.
2. In Swagger, Authorize as the admin, then call `POST /admin/students/{id}/enrol` for 220000001 on device 1. You get slot 1.
3. Run `fake_terminal next`. It shows the enrol command for Test Student One, slot 1. Then run `fake_terminal result <id> ok`.
4. Authorize as the lecturer and close the seed session. Then `POST /lecturer/sessions` to open a new one on terminal-01.
5. Run `fake_terminal session` (shows the new session), then `fake_terminal mark <session> 1 120`. It returns `recorded`.
6. `GET /lecturer/sessions/{id}/attendance` shows 1 present and 2 absent.
7. Manual mark 220000003 with reason "No biometric consent, ID card checked". It shows as present (manual).
8. Revoke one record, then export the CSV and open it in Excel.
9. As admin, withdraw consent for 220000001. Run `fake_terminal next` and it returns `delete_slot` for slot 1. Report ok.
10. `GET /admin/audit` shows every step above.

---

## 11. Reference

### 11.1 Error codes (`detail` values)

`invalid_credentials, token_expired, invalid_token, inactive_user, forbidden, wrong_current_password, email_taken, user_not_found, cannot_modify_self, last_admin, student_number_taken, student_not_found, student_inactive, no_consent, already_enrolled, enrolment_pending, sensor_full, course_code_taken, course_not_found, course_inactive, not_a_lecturer, not_on_roster, bad_csv, device_name_taken, device_not_found, device_inactive, device_busy, unknown_command, command_not_active, wipe_cannot_be_cancelled, session_not_found, session_already_closed, unknown_student, not_in_course, already_present, attendance_not_found, already_revoked` + Milestone A codes (`unknown_device, stale_timestamp, bad_signature, replayed_nonce, no_open_session, unknown_session, session_closed, unknown_slot`).

### 11.2 Audit actions

`user.created, user.updated, user.password_reset, auth.password_changed, student.created, student.updated, consent.granted, consent.withdrawn, course.created, course.updated, course.lecturers_set, course.students_added, course.student_removed, course.students_imported, device.created, device.updated, device.secret_rotated, device.command_cancelled, device.command_failed, fingerprint.enrol_requested, fingerprint.enrolled, fingerprint.deleted, fingerprint.slot_wiped, session.opened, session.closed, attendance.manual, attendance.reinstated, attendance.revoked, attendance.exported`

### 11.3 Final file layout (Backend)

```
app/
  auth.py                    NEW
  config.py                  +settings
  db.py
  main.py                    +CORS, +routers
  models.py                  +4 tables, +columns
  security.py                +nonce cleanup
  schemas/__init__.py        NEW (re-exports device)
  schemas/common.py          NEW
  schemas/device.py          MOVED (from schemas.py) + command schemas, - enrolment schemas
  schemas/auth.py            NEW
  schemas/admin.py           NEW
  schemas/lecturer.py        NEW
  services/__init__.py       NEW
  services/audit.py          NEW
  services/access.py         NEW
  services/commands.py       NEW
  routers/device.py          +commands, roster check, -enrolments
  routers/auth.py            NEW
  routers/admin_users.py     NEW
  routers/admin_students.py  NEW
  routers/admin_courses.py   NEW
  routers/admin_devices.py   NEW
  routers/admin_audit.py     NEW
  routers/lecturer.py        NEW
migrations/versions/xxxx_milestone_b_....py   NEW (hand-edited)
scripts/create_admin.py      NEW
scripts/seed.py              updated
scripts/fake_terminal.py     updated
tests/conftest.py            +fixtures
tests/test_device.py         updated
tests/test_device_commands.py NEW
tests/test_auth.py           NEW
tests/test_admin.py          NEW
tests/test_lecturer.py       NEW
```

### 11.4 Definition of done

- [ ] `alembic upgrade head` / `downgrade -1` / `upgrade head` all work on the dev DB.
- [ ] `python -m pytest -q` is all green (Milestone A + B).
- [ ] The §10.4 walkthrough works end to end.
- [ ] `/docs` shows the four tags; Authorize works with an admin and a lecturer.
- [ ] No response anywhere leaks `password_hash`; `hmac_secret` appears only on device create/rotate.
- [ ] Every new code line is commented; existing files were edited minimally.
- [ ] `requirements.txt` updated; `.env.example` lists every key.

---

## 12. B10 — Design document updates (for the owner)

1. Attendance API constraints: change "role-based access for student, lecturer, and administrator functions" to "lecturer and administrator functions; students interact only through the terminal and never log in".
2. F1 Student Enrolment: the admin initiates enrolment from the dashboard. The server assigns a sensor slot and queues an `enrol` command. The terminal polls, captures the finger and confirms. Biometric deletion uses the same queue (`delete_slot`). This replaces any terminal-side identity entry, since the terminal has no keypad.
3. Data model: add courses, course_lecturers, course_students and device_commands, plus attendance revocation fields. This enables absentee reporting and enforces the "enrolment capped to one class" constraint.
4. F5 corrections: describe revoke/reinstate (soft delete, nothing erased) with the mandatory reason and the audit entry.
5. RTM: add rows for auth/roles (test_auth), roster enforcement (test_student_not_on_roster_is_rejected), POPIA withdrawal and wipe (test_device_commands #8) and audit immutability (test_admin #7).
