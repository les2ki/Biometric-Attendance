from typing import Annotated  # dependency typing

from fastapi import APIRouter, Depends, HTTPException, Response, status  # routing + errors
from sqlalchemy import select  # query builder
from sqlalchemy.exc import IntegrityError  # unique-constraint violations
from sqlalchemy.orm import Session  # DB session type

from app.config import settings  # fp_accept_confidence
from app.db import get_db  # per-request session
from app.models import Attendance, CommandType, CourseStudent, FingerprintSlot, LectureSession, Method, Student  # tables used here
from app.schemas import AttendanceIn, AttendanceOut, CommandResultIn, CommandResultOut, DeviceCommandOut, SessionOut  # request/response shapes
from app.security import CurrentDevice  # HMAC-authenticated terminal
from app.services.commands import next_command, report_result  # command queue logic

router = APIRouter(prefix="/device", tags=["device"])  # every route here starts with /device
DbSession = Annotated[Session, Depends(get_db)]  # "inject a DB session"


def _result(status_text: str, student: Student) -> AttendanceOut:  # builds the reply the terminal displays
    return AttendanceOut(status=status_text, student_number=student.student_number, full_name=student.full_name)  # same shape every time


@router.get("/session", response_model=SessionOut)  # terminal asks: "which session am I recording for?"
def current_session(device: CurrentDevice, db: DbSession) -> SessionOut:  # device already authenticated
    stmt = (  # newest open session assigned to this terminal
        select(LectureSession)  # from the sessions table
        .where(LectureSession.device_id == device.id, LectureSession.closed_at.is_(None))  # this device, still open
        .order_by(LectureSession.opened_at.desc())  # newest first
    )
    session = db.scalars(stmt).first()  # one row or None
    if session is None:  # lecturer hasn't opened a session
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no_open_session")  # terminal shows "No session"
    return SessionOut(session_id=session.id, course_code=session.course.code, venue=session.venue)  # terminal caches session_id


@router.post("/attendance", response_model=AttendanceOut)  # one fingerprint scan (live or synced from the offline queue)
def mark_attendance(payload: AttendanceIn, device: CurrentDevice, db: DbSession) -> AttendanceOut:  # validated body + authenticated device
    previous = db.scalars(select(Attendance).where(Attendance.idempotency_key == payload.idempotency_key)).first()  # seen this exact event before?
    if previous is not None:  # a retry or re-sync of an event already saved
        return _result("recorded", db.get(Student, previous.student_id))  # same answer as the first time, no new row
    session = db.get(LectureSession, payload.session_id)  # the session the terminal cached
    if session is None or session.device_id != device.id:  # missing, or belongs to another terminal
        raise HTTPException(status.HTTP_404_NOT_FOUND, "unknown_session")  # reject
    if session.closed_at is not None and (payload.device_time is None or payload.device_time > session.closed_at):  # scanned after closing
        raise HTTPException(status.HTTP_409_CONFLICT, "session_closed")  # SYNC_CONFLICT: lecturer resolves manually
    slot = db.scalars(select(FingerprintSlot).where(FingerprintSlot.device_id == device.id, FingerprintSlot.slot_number == payload.slot_number)).first()  # who is in that slot?
    if slot is None:  # sensor has a template the server doesn't know
        raise HTTPException(status.HTTP_404_NOT_FOUND, "unknown_slot")  # re-enrol that finger
    student = db.get(Student, slot.student_id)  # the matched student
    if not student.is_active or db.get(CourseStudent, (session.course_id, student.id)) is None:  # D2: inactive or not on this course's class list
        return _result("not_in_course", student)  # nothing saved
    if payload.confidence < settings.fp_accept_confidence:  # match too weak to trust alone
        return _result("low_confidence", student)  # terminal goes to face/lecturer fallback; nothing saved
    already = db.scalars(select(Attendance).where(Attendance.student_id == student.id, Attendance.session_id == session.id)).first()  # already marked present? (a revoked row counts too: only the lecturer can reinstate)
    if already is not None:  # second scan, new event
        return _result("duplicate", student)  # DUPLICATE_IGNORED
    db.add(Attendance(  # the attendance record
        session_id=session.id,  # which session
        student_id=student.id,  # which student
        device_id=device.id,  # which terminal
        method=Method.fingerprint,  # verified by fingerprint
        fp_confidence=payload.confidence,  # kept for threshold tuning (FRR tests)
        device_time=payload.device_time,  # RTC time (supporting info)
        idempotency_key=payload.idempotency_key,  # makes retries safe
    ))
    try:  # DB unique constraints are the final guard
        db.commit()  # recorded_at is set by the database (canonical time)
    except IntegrityError:  # two requests raced past the checks above
        db.rollback()  # undo
        return _result("duplicate", student)  # the other request won; still exactly one row
    return _result("recorded", student)  # VERIFIED


@router.get("/commands/next", response_model=DeviceCommandOut, responses={204: {"description": "No commands"}})  # terminal polls for work every ~3 s
def next_device_command(device: CurrentDevice, db: DbSession) -> DeviceCommandOut | Response:  # device already authenticated
    found = next_command(db, device)  # expire, skip, claim
    if found is None:  # nothing queued
        return Response(status_code=status.HTTP_204_NO_CONTENT)  # empty body
    cmd, student = found  # the claimed command
    return DeviceCommandOut(  # what the terminal needs
        command_id=cmd.id,  # echoed back in the result
        type=cmd.type.value,  # enrol / delete_slot
        slot_number=cmd.slot_number,  # sensor slot
        student_number=student.student_number if student and cmd.type == CommandType.enrol else None,  # LCD info for enrol only
        full_name=student.full_name if student and cmd.type == CommandType.enrol else None,  # LCD info for enrol only
        expires_at=cmd.expires_at,  # deadline (None for wipes)
    )


@router.post("/commands/{command_id}/result", response_model=CommandResultOut)  # terminal reports how a command went
def command_result(command_id: int, payload: CommandResultIn, device: CurrentDevice, db: DbSession) -> CommandResultOut:  # validated body + authenticated device
    cmd = report_result(db, device=device, command_id=command_id, success=payload.success, detail=payload.detail)  # apply the result
    return CommandResultOut(command_id=cmd.id, status=cmd.status.value)  # final status
