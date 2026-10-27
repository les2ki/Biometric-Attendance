from datetime import datetime  # timestamp fields
from typing import Any  # free-form audit details

from pydantic import BaseModel, EmailStr, Field  # validation

from app.models import CommandStatus, CommandType, Role  # enums shared with the DB
from app.schemas.auth import UserOut  # reused inside course details


class UserCreate(BaseModel):  # POST /admin/users
    email: EmailStr  # login name (stored lower-case)
    full_name: str = Field(min_length=1, max_length=120)  # display name
    role: Role  # admin / lecturer
    password: str = Field(min_length=8, max_length=128)  # initial password (hashed before saving)


class UserUpdate(BaseModel):  # PATCH /admin/users/{id}; omitted fields stay unchanged
    full_name: str | None = Field(default=None, min_length=1, max_length=120)  # new display name
    role: Role | None = None  # new role
    is_active: bool | None = None  # enable/disable the account


class PasswordResetIn(BaseModel):  # POST /admin/users/{id}/reset-password
    new_password: str = Field(min_length=8, max_length=128)  # the admin-chosen password


class StudentCreate(BaseModel):  # POST /admin/students
    student_number: str = Field(pattern=r"^[0-9]{6,12}$")  # TUT student number, digits only
    full_name: str = Field(min_length=1, max_length=120)  # display name


class StudentUpdate(BaseModel):  # PATCH /admin/students/{id}
    full_name: str | None = Field(default=None, min_length=1, max_length=120)  # new display name
    is_active: bool | None = None  # deactivating also deletes biometrics


class ConsentUpdate(BaseModel):  # PUT /admin/students/{id}/consent
    consent: bool  # True = grant, False = withdraw (POPIA)


class EnrolIn(BaseModel):  # POST /admin/students/{id}/enrol
    device_id: int  # terminal whose sensor will hold the template


class StudentOut(BaseModel):  # a student in lists
    id: int  # internal ID
    student_number: str  # TUT number
    full_name: str  # display name
    is_active: bool  # inactive = can't be enrolled or marked
    biometric_consent: bool  # POPIA consent flag
    consent_at: datetime | None  # when consent was given
    enrolled_device_ids: list[int]  # terminals holding this student's fingerprint


class CourseBrief(BaseModel):  # short course reference inside a student detail
    id: int  # course ID
    code: str  # e.g. PD2316D
    name: str  # e.g. Project Design III


class SlotOut(BaseModel):  # one fingerprint slot mapping
    device_id: int  # terminal
    device_name: str  # e.g. terminal-01
    slot_number: int  # slot on that sensor


class CommandOut(BaseModel):  # a queued terminal command as the dashboard sees it
    id: int  # command ID
    device_id: int  # target terminal
    type: CommandType  # enrol / delete_slot
    status: CommandStatus  # life cycle state
    slot_number: int  # sensor slot
    student_id: int | None  # student being enrolled (None after deletion)
    student_number: str | None  # convenience for the UI
    created_at: datetime  # queued at
    expires_at: datetime | None  # deadline (None = never)
    completed_at: datetime | None  # when it finished
    result_detail: str | None  # error text or cancel reason


class StudentDetail(StudentOut):  # GET /admin/students/{id}
    courses: list[CourseBrief]  # rosters the student is on
    fingerprint_slots: list[SlotOut]  # where the templates are stored
    open_commands: list[CommandOut]  # pending/in-progress commands for this student


class CourseCreate(BaseModel):  # POST /admin/courses
    code: str = Field(min_length=1, max_length=20, pattern=r"\S")  # stored upper-case; must contain a non-space
    name: str = Field(min_length=1, max_length=120)  # display name


class CourseUpdate(BaseModel):  # PATCH /admin/courses/{id}
    name: str | None = Field(default=None, min_length=1, max_length=120)  # new display name
    is_active: bool | None = None  # archive / restore


class LecturersSet(BaseModel):  # PUT /admin/courses/{id}/lecturers
    user_ids: list[int]  # the full new set of lecturers


class StudentsAdd(BaseModel):  # POST /admin/courses/{id}/students
    student_numbers: list[str] = Field(min_length=1, max_length=500)  # students to put on the roster


class RosterChange(BaseModel):  # result of adding students to a roster
    added: list[str]  # newly on the roster
    already_present: list[str]  # were already on it
    unknown: list[str]  # no such student number


class RosterImportOut(RosterChange):  # result of a CSV roster import
    created: list[str]  # student records created by the import


class CourseOut(BaseModel):  # a course in lists
    id: int  # course ID
    code: str  # e.g. PD2316D
    name: str  # display name
    is_active: bool  # archived courses can't get new sessions
    lecturer_count: int  # assigned lecturers
    student_count: int  # roster size


class CourseDetail(CourseOut):  # GET /admin/courses/{id}
    lecturers: list[UserOut]  # assigned lecturers
    students: list[StudentOut]  # roster


class DeviceCreate(BaseModel):  # POST /admin/devices
    name: str = Field(min_length=1, max_length=50)  # e.g. terminal-02


class DeviceUpdate(BaseModel):  # PATCH /admin/devices/{id}
    is_active: bool | None = None  # revoke / restore a terminal


class DeviceOut(BaseModel):  # a terminal as the dashboard sees it (never the secret)
    id: int  # device ID
    name: str  # e.g. terminal-01
    is_active: bool  # revoked terminals are rejected
    last_seen_at: datetime | None  # last valid signed request
    online: bool  # seen within device_online_seconds
    open_session_id: int | None  # session currently running on it
    enrolled_count: int  # fingerprint slots in use
    pending_commands: int  # pending + in-progress commands


class DeviceCreated(DeviceOut):  # create / rotate response: the ONLY place the secret appears
    hmac_secret: str  # copy into the terminal config now; it is never shown again


class AuditOut(BaseModel):  # one audit log row
    id: int  # row ID
    created_at: datetime  # when it happened
    actor_user_id: int | None  # who did it (None = system/terminal)
    actor_name: str | None  # their display name
    action: str  # e.g. attendance.revoked
    entity: str  # table affected
    entity_id: str  # row affected
    details: dict[str, Any]  # before/after values
