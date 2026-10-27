from fastapi import HTTPException, status  # 404 errors
from sqlalchemy import select  # query builder
from sqlalchemy.orm import Session  # DB session type

from app.models import Course, CourseLecturer, LectureSession, Role, User  # tables involved in access checks


def lecturer_course_ids(db: Session, user: User) -> set[int] | None:  # which courses this user may see
    if user.role == Role.admin:  # admins see everything
        return None  # None = no restriction
    return set(db.scalars(select(CourseLecturer.course_id).where(CourseLecturer.user_id == user.id)))  # assigned courses only


def can_access_course(db: Session, user: User, course_id: int) -> bool:  # True if the user may see this course
    allowed = lecturer_course_ids(db, user)  # None = all
    return allowed is None or course_id in allowed  # admin or assigned lecturer


def get_course_for_user(db: Session, user: User, course_id: int) -> Course:  # load a course or 404
    course = db.get(Course, course_id)  # look it up
    if course is None or not can_access_course(db, user, course.id):  # missing or not theirs
        raise HTTPException(status.HTTP_404_NOT_FOUND, "course_not_found")  # 404, not 403: don't leak existence
    return course  # allowed


def get_session_for_user(db: Session, user: User, session_id: int) -> LectureSession:  # load a session or 404
    session = db.get(LectureSession, session_id)  # look it up
    if session is None or not can_access_course(db, user, session.course_id):  # missing or another lecturer's course
        raise HTTPException(status.HTTP_404_NOT_FOUND, "session_not_found")  # 404, not 403
    return session  # allowed
