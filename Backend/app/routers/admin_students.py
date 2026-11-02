from datetime import datetime, timezone  # consent timestamp

from fastapi import APIRouter, HTTPException, status  # routing + errors
from sqlalchemy import or_, select  # query builders
from sqlalchemy.exc import IntegrityError  # unique student number clash

from app.auth import AdminUser  # admin guard
from app.models import Course, CourseStudent, Device, DeviceCommand, FingerprintSlot, Student  # tables used here
from app.routers.common import DbSession, PageParams, page_rows  # shared dependencies
from app.schemas.admin import CommandOut, ConsentUpdate, CourseBrief, EnrolIn, SlotOut, StudentCreate, StudentDetail, StudentOut, StudentUpdate  # request/response shapes
from app.schemas.common import Page  # paged list
from app.services.audit import write_audit  # audit trail
from app.services.commands import OPEN_STATUSES, delete_student_biometrics, queue_enrol  # command queue
from app.services.views import command_outs, student_out, student_outs  # response builders

router = APIRouter(prefix="/admin/students", tags=["admin"])  # every route here starts with /admin/students


def _get_student(db: DbSession, student_id: int) -> Student:  # load or 404
    student = db.get(Student, student_id)  # look it up
    if student is None:  # bad ID
        raise HTTPException(status.HTTP_404_NOT_FOUND, "student_not_found")  # stop
    return student  # found


def _snapshot(student: Student) -> dict:  # fields an admin can change, for before/after audit
    return {"full_name": student.full_name, "is_active": student.is_active}  # JSON-safe


@router.get("", response_model=Page[StudentOut])  # list students
def list_students(admin: AdminUser, db: DbSession, page: PageParams, search: str | None = None, course_id: int | None = None, active: bool | None = None) -> Page[StudentOut]:  # optional filters
    stmt = select(Student).order_by(Student.full_name, Student.student_number)  # alphabetical
    if search:  # free-text filter
        stmt = stmt.where(or_(Student.student_number.ilike(f"%{search}%"), Student.full_name.ilike(f"%{search}%")))  # number or name contains
    if course_id is not None:  # only one course's roster
        stmt = stmt.join(CourseStudent, CourseStudent.student_id == Student.id).where(CourseStudent.course_id == course_id)  # roster join
    if active is not None:  # active / inactive only
        stmt = stmt.where(Student.is_active.is_(active))  # flag filter
    rows, total = page_rows(db, stmt, page)  # one page
    return Page[StudentOut](items=student_outs(db, rows), total=total)  # with enrolled devices


@router.post("", response_model=StudentOut, status_code=status.HTTP_201_CREATED)  # register a student
def create_student(payload: StudentCreate, admin: AdminUser, db: DbSession) -> StudentOut:  # validated body
    if db.scalars(select(Student).where(Student.student_number == payload.student_number)).first():  # number already used
        raise HTTPException(status.HTTP_409_CONFLICT, "student_number_taken")  # stop
    student = Student(student_number=payload.student_number, full_name=payload.full_name, biometric_consent=False, is_active=True)  # consent starts false
    db.add(student)  # queue insert
    try:  # unique number is the final guard
        db.flush()  # get student.id
    except IntegrityError:  # raced with another create
        db.rollback()  # undo
        raise HTTPException(status.HTTP_409_CONFLICT, "student_number_taken")  # stop
    write_audit(db, actor=admin, action="student.created", entity="students", entity_id=student.id, details={"student_number": student.student_number})  # audit
    db.commit()  # student + audit together
    return student_out(db, student)  # response


@router.get("/{student_id}", response_model=StudentDetail)  # one student with courses, slots and open commands
def get_student(student_id: int, admin: AdminUser, db: DbSession) -> StudentDetail:  # path ID
    student = _get_student(db, student_id)  # load or 404
    courses = db.scalars(select(Course).join(CourseStudent, CourseStudent.course_id == Course.id).where(CourseStudent.student_id == student.id).order_by(Course.code)).all()  # rosters
    slots = db.execute(select(FingerprintSlot.device_id, Device.name, FingerprintSlot.slot_number).join(Device, Device.id == FingerprintSlot.device_id).where(FingerprintSlot.student_id == student.id).order_by(FingerprintSlot.device_id)).all()  # where templates live
    commands = db.scalars(select(DeviceCommand).where(DeviceCommand.student_id == student.id, DeviceCommand.status.in_(OPEN_STATUSES)).order_by(DeviceCommand.created_at, DeviceCommand.id)).all()  # unfinished work
    base = student_out(db, student)  # common fields
    return StudentDetail(  # full detail
        **base.model_dump(),  # id, number, name, flags, devices
        courses=[CourseBrief(id=c.id, code=c.code, name=c.name) for c in courses],  # rosters
        fingerprint_slots=[SlotOut(device_id=d, device_name=n, slot_number=s) for d, n, s in slots],  # slots
        open_commands=command_outs(db, list(commands)),  # commands
    )


@router.patch("/{student_id}", response_model=StudentOut)  # change name/active (P2)
def update_student(student_id: int, payload: StudentUpdate, admin: AdminUser, db: DbSession) -> StudentOut:  # validated body
    student = _get_student(db, student_id)  # load or 404
    before = _snapshot(student)  # for the audit row
    if payload.full_name is not None:  # name change
        student.full_name = payload.full_name  # apply
    deactivating = payload.is_active is False and student.is_active  # turning the student off?
    if payload.is_active is not None:  # active change
        student.is_active = payload.is_active  # apply
    if deactivating:  # inactive students keep no biometrics
        delete_student_biometrics(db, student=student, device_id=None, admin=admin)  # wipe every sensor
    write_audit(db, actor=admin, action="student.updated", entity="students", entity_id=student.id, details={"before": before, "after": _snapshot(student)})  # audit
    db.commit()  # all changes + audit together
    return student_out(db, student)  # response


@router.put("/{student_id}/consent", response_model=StudentOut)  # grant or withdraw biometric consent
def set_consent(student_id: int, payload: ConsentUpdate, admin: AdminUser, db: DbSession) -> StudentOut:  # validated body
    student = _get_student(db, student_id)  # load or 404
    if payload.consent:  # grant
        student.biometric_consent = True  # allowed to enrol
        student.consent_at = datetime.now(timezone.utc)  # when
        write_audit(db, actor=admin, action="consent.granted", entity="students", entity_id=student.id)  # audit
    else:  # withdraw (POPIA)
        student.biometric_consent = False  # no more biometrics
        student.consent_at = None  # clear the timestamp
        delete_student_biometrics(db, student=student, device_id=None, admin=admin)  # unlink + wipe every sensor
        write_audit(db, actor=admin, action="consent.withdrawn", entity="students", entity_id=student.id)  # audit
    db.commit()  # all changes + audit together
    return student_out(db, student)  # response


@router.post("/{student_id}/enrol", response_model=CommandOut, status_code=status.HTTP_201_CREATED)  # queue an enrol command for a terminal
def enrol_student(student_id: int, payload: EnrolIn, admin: AdminUser, db: DbSession) -> CommandOut:  # validated body
    cmd = queue_enrol(db, student=db.get(Student, student_id), device=db.get(Device, payload.device_id), admin=admin)  # validates, picks slot, audits
    db.commit()  # command + audit together
    return command_outs(db, [cmd])[0]  # response


@router.delete("/{student_id}/fingerprints", response_model=list[CommandOut])  # delete biometrics (one device or all)
def delete_fingerprints(student_id: int, admin: AdminUser, db: DbSession, device_id: int | None = None) -> list[CommandOut]:  # optional device filter
    student = _get_student(db, student_id)  # load or 404
    if device_id is not None and db.get(Device, device_id) is None:  # bad device ID
        raise HTTPException(status.HTTP_404_NOT_FOUND, "device_not_found")  # stop
    wipes = delete_student_biometrics(db, student=student, device_id=device_id, admin=admin)  # unlink + queue wipes + audit
    db.commit()  # all together
    return command_outs(db, wipes)  # the queued wipes
