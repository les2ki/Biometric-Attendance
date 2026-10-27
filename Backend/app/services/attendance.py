import csv  # CSV writer
import io  # in-memory text buffer
from datetime import datetime, timezone  # timestamps
from zoneinfo import ZoneInfo  # display timezone (needs tzdata on Windows)

from fastapi import HTTPException, status  # errors
from sqlalchemy import func, select  # query builders
from sqlalchemy.exc import IntegrityError  # race on the unique constraint
from sqlalchemy.orm import Session  # DB session type

from app.config import settings  # display_timezone
from app.models import Attendance, Course, CourseStudent, LectureSession, Method, Student, User  # tables used here
from app.schemas.lecturer import CourseReport, ReportRow, RosterEntry  # response shapes
from app.services.access import can_access_course  # D5 visibility rule
from app.services.audit import write_audit  # audit trail
from app.services.views import course_outs  # course header for reports

CSV_COLUMNS = ["student_number", "full_name", "status", "method", "recorded_at", "device_time", "note", "revoked_reason"]  # export header


def _now() -> datetime:  # one place for "now"
    return datetime.now(timezone.utc)  # always timezone-aware UTC


def _snapshot(row: Attendance) -> dict:  # JSON-safe copy of the fields corrections change
    return {  # before/after values for the audit row
        "revoked_at": row.revoked_at.isoformat() if row.revoked_at else None,  # revocation time
        "revoked_by_user_id": row.revoked_by_user_id,  # who revoked
        "revoke_reason": row.revoke_reason,  # why
        "recorded_by_user_id": row.recorded_by_user_id,  # who entered it
        "note": row.note,  # manual reason
    }


def _entry(student: Student, row: Attendance | None, names: dict[int, str]) -> RosterEntry:  # one roster line
    if row is None:  # no record at all
        return RosterEntry(student_id=student.id, student_number=student.student_number, full_name=student.full_name, status="absent", attendance_id=None, method=None, recorded_at=None, device_time=None, fp_confidence=None, note=None, revoked_at=None, revoke_reason=None, recorded_by_name=None)  # absent line
    return RosterEntry(  # present or revoked line
        student_id=student.id,  # internal ID
        student_number=student.student_number,  # TUT number
        full_name=student.full_name,  # display name
        status="revoked" if row.revoked_at is not None else "present",  # revoked rows don't count as present
        attendance_id=row.id,  # record ID (used by revoke)
        method=row.method,  # fingerprint / manual
        recorded_at=row.recorded_at,  # server time
        device_time=row.device_time,  # terminal time
        fp_confidence=row.fp_confidence,  # match score
        note=row.note,  # manual reason
        revoked_at=row.revoked_at,  # revocation time
        revoke_reason=row.revoke_reason,  # why
        recorded_by_name=names.get(row.recorded_by_user_id) if row.recorded_by_user_id else None,  # lecturer name
    )


def roster_entries(db: Session, session: LectureSession) -> list[RosterEntry]:  # one entry per roster student, sorted by name
    students = db.scalars(select(Student).join(CourseStudent, CourseStudent.student_id == Student.id).where(CourseStudent.course_id == session.course_id).order_by(Student.full_name, Student.student_number)).all()  # the class list
    rows = {a.student_id: a for a in db.scalars(select(Attendance).where(Attendance.session_id == session.id))}  # student_id -> record
    user_ids = {a.recorded_by_user_id for a in rows.values() if a.recorded_by_user_id}  # lecturers to name
    names = dict(db.execute(select(User.id, User.full_name).where(User.id.in_(user_ids))).tuples().all()) if user_ids else {}  # id -> name
    return [_entry(s, rows.get(s.id), names) for s in students]  # build lines


def entry_for(db: Session, row: Attendance) -> RosterEntry:  # roster line for one record
    student = db.get(Student, row.student_id)  # whose record
    names = dict(db.execute(select(User.id, User.full_name).where(User.id == row.recorded_by_user_id)).tuples().all()) if row.recorded_by_user_id else {}  # lecturer name
    return _entry(student, row, names)  # build the line


def manual_mark(db: Session, *, session: LectureSession, student_number: str, reason: str, user: User) -> Attendance:  # lecturer marks a student present (POPIA fallback)
    student = db.scalars(select(Student).where(Student.student_number == student_number.strip())).first()  # find the student
    if student is None:  # no such number
        raise HTTPException(status.HTTP_404_NOT_FOUND, "unknown_student")  # stop
    on_roster = db.get(CourseStudent, (session.course_id, student.id)) is not None  # on this course's class list?
    if not on_roster:  # D2: only roster students
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "not_in_course")  # stop
    if not student.is_active:  # deactivated students can't be marked
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "student_inactive")  # stop
    row = db.scalars(select(Attendance).where(Attendance.student_id == student.id, Attendance.session_id == session.id)).first()  # existing record?
    if row is not None and row.revoked_at is None:  # already counted
        raise HTTPException(status.HTTP_409_CONFLICT, "already_present")  # stop
    if row is not None:  # revoked record: reinstate the same row (nothing is ever deleted)
        before = _snapshot(row)  # for the audit row
        row.revoked_at = None  # clear revocation
        row.revoked_by_user_id = None  # clear revocation
        row.revoke_reason = None  # clear revocation
        row.recorded_by_user_id = user.id  # lecturer who reinstated it
        row.note = reason  # why
        write_audit(db, actor=user, action="attendance.reinstated", entity="attendance", entity_id=row.id, details={"session_id": session.id, "student_id": student.id, "before": before, "after": _snapshot(row)})  # audit
        db.commit()  # change + audit together
        return row  # reinstated
    row = Attendance(  # new manual record
        session_id=session.id,  # which session
        student_id=student.id,  # which student
        device_id=None,  # not from a terminal
        method=Method.manual,  # lecturer-confirmed
        idempotency_key=None,  # only terminal events have one
        recorded_by_user_id=user.id,  # who entered it
        note=reason,  # why
    )
    db.add(row)  # queue insert
    try:  # unique (student, session) is the final guard
        db.flush()  # get row.id for the audit row
    except IntegrityError:  # a scan landed at the same moment
        db.rollback()  # undo
        raise HTTPException(status.HTTP_409_CONFLICT, "already_present")  # someone else recorded it
    write_audit(db, actor=user, action="attendance.manual", entity="attendance", entity_id=row.id, details={"session_id": session.id, "student_id": student.id, "reason": reason})  # audit
    db.commit()  # record + audit together
    db.refresh(row)  # load recorded_at set by the DB
    return row  # created


def revoke(db: Session, *, attendance_id: int, reason: str, user: User) -> Attendance:  # soft-delete a record
    row = db.get(Attendance, attendance_id)  # find it
    session = db.get(LectureSession, row.session_id) if row is not None else None  # its session
    if row is None or session is None or not can_access_course(db, user, session.course_id):  # missing or not this lecturer's course
        raise HTTPException(status.HTTP_404_NOT_FOUND, "attendance_not_found")  # 404, not 403
    if row.revoked_at is not None:  # already revoked
        raise HTTPException(status.HTTP_409_CONFLICT, "already_revoked")  # stop
    before = _snapshot(row)  # for the audit row
    row.revoked_at = _now()  # soft delete
    row.revoked_by_user_id = user.id  # who
    row.revoke_reason = reason  # why
    write_audit(db, actor=user, action="attendance.revoked", entity="attendance", entity_id=row.id, details={"session_id": session.id, "student_id": row.student_id, "before": before, "after": _snapshot(row)})  # audit
    db.commit()  # change + audit together
    return row  # revoked (row still exists)


def _local(value: datetime | None, tz: ZoneInfo) -> str:  # ISO 8601 with offset in the display timezone
    return value.astimezone(tz).isoformat() if value is not None else ""  # blank when missing


def export_csv(db: Session, *, session: LectureSession, user: User) -> tuple[str, str]:  # returns (filename, CSV text with BOM)
    tz = ZoneInfo(settings.display_timezone)  # e.g. Africa/Johannesburg
    entries = roster_entries(db, session)  # one line per roster student
    buffer = io.StringIO()  # build in memory
    buffer.write("﻿")  # UTF-8 BOM so Excel detects the encoding
    writer = csv.writer(buffer, lineterminator="\r\n")  # Excel-friendly line endings
    writer.writerow(CSV_COLUMNS)  # header row
    for e in entries:  # each student
        writer.writerow([e.student_number, e.full_name, e.status, e.method.value if e.method else "", _local(e.recorded_at, tz), _local(e.device_time, tz), e.note or "", e.revoke_reason or ""])  # one row
    course = db.get(Course, session.course_id)  # for the filename
    filename = f"attendance_{course.code}_{session.opened_at.astimezone(tz):%Y-%m-%d}_session{session.id}.csv"  # e.g. attendance_PD2316D_2026-10-20_session5.csv
    write_audit(db, actor=user, action="attendance.exported", entity="sessions", entity_id=session.id, details={"rows": len(entries), "filename": filename})  # audit
    db.commit()  # save the audit row
    return filename, buffer.getvalue()  # file name + content


def course_report(db: Session, course: Course) -> CourseReport:  # attendance % per student (P2)
    closed = db.scalar(select(func.count()).select_from(LectureSession).where(LectureSession.course_id == course.id, LectureSession.closed_at.is_not(None)))  # sessions counted
    students = db.scalars(select(Student).join(CourseStudent, CourseStudent.student_id == Student.id).where(CourseStudent.course_id == course.id).order_by(Student.full_name, Student.student_number)).all()  # the class list
    attended = dict(db.execute(  # student_id -> closed sessions attended
        select(Attendance.student_id, func.count())  # count records
        .join(LectureSession, LectureSession.id == Attendance.session_id)  # need course + closed state
        .where(LectureSession.course_id == course.id, LectureSession.closed_at.is_not(None), Attendance.revoked_at.is_(None))  # closed sessions, valid records
        .group_by(Attendance.student_id)  # per student
    ).tuples().all())
    rows = [ReportRow(student_id=s.id, student_number=s.student_number, full_name=s.full_name, attended=attended.get(s.id, 0), percentage=round(attended.get(s.id, 0) * 100 / closed, 1) if closed else 0.0) for s in students]  # one row per student
    return CourseReport(course=course_outs(db, [course])[0], closed_sessions=closed, students=rows)  # the report
