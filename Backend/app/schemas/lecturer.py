from datetime import datetime  # timestamp fields
from typing import Literal  # fixed value sets

from pydantic import BaseModel, Field  # validation

from app.models import Method  # fingerprint / face / manual
from app.schemas.admin import CourseOut  # reused in the course report


class DeviceSummary(BaseModel):  # a terminal in the "open session" picker
    id: int  # device ID
    name: str  # e.g. terminal-01
    online: bool  # seen recently
    busy: bool  # already has an open session


class SessionCreate(BaseModel):  # POST /lecturer/sessions
    course_id: int  # course being taught
    device_id: int  # terminal in the venue
    venue: str = Field(min_length=1, max_length=50)  # e.g. Building 10, Room 112


class SessionCounts(BaseModel):  # headline numbers for a session
    roster: int  # students on the class list
    present: int  # roster students with a non-revoked record
    absent: int  # roster - present


class SessionOut(BaseModel):  # a session as the dashboard sees it
    id: int  # session ID
    course_id: int  # course
    course_code: str  # e.g. PD2316D
    course_name: str  # e.g. Project Design III
    venue: str  # where it happens
    device_id: int  # terminal used
    device_name: str  # e.g. terminal-01
    lecturer_id: int  # who opened it
    lecturer_name: str  # their display name
    opened_at: datetime  # server time it opened
    closed_at: datetime | None  # None while open
    is_open: bool  # convenience flag
    counts: SessionCounts  # roster / present / absent


class RosterEntry(BaseModel):  # one roster student in one session
    student_id: int  # internal ID
    student_number: str  # TUT number
    full_name: str  # display name
    status: Literal["present", "absent", "revoked"]  # attendance state
    attendance_id: int | None  # record ID (None when absent)
    method: Method | None  # how it was recorded
    recorded_at: datetime | None  # server time of the record
    device_time: datetime | None  # terminal clock time
    fp_confidence: int | None  # match score
    note: str | None  # reason for a manual entry
    revoked_at: datetime | None  # when it was revoked
    revoke_reason: str | None  # why
    recorded_by_name: str | None  # lecturer who entered/reinstated it


class RosterView(BaseModel):  # GET /lecturer/sessions/{id}/attendance
    session: SessionOut  # session header
    entries: list[RosterEntry]  # one per roster student, sorted by name


class ManualMark(BaseModel):  # POST /lecturer/sessions/{id}/manual
    student_number: str = Field(min_length=1, max_length=20)  # who to mark present
    reason: str = Field(min_length=3, max_length=255)  # why (mandatory, audited)


class RevokeIn(BaseModel):  # POST /lecturer/attendance/{id}/revoke
    reason: str = Field(min_length=3, max_length=255)  # why (mandatory, audited)


class ReportRow(BaseModel):  # one student in a course report
    student_id: int  # internal ID
    student_number: str  # TUT number
    full_name: str  # display name
    attended: int  # closed sessions attended (non-revoked)
    percentage: float  # attended / closed sessions * 100, 1 decimal


class CourseReport(BaseModel):  # GET /lecturer/courses/{id}/report
    course: CourseOut  # the course
    closed_sessions: int  # sessions counted
    students: list[ReportRow]  # one per roster student
