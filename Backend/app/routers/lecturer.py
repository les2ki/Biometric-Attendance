from datetime import datetime, timezone  # closing time

from fastapi import APIRouter, HTTPException, Response, status  # routing + errors + raw CSV response
from sqlalchemy import select  # query builder

from app.auth import StaffUser  # lecturers (and admins)
from app.models import Course, Device, LectureSession  # tables used here
from app.routers.common import DbSession, PageParams, page_rows  # shared dependencies
from app.schemas.admin import CourseOut  # course list shape
from app.schemas.common import Page  # paged list
from app.schemas.lecturer import CourseReport, DeviceSummary, ManualMark, RevokeIn, RosterEntry, RosterView, SessionCreate, SessionOut  # request/response shapes
from app.services import attendance as attendance_service  # roster, manual mark, revoke, export, report
from app.services.access import get_course_for_user, get_session_for_user, lecturer_course_ids  # D5 visibility rules
from app.services.audit import write_audit  # audit trail
from app.services.views import course_outs, is_online, session_out, session_outs  # response builders

router = APIRouter(prefix="/lecturer", tags=["lecturer"])  # every route here starts with /lecturer


@router.get("/courses", response_model=list[CourseOut])  # courses this user teaches (admin: all active)
def my_courses(user: StaffUser, db: DbSession) -> list[CourseOut]:  # no filters
    stmt = select(Course).where(Course.is_active.is_(True)).order_by(Course.code)  # active courses, by code
    allowed = lecturer_course_ids(db, user)  # None = admin
    if allowed is not None:  # lecturer
        stmt = stmt.where(Course.id.in_(allowed))  # assigned only
    return course_outs(db, list(db.scalars(stmt)))  # with counts


@router.get("/devices", response_model=list[DeviceSummary])  # terminals to pick when opening a session
def devices(user: StaffUser, db: DbSession) -> list[DeviceSummary]:  # no filters
    active = db.scalars(select(Device).where(Device.is_active.is_(True)).order_by(Device.name)).all()  # usable terminals
    busy = set(db.scalars(select(LectureSession.device_id).where(LectureSession.closed_at.is_(None))))  # terminals with an open session
    return [DeviceSummary(id=d.id, name=d.name, online=is_online(d), busy=d.id in busy) for d in active]  # summaries


@router.post("/sessions", response_model=SessionOut, status_code=status.HTTP_201_CREATED)  # open a session on a terminal
def open_session(payload: SessionCreate, user: StaffUser, db: DbSession) -> SessionOut:  # validated body
    course = get_course_for_user(db, user, payload.course_id)  # 404 if missing or not theirs
    if not course.is_active:  # archived
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "course_inactive")  # stop
    device = db.get(Device, payload.device_id)  # the terminal
    if device is None:  # bad ID
        raise HTTPException(status.HTTP_404_NOT_FOUND, "device_not_found")  # stop
    if not device.is_active:  # revoked terminal
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "device_inactive")  # stop
    if db.scalars(select(LectureSession).where(LectureSession.device_id == device.id, LectureSession.closed_at.is_(None))).first():  # already running a session
        raise HTTPException(status.HTTP_409_CONFLICT, "device_busy")  # one open session per device
    session = LectureSession(course_id=course.id, venue=payload.venue.strip(), lecturer_id=user.id, device_id=device.id)  # lecturer_id = whoever opened it
    db.add(session)  # queue insert
    db.flush()  # get session.id
    write_audit(db, actor=user, action="session.opened", entity="sessions", entity_id=session.id, details={"course_id": course.id, "device_id": device.id, "venue": session.venue})  # audit
    db.commit()  # session + audit together
    db.refresh(session)  # load opened_at set by the DB
    return session_out(db, session)  # terminal picks it up on its next /device/session


@router.get("/sessions", response_model=Page[SessionOut])  # sessions this user can see, newest first
def list_sessions(user: StaffUser, db: DbSession, page: PageParams, course_id: int | None = None, open_only: bool = False) -> Page[SessionOut]:  # optional filters
    stmt = select(LectureSession).order_by(LectureSession.opened_at.desc(), LectureSession.id.desc())  # newest first
    allowed = lecturer_course_ids(db, user)  # None = admin
    if allowed is not None:  # lecturer
        stmt = stmt.where(LectureSession.course_id.in_(allowed))  # their courses only
    if course_id is not None:  # one course
        stmt = stmt.where(LectureSession.course_id == course_id)  # filter
    if open_only:  # running sessions only
        stmt = stmt.where(LectureSession.closed_at.is_(None))  # filter
    rows, total = page_rows(db, stmt, page)  # one page
    return Page[SessionOut](items=session_outs(db, rows), total=total)  # response


@router.get("/sessions/{session_id}", response_model=SessionOut)  # one session
def get_session(session_id: int, user: StaffUser, db: DbSession) -> SessionOut:  # path ID
    return session_out(db, get_session_for_user(db, user, session_id))  # 404 if not theirs


@router.post("/sessions/{session_id}/close", response_model=SessionOut)  # end a session
def close_session(session_id: int, user: StaffUser, db: DbSession) -> SessionOut:  # path ID
    session = get_session_for_user(db, user, session_id)  # 404 if not theirs
    if session.closed_at is not None:  # already closed
        raise HTTPException(status.HTTP_409_CONFLICT, "session_already_closed")  # stop
    session.closed_at = datetime.now(timezone.utc)  # close now
    write_audit(db, actor=user, action="session.closed", entity="sessions", entity_id=session.id)  # audit
    db.commit()  # change + audit together
    return session_out(db, session)  # response


@router.get("/sessions/{session_id}/attendance", response_model=RosterView)  # live roster (dashboard polls every 3-5 s)
def session_attendance(session_id: int, user: StaffUser, db: DbSession) -> RosterView:  # path ID
    session = get_session_for_user(db, user, session_id)  # 404 if not theirs
    return RosterView(session=session_out(db, session), entries=attendance_service.roster_entries(db, session))  # header + one line per student


@router.post("/sessions/{session_id}/manual", response_model=RosterEntry, status_code=status.HTTP_201_CREATED)  # non-biometric fallback / correction
def manual_mark(session_id: int, payload: ManualMark, user: StaffUser, db: DbSession) -> RosterEntry:  # validated body
    session = get_session_for_user(db, user, session_id)  # 404 if not theirs
    row = attendance_service.manual_mark(db, session=session, student_number=payload.student_number, reason=payload.reason, user=user)  # insert or reinstate + audit
    return attendance_service.entry_for(db, row)  # updated roster line


@router.post("/attendance/{attendance_id}/revoke", response_model=RosterEntry)  # soft-delete a record
def revoke_attendance(attendance_id: int, payload: RevokeIn, user: StaffUser, db: DbSession) -> RosterEntry:  # validated body
    row = attendance_service.revoke(db, attendance_id=attendance_id, reason=payload.reason, user=user)  # 404 if not theirs; audit
    return attendance_service.entry_for(db, row)  # updated roster line


@router.get("/sessions/{session_id}/export.csv", response_class=Response, responses={200: {"content": {"text/csv": {}}}})  # download the roster as CSV
def export_csv(session_id: int, user: StaffUser, db: DbSession) -> Response:  # path ID
    session = get_session_for_user(db, user, session_id)  # 404 if not theirs
    filename, content = attendance_service.export_csv(db, session=session, user=user)  # build + audit
    return Response(content=content.encode("utf-8"), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="{filename}"'})  # browser download


@router.get("/courses/{course_id}/report", response_model=CourseReport)  # attendance % per student (P2)
def course_report(course_id: int, user: StaffUser, db: DbSession) -> CourseReport:  # path ID
    return attendance_service.course_report(db, get_course_for_user(db, user, course_id))  # 404 if not theirs
