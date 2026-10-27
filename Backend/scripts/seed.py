import secrets  # secure random device secret
from datetime import datetime, timezone  # consent timestamp

from pwdlib import PasswordHash  # argon2 password hashing
from sqlalchemy import select  # query builder

from app.db import SessionLocal  # direct DB session (no FastAPI here)
from app.models import Course, CourseLecturer, CourseStudent, Device, LectureSession, Role, Student, User  # tables we fill

LECTURER_EMAIL = "lecturer@tut.ac.za"  # demo login (no .local: EmailStr rejects special-use domains)
LECTURER_PASSWORD = "ChangeMe123"  # dev only
ADMIN_EMAIL = "admin@tut.ac.za"  # demo admin login (same dev password)
DEVICE_NAME = "terminal-01"  # your ESP32
COURSE_CODE = "PD2316D"  # demo course
COURSE_NAME = "Project Design III"  # its display name
STUDENTS = [  # edit: test volunteers who agreed to take part
    ("220000001", "Test Student One"),  # (student_number, full_name)
    ("220000002", "Test Student Two"),  # add as many as you need
]
NO_CONSENT_STUDENTS = [("220000003", "Test Student Three")]  # no biometric consent: demos the manual fallback


def main() -> None:  # get-or-create everything, so it's safe to run many times
    with SessionLocal() as db:  # one session for the whole script
        lecturer = db.scalars(select(User).where(User.email == LECTURER_EMAIL)).first()  # existing lecturer?
        if lecturer is None:  # first run
            lecturer = User(email=LECTURER_EMAIL, full_name="Demo Lecturer", password_hash=PasswordHash.recommended().hash(LECTURER_PASSWORD), role=Role.lecturer)  # hashed, never plain
            db.add(lecturer)  # queue insert
        if db.scalars(select(User).where(User.email == ADMIN_EMAIL)).first() is None:  # no admin yet
            db.add(User(email=ADMIN_EMAIL, full_name="Demo Admin", password_hash=PasswordHash.recommended().hash(LECTURER_PASSWORD), role=Role.admin))  # hashed, never plain
        device = db.scalars(select(Device).where(Device.name == DEVICE_NAME)).first()  # existing terminal?
        if device is None:  # first run
            device = Device(name=DEVICE_NAME, hmac_secret=secrets.token_hex(32))  # 64-char random shared secret
            db.add(device)  # queue insert
        course = db.scalars(select(Course).where(Course.code == COURSE_CODE)).first()  # existing course (maybe from the migration backfill)?
        if course is None:  # first run
            course = Course(code=COURSE_CODE, name=COURSE_NAME)  # create it
            db.add(course)  # queue insert
        elif course.name == course.code:  # backfill used the code as a placeholder name
            course.name = COURSE_NAME  # give it the real name
        for number, name in STUDENTS:  # each demo student
            if db.scalars(select(Student).where(Student.student_number == number)).first() is None:  # not there yet
                db.add(Student(student_number=number, full_name=name, biometric_consent=True, consent_at=datetime.now(timezone.utc)))  # consent recorded
        for number, name in NO_CONSENT_STUDENTS:  # students without consent
            if db.scalars(select(Student).where(Student.student_number == number)).first() is None:  # not there yet
                db.add(Student(student_number=number, full_name=name, biometric_consent=False))  # manual attendance only
        db.flush()  # sends inserts so lecturer.id and device.id exist
        if db.get(CourseLecturer, (course.id, lecturer.id)) is None:  # lecturer not assigned yet
            db.add(CourseLecturer(course_id=course.id, user_id=lecturer.id))  # assign to the course
        for number, _ in STUDENTS + NO_CONSENT_STUDENTS:  # every demo student
            student = db.scalars(select(Student).where(Student.student_number == number)).first()  # the student row
            if db.get(CourseStudent, (course.id, student.id)) is None:  # not on the roster yet
                db.add(CourseStudent(course_id=course.id, student_id=student.id))  # add to the class list
        session = db.scalars(select(LectureSession).where(LectureSession.device_id == device.id, LectureSession.closed_at.is_(None))).first()  # open session?
        if session is None:  # none open
            session = LectureSession(course_id=course.id, venue="Lab 1", lecturer_id=lecturer.id, device_id=device.id)  # open one for testing
            db.add(session)  # queue insert
        db.commit()  # save everything
        print(f"ADMIN_LOGIN={ADMIN_EMAIL} / {LECTURER_PASSWORD}")  # dashboard admin login (dev only)
        print(f"LECTURER_LOGIN={LECTURER_EMAIL} / {LECTURER_PASSWORD}")  # dashboard lecturer login (dev only)
        print(f"DEVICE_ID={device.id}")  # put this in the ESP32 config
        print(f"DEVICE_SECRET={device.hmac_secret}")  # and this (keep it private)
        print(f"SESSION_ID={session.id}  ({session.course.code}, {session.venue})")  # the open session


if __name__ == "__main__":  # only when run directly
    main()  # do it
