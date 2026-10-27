from collections import defaultdict  # grouping helpers
from datetime import datetime, timezone  # online check

from sqlalchemy import func, select  # query builders
from sqlalchemy.orm import Session  # DB session type

from app.config import settings  # device_online_seconds
from app.models import Attendance, Course, CourseLecturer, CourseStudent, Device, DeviceCommand, FingerprintSlot, LectureSession, Student, User  # tables read here
from app.schemas.admin import CommandOut, CourseOut, DeviceOut, StudentOut  # admin shapes
from app.schemas.lecturer import SessionCounts, SessionOut  # lecturer shapes
from app.services.commands import OPEN_STATUSES  # pending + in_progress


def is_online(device: Device) -> bool:  # seen within the threshold?
    if device.last_seen_at is None:  # never called in
        return False  # offline
    return (datetime.now(timezone.utc) - device.last_seen_at).total_seconds() <= settings.device_online_seconds  # recent enough


def student_outs(db: Session, students: list[Student]) -> list[StudentOut]:  # students with their enrolled devices (one query)
    ids = [s.id for s in students]  # IDs to look up
    devices: dict[int, list[int]] = defaultdict(list)  # student_id -> device IDs
    if ids:  # skip the query for an empty list
        for student_id, device_id in db.execute(select(FingerprintSlot.student_id, FingerprintSlot.device_id).where(FingerprintSlot.student_id.in_(ids)).order_by(FingerprintSlot.device_id)):  # all slots for these students
            devices[student_id].append(device_id)  # group by student
    return [StudentOut(id=s.id, student_number=s.student_number, full_name=s.full_name, is_active=s.is_active, biometric_consent=s.biometric_consent, consent_at=s.consent_at, enrolled_device_ids=devices[s.id]) for s in students]  # build responses


def student_out(db: Session, student: Student) -> StudentOut:  # single-student convenience
    return student_outs(db, [student])[0]  # reuse the batch version


def command_outs(db: Session, commands: list[DeviceCommand]) -> list[CommandOut]:  # commands with student numbers (one query)
    ids = {c.student_id for c in commands if c.student_id is not None}  # students referenced
    numbers = dict(db.execute(select(Student.id, Student.student_number).where(Student.id.in_(ids))).tuples().all()) if ids else {}  # id -> number
    return [CommandOut(id=c.id, device_id=c.device_id, type=c.type, status=c.status, slot_number=c.slot_number, student_id=c.student_id, student_number=numbers.get(c.student_id), created_at=c.created_at, expires_at=c.expires_at, completed_at=c.completed_at, result_detail=c.result_detail) for c in commands]  # build responses


def course_outs(db: Session, courses: list[Course]) -> list[CourseOut]:  # courses with lecturer/student counts
    ids = [c.id for c in courses]  # IDs to count for
    lecturers: dict[int, int] = {}  # course_id -> lecturer count
    students: dict[int, int] = {}  # course_id -> roster size
    if ids:  # skip queries for an empty list
        lecturers = dict(db.execute(select(CourseLecturer.course_id, func.count()).where(CourseLecturer.course_id.in_(ids)).group_by(CourseLecturer.course_id)).tuples().all())  # count lecturers
        students = dict(db.execute(select(CourseStudent.course_id, func.count()).where(CourseStudent.course_id.in_(ids)).group_by(CourseStudent.course_id)).tuples().all())  # count students
    return [CourseOut(id=c.id, code=c.code, name=c.name, is_active=c.is_active, lecturer_count=lecturers.get(c.id, 0), student_count=students.get(c.id, 0)) for c in courses]  # build responses


def device_outs(db: Session, devices: list[Device]) -> list[DeviceOut]:  # devices with live status
    ids = [d.id for d in devices]  # IDs to look up
    open_sessions: dict[int, int] = {}  # device_id -> open session ID
    enrolled: dict[int, int] = {}  # device_id -> slots in use
    pending: dict[int, int] = {}  # device_id -> open commands
    if ids:  # skip queries for an empty list
        for session_id, device_id in db.execute(select(LectureSession.id, LectureSession.device_id).where(LectureSession.device_id.in_(ids), LectureSession.closed_at.is_(None)).order_by(LectureSession.opened_at)):  # open sessions
            open_sessions[device_id] = session_id  # newest wins
        enrolled = dict(db.execute(select(FingerprintSlot.device_id, func.count()).where(FingerprintSlot.device_id.in_(ids)).group_by(FingerprintSlot.device_id)).tuples().all())  # slot counts
        pending = dict(db.execute(select(DeviceCommand.device_id, func.count()).where(DeviceCommand.device_id.in_(ids), DeviceCommand.status.in_(OPEN_STATUSES)).group_by(DeviceCommand.device_id)).tuples().all())  # open command counts
    return [DeviceOut(id=d.id, name=d.name, is_active=d.is_active, last_seen_at=d.last_seen_at, online=is_online(d), open_session_id=open_sessions.get(d.id), enrolled_count=enrolled.get(d.id, 0), pending_commands=pending.get(d.id, 0)) for d in devices]  # build responses (no secret)


def session_outs(db: Session, sessions: list[LectureSession]) -> list[SessionOut]:  # sessions with names and counts
    if not sessions:  # nothing to build
        return []  # empty
    course_ids = {s.course_id for s in sessions}  # courses involved
    session_ids = [s.id for s in sessions]  # sessions involved
    courses = {c.id: c for c in db.scalars(select(Course).where(Course.id.in_(course_ids)))}  # id -> course
    devices = dict(db.execute(select(Device.id, Device.name).where(Device.id.in_({s.device_id for s in sessions}))).tuples().all())  # id -> device name
    lecturers = dict(db.execute(select(User.id, User.full_name).where(User.id.in_({s.lecturer_id for s in sessions}))).tuples().all())  # id -> lecturer name
    roster = dict(db.execute(select(CourseStudent.course_id, func.count()).where(CourseStudent.course_id.in_(course_ids)).group_by(CourseStudent.course_id)).tuples().all())  # course -> roster size
    present = dict(db.execute(  # session -> roster students with a valid record
        select(Attendance.session_id, func.count())  # count rows
        .join(LectureSession, LectureSession.id == Attendance.session_id)  # need the course
        .join(CourseStudent, (CourseStudent.course_id == LectureSession.course_id) & (CourseStudent.student_id == Attendance.student_id))  # only roster students
        .where(Attendance.session_id.in_(session_ids), Attendance.revoked_at.is_(None))  # non-revoked only
        .group_by(Attendance.session_id)  # per session
    ).tuples().all())
    result = []  # responses
    for s in sessions:  # each session
        size = roster.get(s.course_id, 0)  # roster size
        here = present.get(s.id, 0)  # present count
        course = courses[s.course_id]  # its course
        result.append(SessionOut(id=s.id, course_id=s.course_id, course_code=course.code, course_name=course.name, venue=s.venue, device_id=s.device_id, device_name=devices.get(s.device_id, ""), lecturer_id=s.lecturer_id, lecturer_name=lecturers.get(s.lecturer_id, ""), opened_at=s.opened_at, closed_at=s.closed_at, is_open=s.closed_at is None, counts=SessionCounts(roster=size, present=here, absent=size - here)))  # one response
    return result  # all built


def session_out(db: Session, session: LectureSession) -> SessionOut:  # single-session convenience
    return session_outs(db, [session])[0]  # reuse the batch version
