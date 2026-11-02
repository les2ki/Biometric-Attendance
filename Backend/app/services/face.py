import os  # settings from the environment
import threading  # load the models once, safely
import urllib.request  # download the models if missing
from datetime import datetime, timedelta, timezone  # deadlines
from pathlib import Path  # model file paths

import numpy as np  # picture bytes -> array
from fastapi import HTTPException, status  # validation errors
from sqlalchemy import func, select  # query builder
from sqlalchemy.exc import IntegrityError  # duplicate attendance race
from sqlalchemy.orm import Session  # DB session type

from app.config import settings  # command_ttl_minutes
from app.models import Attendance, CommandStatus, CommandType, CourseStudent, Device, DeviceCommand, FaceTemplate, LectureSession, Method, Student, User  # tables used here
from app.services.audit import write_audit  # audit trail
from app.services.commands import OPEN_STATUSES, expire_stale  # shared command helpers

FRAME_W, FRAME_H = 320, 240  # picture size the terminal sends (QVGA greyscale)
FRAME_LEN = FRAME_W * FRAME_H  # 76 800 bytes, one per pixel
MATCH_THRESHOLD = float(os.getenv("face_match_threshold", "0.363"))  # cosine similarity needed for a match (OpenCV's SFace default; tune on Render)
MIN_FACE_PX = int(os.getenv("face_min_size", "50"))  # smaller faces are too far away to trust
MODELS_DIR = Path(__file__).resolve().parents[2] / "models"  # Backend/models (git-ignored, downloaded)
MODELS = {  # file name -> download address (OpenCV model zoo)
    "face_detection_yunet_2023mar.onnx": "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",  # face finder (~0.2 MB)
    "face_recognition_sface_2021dec.onnx": "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx",  # face -> 128 numbers (~37 MB)
}

_lock = threading.Lock()  # one loader at a time
_detector = None  # cv2.FaceDetectorYN, created once
_recognizer = None  # cv2.FaceRecognizerSF, created once


def _now() -> datetime:  # one place for "now"
    return datetime.now(timezone.utc)  # always timezone-aware UTC


def face_counts(db: Session, student_ids: list[int]) -> dict[int, int]:  # count enrolled face templates per student
    if not student_ids:  # avoid an empty IN clause
        return {}
    rows = db.execute(
        select(FaceTemplate.student_id, func.count())
        .where(FaceTemplate.student_id.in_(student_ids))
        .group_by(FaceTemplate.student_id)
    ).tuples().all()
    return dict(rows)


def download_models() -> None:  # fetch any missing model file (build step, start-up thread, or first use)
    MODELS_DIR.mkdir(parents=True, exist_ok=True)  # make the folder
    for name, url in MODELS.items():  # each model
        path = MODELS_DIR / name  # where it goes
        if path.exists() and path.stat().st_size > 100_000:  # already there (a tiny file would be a failed download)
            continue  # skip
        tmp = path.with_suffix(".part")  # download to a temp name first
        urllib.request.urlretrieve(url, tmp)  # follows GitHub's redirect to the real file
        tmp.replace(path)  # only now is it "there"


def _models():  # the detector and recognizer, loaded on first use
    global _detector, _recognizer  # module-level cache
    with _lock:  # only one thread loads
        if _detector is None or _recognizer is None:  # not loaded yet
            import cv2  # imported here so the rest of the API starts even if OpenCV is missing
            try:  # download can fail (no network)
                download_models()  # make sure the files exist
            except Exception as exc:  # report as 503
                raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "face_models_missing") from exc  # terminal shows the error
            _detector = cv2.FaceDetectorYN.create(str(MODELS_DIR / "face_detection_yunet_2023mar.onnx"), "", (FRAME_W, FRAME_H), 0.7, 0.3, 50)  # score 0.7, NMS 0.3, max 50 faces
            _recognizer = cv2.FaceRecognizerSF.create(str(MODELS_DIR / "face_recognition_sface_2021dec.onnx"), "")  # 128-number embeddings
    return _detector, _recognizer  # ready


def preload() -> None:  # called in a background thread at start-up so the first picture isn't slow
    try:  # never crash the API because of this
        _models()  # download + load
    except Exception as exc:  # e.g. no network yet
        print(f"face models not loaded yet: {exc}")  # first real request will try again


def analyse(raw: bytes) -> tuple[str, np.ndarray | None]:  # picture -> ("ok", embedding) or (problem, None)
    import cv2  # OpenCV
    detector, recognizer = _models()  # loaded models
    grey = np.frombuffer(raw, dtype=np.uint8).reshape(FRAME_H, FRAME_W)  # 240 rows x 320 columns
    bgr = cv2.cvtColor(grey, cv2.COLOR_GRAY2BGR)  # the models expect 3 channels
    detector.setInputSize((FRAME_W, FRAME_H))  # picture size
    _, faces = detector.detect(bgr)  # each row: x, y, w, h, 10 landmark numbers, score
    if faces is None or len(faces) == 0:  # nobody found
        return "no_face", None  # ask for a retake
    faces = sorted(faces, key=lambda f: f[2] * f[3], reverse=True)  # biggest face first
    if len(faces) > 1 and faces[1][2] * faces[1][3] >= 0.5 * faces[0][2] * faces[0][3]:  # a second face nearly as big
        return "multiple_faces", None  # one person at a time
    face = faces[0]  # the student
    if face[2] < MIN_FACE_PX:  # face too small (too far away)
        return "poor_quality", None  # ask them to come closer
    aligned = recognizer.alignCrop(bgr, face)  # straighten and crop the face
    feature = recognizer.feature(aligned).astype(np.float32).copy()  # 1 x 128 numbers
    return "ok", feature  # usable


def similarity(a: np.ndarray, b: np.ndarray) -> float:  # cosine similarity, 1.0 = identical
    import cv2  # OpenCV
    _, recognizer = _models()  # loaded models
    return float(recognizer.match(a, b, cv2.FaceRecognizerSF_FR_COSINE))  # SFace's own comparison


def queue_face(db: Session, *, kind: CommandType, student: Student | None, device: Device | None, user: User, session: LectureSession | None = None) -> DeviceCommand:  # dashboard asks a terminal for a face picture
    if student is None:  # bad student
        raise HTTPException(status.HTTP_404_NOT_FOUND, "student_not_found")  # stop
    if device is None:  # bad device
        raise HTTPException(status.HTTP_404_NOT_FOUND, "device_not_found")  # stop
    if not student.is_active:  # deactivated
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "student_inactive")  # stop
    if not device.is_active:  # revoked terminal
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "device_inactive")  # stop
    if not student.biometric_consent:  # POPIA: no consent, no biometrics
        raise HTTPException(status.HTTP_403_FORBIDDEN, "no_consent")  # use the manual fallback
    if kind == CommandType.face_verify and db.scalars(select(FaceTemplate).where(FaceTemplate.student_id == student.id)).first() is None:  # nothing to compare with
        raise HTTPException(status.HTTP_409_CONFLICT, "face_not_enrolled")  # enrol the face first
    now = _now()  # one timestamp
    expire_stale(db, device.id, now)  # old commands shouldn't block this one
    pending = db.scalars(select(DeviceCommand).where(DeviceCommand.device_id == device.id, DeviceCommand.student_id == student.id, DeviceCommand.type.in_((CommandType.face_enrol, CommandType.face_verify)), DeviceCommand.status.in_(OPEN_STATUSES))).first()  # already waiting?
    if pending is not None:  # one at a time per student and terminal
        raise HTTPException(status.HTTP_409_CONFLICT, "face_pending")  # stop
    cmd = DeviceCommand(  # the face command
        device_id=device.id,  # target terminal
        type=kind,  # face_enrol / face_verify
        status=CommandStatus.pending,  # waiting for the terminal
        slot_number=0,  # faces don't use sensor slots
        student_id=student.id,  # who
        requested_by_user_id=user.id,  # admin or lecturer
        session_id=session.id if session is not None else None,  # lecturer verify: mark present here on a match
        expires_at=now + timedelta(minutes=settings.command_ttl_minutes),  # times out like enrolments
    )
    db.add(cmd)  # queue
    db.flush()  # get cmd.id
    write_audit(db, actor=user, action="face.enrol_requested" if kind == CommandType.face_enrol else "face.verify_requested", entity="students", entity_id=student.id, details={"device_id": device.id, "command_id": cmd.id, "session_id": cmd.session_id})  # audit
    return cmd  # caller commits


def handle_frame(db: Session, *, device: Device, command_id: int, raw: bytes) -> dict:  # terminal uploaded a picture for a face command
    cmd = db.get(DeviceCommand, command_id)  # the command
    if cmd is None or cmd.device_id != device.id:  # missing or another terminal's
        raise HTTPException(status.HTTP_404_NOT_FOUND, "unknown_command")  # stop
    if cmd.type not in (CommandType.face_enrol, CommandType.face_verify):  # fingerprint command
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "not_a_face_command")  # stop
    if cmd.status != CommandStatus.in_progress:  # expired, cancelled or finished
        raise HTTPException(status.HTTP_409_CONFLICT, "command_not_active")  # terminal stops
    if len(raw) != FRAME_LEN:  # wrong size
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "bad_frame_length")  # terminal retakes
    student = db.get(Student, cmd.student_id) if cmd.student_id is not None else None  # who
    if student is None or not student.is_active or not student.biometric_consent:  # consent withdrawn meanwhile
        raise HTTPException(status.HTTP_409_CONFLICT, "command_not_active")  # don't process biometrics
    result, feature = analyse(raw)  # find the face, make the template
    out = {"status": result, "full_name": student.full_name, "score": None, "attendance": None}  # reply for the terminal
    if result != "ok":  # no usable face: the picture is thrown away
        return out  # terminal retakes
    actor = db.get(User, cmd.requested_by_user_id) if cmd.requested_by_user_id is not None else None  # who asked
    if cmd.type == CommandType.face_enrol:  # store the template
        row = db.scalars(select(FaceTemplate).where(FaceTemplate.student_id == student.id)).first()  # existing one?
        if row is None:  # first enrolment
            db.add(FaceTemplate(student_id=student.id, embedding=feature.tobytes()))  # save
        else:  # re-enrolment replaces it
            row.embedding = feature.tobytes()  # overwrite
            row.created_at = _now()  # new date
        write_audit(db, actor=actor, action="face.enrolled", entity="students", entity_id=student.id, details={"device_id": device.id, "command_id": cmd.id})  # audit
        db.commit()  # save
        return out  # status ok
    row = db.scalars(select(FaceTemplate).where(FaceTemplate.student_id == student.id)).first()  # stored template
    if row is None:  # deleted since queueing
        out["status"] = "face_not_enrolled"  # tell the terminal
        return out  # stop
    score = similarity(np.frombuffer(row.embedding, dtype=np.float32).reshape(1, -1), feature)  # compare
    out["score"] = round(score, 3)  # for the log / tuning
    if score < MATCH_THRESHOLD:  # not the same person
        out["status"] = "no_match"  # reject
        write_audit(db, actor=actor, action="face.verify_failed", entity="students", entity_id=student.id, details={"device_id": device.id, "command_id": cmd.id, "score": out["score"]})  # audit
        db.commit()  # save
        return out  # terminal shows "does not match"
    write_audit(db, actor=actor, action="face.verified", entity="students", entity_id=student.id, details={"device_id": device.id, "command_id": cmd.id, "score": out["score"], "session_id": cmd.session_id})  # audit
    if cmd.session_id is not None:  # lecturer verify: mark present
        out["attendance"] = _mark_present(db, session_id=cmd.session_id, student=student, device=device, score=score, actor=actor)  # recorded / already_present / ...
    db.commit()  # save everything
    return out  # status ok


def _mark_present(db: Session, *, session_id: int, student: Student, device: Device, score: float, actor: User | None) -> str:  # face-verified attendance
    session = db.get(LectureSession, session_id)  # the session
    if session is None:  # deleted
        return "unknown_session"  # nothing to do
    if db.get(CourseStudent, (session.course_id, student.id)) is None:  # not on the class list
        return "not_in_course"  # nothing saved
    existing = db.scalars(select(Attendance).where(Attendance.student_id == student.id, Attendance.session_id == session.id)).first()  # already a row?
    if existing is not None:  # present, or revoked (only the lecturer reinstates)
        return "already_present" if existing.revoked_at is None else "revoked"  # nothing new
    try:  # unique constraint is the final guard
        with db.begin_nested():  # savepoint
            db.add(Attendance(session_id=session.id, student_id=student.id, device_id=device.id, method=Method.face, recorded_by_user_id=actor.id if actor else None, note=f"Face verified (score {score:.2f})"))  # the record
    except IntegrityError:  # raced with a fingerprint scan
        return "already_present"  # fine
    write_audit(db, actor=actor, action="attendance.face", entity="attendance", entity_id=f"{session.id}:{student.id}", details={"score": round(score, 3)})  # audit
    return "recorded"  # present
