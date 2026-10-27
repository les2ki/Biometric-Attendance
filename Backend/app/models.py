import enum  # built-in enum support
from datetime import datetime  # type for timestamp columns

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Index, JSON, String, UniqueConstraint, func, true  # column types/constraints
from sqlalchemy.orm import Mapped, mapped_column, relationship  # typed column declarations

from app.db import Base  # shared base with naming convention


class Role(str, enum.Enum):  # dashboard user roles
    lecturer = "lecturer"  # opens sessions, views and corrects records
    admin = "admin"  # enrols students, handles retention/deletion


class Method(str, enum.Enum):  # how attendance was verified
    fingerprint = "fingerprint"  # high-confidence fingerprint match
    face = "face"  # face-recognition path
    manual = "manual"  # lecturer-confirmed non-biometric fallback (POPIA)


class User(Base):  # lecturers and admins who log into the dashboard
    __tablename__ = "users"  # table name in Postgres
    id: Mapped[int] = mapped_column(primary_key=True)  # auto-increment primary key
    email: Mapped[str] = mapped_column(String(255), unique=True)  # login name
    full_name: Mapped[str] = mapped_column(String(120))  # display name
    password_hash: Mapped[str] = mapped_column(String(255))  # argon2 hash, never the plain password
    role: Mapped[Role] = mapped_column(Enum(Role, name="user_role"))  # stored as a Postgres enum type
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)  # disable an account without deleting it
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())  # set by the DB


class Student(Base):  # people whose attendance is recorded
    __tablename__ = "students"  # table name
    id: Mapped[int] = mapped_column(primary_key=True)  # internal ID (pseudonymous link for biometrics)
    student_number: Mapped[str] = mapped_column(String(20), unique=True)  # TUT student number
    full_name: Mapped[str] = mapped_column(String(120))  # display name
    biometric_consent: Mapped[bool] = mapped_column(Boolean, default=False)  # POPIA: no biometrics unless True
    consent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # when consent was given
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())  # inactive students can't be enrolled or marked
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())  # set by the DB


class Device(Base):  # device registry: each attendance terminal
    __tablename__ = "devices"  # table name
    id: Mapped[int] = mapped_column(primary_key=True)  # device ID sent in every request
    name: Mapped[str] = mapped_column(String(50), unique=True)  # e.g. "terminal-01"
    hmac_secret: Mapped[str] = mapped_column(String(128))  # shared signing key; must be raw (not hashed) to verify HMAC
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)  # revoke a lost/stolen terminal
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # updated on each valid request


class FingerprintSlot(Base):  # maps a template slot on the sensor to a student; the template never leaves the sensor
    __tablename__ = "fingerprint_slots"  # table name
    __table_args__ = (  # table-level constraints
        UniqueConstraint("device_id", "slot_number"),  # one student per slot on a sensor
        UniqueConstraint("device_id", "student_id"),  # one slot per student on a sensor
    )
    id: Mapped[int] = mapped_column(primary_key=True)  # primary key
    device_id: Mapped[int] = mapped_column(ForeignKey("devices.id"))  # which terminal's sensor
    slot_number: Mapped[int]  # template slot on the R307 (e.g. 1..60)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"))  # deleting a student removes the mapping


class LectureSession(Base):  # an attendance session (not called "Session" to avoid clashing with SQLAlchemy's Session)
    __tablename__ = "sessions"  # table name
    id: Mapped[int] = mapped_column(primary_key=True)  # session ID the terminal caches
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id"))  # the course this session belongs to
    course: Mapped["Course"] = relationship()  # convenience access: session.course.code
    venue: Mapped[str] = mapped_column(String(50))  # e.g. "Building 10, Room 112"
    lecturer_id: Mapped[int] = mapped_column(ForeignKey("users.id"))  # who opened it
    device_id: Mapped[int] = mapped_column(ForeignKey("devices.id"))  # terminal assigned to this session
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())  # canonical server time
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # NULL means still open


class Attendance(Base):  # one row = one student present in one session
    __tablename__ = "attendance"  # table name
    __table_args__ = (UniqueConstraint("student_id", "session_id"),)  # RTM req 04: no duplicates, enforced by the DB
    id: Mapped[int] = mapped_column(primary_key=True)  # primary key
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id"))  # which session
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"))  # which student
    device_id: Mapped[int | None] = mapped_column(ForeignKey("devices.id"))  # NULL for manual dashboard entries
    method: Mapped[Method] = mapped_column(Enum(Method, name="attendance_method"))  # fingerprint / face / manual
    fp_confidence: Mapped[int | None]  # R307 match score, kept to tune your threshold
    device_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # terminal RTC time (supporting only)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())  # canonical time
    idempotency_key: Mapped[str | None] = mapped_column(String(64), unique=True)  # retried/synced events reuse it
    recorded_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))  # lecturer who entered a manual/reinstated record
    note: Mapped[str | None] = mapped_column(String(255))  # reason given for a manual entry
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # soft delete: set when a lecturer invalidates the record
    revoked_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))  # who revoked it
    revoke_reason: Mapped[str | None] = mapped_column(String(255))  # why it was revoked


class DeviceNonce(Base):  # nonces already used; blocks replayed requests
    __tablename__ = "device_nonces"  # table name
    device_id: Mapped[int] = mapped_column(ForeignKey("devices.id"), primary_key=True)  # part 1 of composite key
    nonce: Mapped[str] = mapped_column(String(64), primary_key=True)  # part 2: unique per device
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())  # for purging old ones


class AuditLog(Base):  # append-only history: enrolments, deletions, overrides, exports
    __tablename__ = "audit_log"  # table name
    id: Mapped[int] = mapped_column(primary_key=True)  # primary key
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))  # NULL when the system acted
    action: Mapped[str] = mapped_column(String(50))  # e.g. "attendance.override"
    entity: Mapped[str] = mapped_column(String(50))  # table affected, e.g. "attendance"
    entity_id: Mapped[str] = mapped_column(String(50))  # ID of the affected row
    details: Mapped[dict] = mapped_column(JSON, default=dict)  # before/after values
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())  # set by the DB


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
