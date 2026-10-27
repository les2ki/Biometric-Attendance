import csv  # CSV parsing
import io  # wrap the uploaded bytes
import re  # student number format

from fastapi import APIRouter, HTTPException, UploadFile, status  # routing + errors + file upload
from fastapi.responses import JSONResponse  # bad_csv response with a row number
from sqlalchemy import delete, select  # query builders
from sqlalchemy.exc import IntegrityError  # unique code clash

from app.auth import AdminUser  # admin guard
from app.models import Course, CourseLecturer, CourseStudent, Role, Student, User  # tables used here
from app.routers.common import DbSession  # DB session dependency
from app.schemas.admin import CourseCreate, CourseDetail, CourseOut, CourseUpdate, LecturersSet, RosterChange, RosterImportOut, StudentsAdd  # request/response shapes
from app.schemas.auth import UserOut  # lecturer shape
from app.services.audit import write_audit  # audit trail
from app.services.views import course_outs, student_outs  # response builders

router = APIRouter(prefix="/admin/courses", tags=["admin"])  # every route here starts with /admin/courses
STUDENT_NUMBER = re.compile(r"^[0-9]{6,12}$")  # same rule as StudentCreate


def _get_course(db: DbSession, course_id: int) -> Course:  # load or 404
    course = db.get(Course, course_id)  # look it up
    if course is None:  # bad ID
        raise HTTPException(status.HTTP_404_NOT_FOUND, "course_not_found")  # stop
    return course  # found


def _detail(db: DbSession, course: Course) -> CourseDetail:  # course with lecturers and roster
    lecturers = db.scalars(select(User).join(CourseLecturer, CourseLecturer.user_id == User.id).where(CourseLecturer.course_id == course.id).order_by(User.full_name)).all()  # assigned lecturers
    students = db.scalars(select(Student).join(CourseStudent, CourseStudent.student_id == Student.id).where(CourseStudent.course_id == course.id).order_by(Student.full_name, Student.student_number)).all()  # roster
    return CourseDetail(**course_outs(db, [course])[0].model_dump(), lecturers=[UserOut.model_validate(u) for u in lecturers], students=student_outs(db, list(students)))  # full detail


def _add_to_roster(db: DbSession, course: Course, numbers: list[str]) -> RosterChange:  # shared by add + import
    added: list[str] = []  # newly on the roster
    present: list[str] = []  # already on it
    unknown: list[str] = []  # no such student
    seen: set[str] = set()  # ignore repeats in the same request
    for raw in numbers:  # each requested number
        number = raw.strip()  # tidy
        if number in seen:  # repeated in the list
            continue  # skip
        seen.add(number)  # remember
        student = db.scalars(select(Student).where(Student.student_number == number)).first()  # find the student
        if student is None:  # not registered
            unknown.append(number)  # report it
        elif db.get(CourseStudent, (course.id, student.id)) is not None:  # already on the roster
            present.append(number)  # report it
        else:  # new to this roster
            db.add(CourseStudent(course_id=course.id, student_id=student.id))  # add
            db.flush()  # so a repeat in this request is seen as present
            added.append(number)  # report it
    return RosterChange(added=added, already_present=present, unknown=unknown)  # summary


@router.get("", response_model=list[CourseOut])  # list courses
def list_courses(admin: AdminUser, db: DbSession, active: bool | None = None) -> list[CourseOut]:  # optional active filter
    stmt = select(Course).order_by(Course.code)  # alphabetical by code
    if active is not None:  # active / archived only
        stmt = stmt.where(Course.is_active.is_(active))  # flag filter
    return course_outs(db, list(db.scalars(stmt)))  # with counts


@router.post("", response_model=CourseOut, status_code=status.HTTP_201_CREATED)  # create a course
def create_course(payload: CourseCreate, admin: AdminUser, db: DbSession) -> CourseOut:  # validated body
    code = payload.code.strip().upper()  # codes stored upper-case
    if db.scalars(select(Course).where(Course.code == code)).first():  # code already used
        raise HTTPException(status.HTTP_409_CONFLICT, "course_code_taken")  # stop
    course = Course(code=code, name=payload.name.strip(), is_active=True)  # new course
    db.add(course)  # queue insert
    try:  # unique code is the final guard
        db.flush()  # get course.id
    except IntegrityError:  # raced with another create
        db.rollback()  # undo
        raise HTTPException(status.HTTP_409_CONFLICT, "course_code_taken")  # stop
    write_audit(db, actor=admin, action="course.created", entity="courses", entity_id=course.id, details={"code": code, "name": course.name})  # audit
    db.commit()  # course + audit together
    return course_outs(db, [course])[0]  # response


@router.get("/{course_id}", response_model=CourseDetail)  # one course with lecturers and roster
def get_course(course_id: int, admin: AdminUser, db: DbSession) -> CourseDetail:  # path ID
    return _detail(db, _get_course(db, course_id))  # load or 404, then build


@router.patch("/{course_id}", response_model=CourseOut)  # rename / archive (P2)
def update_course(course_id: int, payload: CourseUpdate, admin: AdminUser, db: DbSession) -> CourseOut:  # validated body
    course = _get_course(db, course_id)  # load or 404
    before = {"name": course.name, "is_active": course.is_active}  # for the audit row
    if payload.name is not None:  # rename
        course.name = payload.name.strip()  # apply
    if payload.is_active is not None:  # archive / restore
        course.is_active = payload.is_active  # apply
    write_audit(db, actor=admin, action="course.updated", entity="courses", entity_id=course.id, details={"before": before, "after": {"name": course.name, "is_active": course.is_active}})  # audit
    db.commit()  # change + audit together
    return course_outs(db, [course])[0]  # response


@router.put("/{course_id}/lecturers", response_model=CourseDetail)  # replace the set of lecturers
def set_lecturers(course_id: int, payload: LecturersSet, admin: AdminUser, db: DbSession) -> CourseDetail:  # validated body
    course = _get_course(db, course_id)  # load or 404
    wanted = sorted(set(payload.user_ids))  # de-duplicated new set
    valid = set(db.scalars(select(User.id).where(User.id.in_(wanted), User.role == Role.lecturer, User.is_active.is_(True)))) if wanted else set()  # active lecturers among them
    if valid != set(wanted):  # some ID isn't an active lecturer
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "not_a_lecturer")  # stop
    before = sorted(db.scalars(select(CourseLecturer.user_id).where(CourseLecturer.course_id == course.id)))  # current set
    db.execute(delete(CourseLecturer).where(CourseLecturer.course_id == course.id))  # clear
    db.add_all([CourseLecturer(course_id=course.id, user_id=uid) for uid in wanted])  # new set
    write_audit(db, actor=admin, action="course.lecturers_set", entity="courses", entity_id=course.id, details={"before": before, "after": wanted})  # audit
    db.commit()  # change + audit together
    return _detail(db, course)  # response


@router.post("/{course_id}/students", response_model=RosterChange)  # add students to the roster by number
def add_students(course_id: int, payload: StudentsAdd, admin: AdminUser, db: DbSession) -> RosterChange:  # validated body
    course = _get_course(db, course_id)  # load or 404
    change = _add_to_roster(db, course, payload.student_numbers)  # add
    write_audit(db, actor=admin, action="course.students_added", entity="courses", entity_id=course.id, details=change.model_dump())  # audit
    db.commit()  # change + audit together
    return change  # summary


@router.delete("/{course_id}/students/{student_id}", status_code=status.HTTP_204_NO_CONTENT)  # remove one student from the roster
def remove_student(course_id: int, student_id: int, admin: AdminUser, db: DbSession) -> None:  # path IDs
    course = _get_course(db, course_id)  # load or 404
    link = db.get(CourseStudent, (course.id, student_id))  # roster row
    if link is None:  # not on it
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not_on_roster")  # stop
    db.delete(link)  # remove (attendance history stays)
    write_audit(db, actor=admin, action="course.student_removed", entity="courses", entity_id=course.id, details={"student_id": student_id})  # audit
    db.commit()  # change + audit together


def _bad_csv(row: int) -> JSONResponse:  # 400 with the offending row number
    return JSONResponse(status_code=status.HTTP_400_BAD_REQUEST, content={"detail": "bad_csv", "row": row})  # dashboard highlights the row


@router.post("/{course_id}/students/import", response_model=RosterImportOut)  # roster CSV upload (P2), all-or-nothing
async def import_students(course_id: int, file: UploadFile, admin: AdminUser, db: DbSession) -> RosterImportOut | JSONResponse:  # multipart file
    course = _get_course(db, course_id)  # load or 404
    try:  # bad encoding counts as a bad file
        text = (await file.read()).decode("utf-8-sig")  # strip an Excel BOM if present
    except UnicodeDecodeError:  # not UTF-8
        return _bad_csv(1)  # blame the first row
    reader = csv.reader(io.StringIO(text))  # parse
    rows = list(reader)  # all rows (roster files are small)
    if not rows or [h.strip().lower() for h in rows[0]] != ["student_number", "full_name"]:  # header must match exactly
        return _bad_csv(1)  # header row
    parsed: list[tuple[str, str]] = []  # validated rows
    for index, row in enumerate(rows[1:], start=2):  # row numbers as Excel shows them
        if not any(cell.strip() for cell in row):  # blank line
            continue  # ignore
        if len(row) != 2:  # wrong number of columns
            return _bad_csv(index)  # stop, import nothing
        number, name = row[0].strip(), row[1].strip()  # tidy
        if not STUDENT_NUMBER.match(number) or not 1 <= len(name) <= 120:  # invalid values
            return _bad_csv(index)  # stop, import nothing
        parsed.append((number, name))  # keep
    created: list[str] = []  # new student records
    for number, name in parsed:  # create missing students first
        if db.scalars(select(Student).where(Student.student_number == number)).first() is None and number not in created:  # not registered yet
            db.add(Student(student_number=number, full_name=name, biometric_consent=False, is_active=True))  # consent starts false
            created.append(number)  # report it
    db.flush()  # give new students IDs
    change = _add_to_roster(db, course, [n for n, _ in parsed])  # add everyone to the roster
    result = RosterImportOut(**change.model_dump(), created=created)  # summary
    write_audit(db, actor=admin, action="course.students_imported", entity="courses", entity_id=course.id, details=result.model_dump())  # audit
    db.commit()  # everything in one transaction
    return result  # summary
