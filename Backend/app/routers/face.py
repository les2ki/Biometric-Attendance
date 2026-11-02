import threading  # load the face models in the background at start-up

from fastapi import APIRouter, HTTPException, Request, status  # routing + raw body + errors
from pydantic import BaseModel, Field  # request/response shapes
from sqlalchemy import delete, select  # queries

from app.auth import AdminUser, StaffUser  # admins; lecturers (and admins)
from app.models import CommandType, CourseStudent, Device, FaceTemplate, Student  # tables used here
from app.routers.common import DbSession  # per-request DB session
from app.schemas.admin import CommandOut  # queued command as the dashboard sees it
from app.security import CurrentDevice  # HMAC-authenticated terminal
from app.services import face as face_service  # analysis + queueing
from app.services.access import get_session_for_user  # lecturer can only use their own sessions
from app.services.audit import write_audit  # audit trail

router = APIRouter()  # paths below carry their own prefixes
threading.Thread(target=face_service.preload, daemon=True).start()  # download/load models now so the first picture is quick


class FaceDeviceIn(BaseModel):  # admin: which terminal takes the picture
    device_id: int  # terminal id


class FaceVerifyIn(BaseModel):  # lecturer: which student to verify
    student_number: str = Field(min_length=1, max_length=20, pattern=r"^[0-9]+$")  # e.g. 220000001


class FaceStatusOut(BaseModel):  # GET face status for the student page
    enrolled: bool  # a template exists
    enrolled_at: str | None  # when (ISO)


class FaceResultOut(BaseModel):  # reply to the terminal's picture upload
    status: str  # ok / no_face / multiple_faces / poor_quality / no_match / face_not_enrolled
    full_name: str  # for the LCD
    score: float | None  # verify similarity (tuning)
    attendance: str | None  # lecturer verify: recorded / already_present / not_in_course / revoked


def _command_out(db, cmd) -> CommandOut:  # same shape the existing command lists use
    student = db.get(Student, cmd.student_id) if cmd.student_id is not None else None  # for the number
    return CommandOut(id=cmd.id, device_id=cmd.device_id, type=cmd.type, status=cmd.status, slot_number=cmd.slot_number, student_id=cmd.student_id, student_number=student.student_number if student else None, created_at=cmd.created_at, expires_at=cmd.expires_at, completed_at=cmd.completed_at, result_detail=cmd.result_detail)  # build


@router.get("/admin/students/{student_id}/face", response_model=FaceStatusOut, tags=["admin"])  # is a face enrolled?
def face_status(student_id: int, user: AdminUser, db: DbSession) -> FaceStatusOut:  # admin only
    row = db.scalars(select(FaceTemplate).where(FaceTemplate.student_id == student_id)).first()  # template?
    return FaceStatusOut(enrolled=row is not None, enrolled_at=row.created_at.isoformat() if row else None)  # answer


@router.post("/admin/students/{student_id}/face/enrol", response_model=CommandOut, status_code=status.HTTP_201_CREATED, tags=["admin"])  # admin: enrol a face on a terminal
def face_enrol(student_id: int, payload: FaceDeviceIn, user: AdminUser, db: DbSession) -> CommandOut:  # admin only
    cmd = face_service.queue_face(db, kind=CommandType.face_enrol, student=db.get(Student, student_id), device=db.get(Device, payload.device_id), user=user)  # validate + queue
    db.commit()  # save with its audit row
    return _command_out(db, cmd)  # the dashboard tracks it like a fingerprint enrolment


@router.post("/admin/students/{student_id}/face/verify", response_model=CommandOut, status_code=status.HTTP_201_CREATED, tags=["admin"])  # admin: test a face match (no attendance)
def face_verify_admin(student_id: int, payload: FaceDeviceIn, user: AdminUser, db: DbSession) -> CommandOut:  # admin only
    cmd = face_service.queue_face(db, kind=CommandType.face_verify, student=db.get(Student, student_id), device=db.get(Device, payload.device_id), user=user)  # validate + queue
    db.commit()  # save
    return _command_out(db, cmd)  # tracked on the student page


@router.delete("/admin/students/{student_id}/face", status_code=status.HTTP_204_NO_CONTENT, tags=["admin"])  # admin: delete the face template (POPIA)
def face_delete(student_id: int, user: AdminUser, db: DbSession) -> None:  # admin only
    if db.get(Student, student_id) is None:  # bad id
        raise HTTPException(status.HTTP_404_NOT_FOUND, "student_not_found")  # stop
    db.execute(delete(FaceTemplate).where(FaceTemplate.student_id == student_id))  # remove
    write_audit(db, actor=user, action="face.deleted", entity="students", entity_id=student_id, details={})  # audit
    db.commit()  # save


@router.post("/lecturer/sessions/{session_id}/face-verify", response_model=CommandOut, status_code=status.HTTP_201_CREATED, tags=["lecturer"])  # lecturer: verify a student by face; marks present on a match
def face_verify_lecturer(session_id: int, payload: FaceVerifyIn, user: StaffUser, db: DbSession) -> CommandOut:  # lecturer or admin
    session = get_session_for_user(db, user, session_id)  # 404 if not theirs
    if session.closed_at is not None:  # the terminal has moved on
        raise HTTPException(status.HTTP_409_CONFLICT, "session_already_closed")  # stop
    student = db.scalars(select(Student).where(Student.student_number == payload.student_number)).first()  # who
    if student is None:  # unknown number
        raise HTTPException(status.HTTP_404_NOT_FOUND, "unknown_student")  # stop
    if db.get(CourseStudent, (session.course_id, student.id)) is None:  # not on the class list
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "not_in_course")  # stop
    cmd = face_service.queue_face(db, kind=CommandType.face_verify, student=student, device=db.get(Device, session.device_id), user=user, session=session)  # the session's terminal
    db.commit()  # save
    return _command_out(db, cmd)  # roster turns present when it matches


@router.post("/device/commands/{command_id}/face", response_model=FaceResultOut, tags=["device"])  # terminal uploads the raw picture
async def face_upload(command_id: int, request: Request, device: CurrentDevice, db: DbSession) -> FaceResultOut:  # signed like every /device call
    raw = await request.body()  # exact bytes (already checked by the signature)
    return FaceResultOut(**face_service.handle_frame(db, device=device, command_id=command_id, raw=raw))  # analyse + reply
