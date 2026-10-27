import secrets
import time

from sqlalchemy import func, select

from app.db import SessionLocal
from app.models import Attendance, FingerprintSlot  # FingerprintSlot used to map slots directly


def mark(call, world, confidence=120, key=None, slot=1):  # slot param added for the roster test
    return call(
        "POST",
        "/device/attendance",
        {
            "idempotency_key": key or secrets.token_hex(16),
            "session_id": world["session_id"],
            "slot_number": slot,  # which sensor slot matched
            "confidence": confidence,
        },
    )


def rows() -> int:
    with SessionLocal() as db:
        return db.scalar(select(func.count()).select_from(Attendance))


def test_health(client):
    assert client.get("/health").status_code == 200


def test_wrong_secret_rejected(call):
    response = call("GET", "/device/session", secret="wrong" * 13)
    assert response.status_code == 401
    assert response.json()["detail"] == "bad_signature"


def test_reused_nonce_rejected(call):
    nonce = secrets.token_hex(16)
    assert call("GET", "/device/session", nonce=nonce).status_code == 200
    response = call("GET", "/device/session", nonce=nonce)
    assert response.status_code == 401
    assert response.json()["detail"] == "replayed_nonce"


def test_old_timestamp_rejected(call):
    response = call(
        "GET",
        "/device/session",
        timestamp=int(time.time()) - 3600,
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "stale_timestamp"


def test_no_consent_cannot_enrol(client, world, admin_headers):  # enrolment moved to the admin API (D3)
    response = client.post(f"/admin/students/{world['student_no']}/enrol", json={"device_id": world["device_id"]}, headers=admin_headers)  # enrolment is admin-initiated now (D3)
    assert response.status_code == 403  # forbidden
    assert response.json()["detail"] == "no_consent"  # POPIA guard


def test_enrol_then_mark_records_once(call, enrolled):  # uses the enrolled fixture instead of the removed endpoint
    world = enrolled  # slot 1 = student 111
    assert mark(call, world).json()["status"] == "recorded"
    assert rows() == 1


def test_retry_with_same_key_is_idempotent(call, enrolled):  # uses the enrolled fixture
    world = enrolled  # slot 1 = student 111
    key = secrets.token_hex(16)
    assert mark(call, world, key=key).json()["status"] == "recorded"
    assert mark(call, world, key=key).json()["status"] == "recorded"
    assert rows() == 1


def test_second_scan_is_duplicate(call, enrolled):  # uses the enrolled fixture
    world = enrolled  # slot 1 = student 111
    mark(call, world)
    assert mark(call, world).json()["status"] == "duplicate"
    assert rows() == 1


def test_low_confidence_not_recorded(call, enrolled):  # uses the enrolled fixture
    world = enrolled  # slot 1 = student 111
    assert mark(call, world, confidence=10).json()["status"] == "low_confidence"
    assert rows() == 0


def test_student_not_on_roster_is_rejected(call, world):  # D2: roster enforcement on the terminal
    with SessionLocal() as db:  # map slot 2 to student 333 (not on the roster)
        db.add(FingerprintSlot(device_id=world["device_id"], slot_number=2, student_id=world["student_off"]))  # direct mapping
        db.commit()  # save
    response = mark(call, world, slot=2)  # scan
    assert response.status_code == 200  # terminal still gets an answer
    assert response.json()["status"] == "not_in_course"  # D2
    assert rows() == 0  # nothing saved


def test_revoked_record_is_not_reactivated_by_scan(call, enrolled, client, lecturer_headers):  # revoke is final until a lecturer reinstates
    world = enrolled  # slot 1 = student 111
    assert mark(call, world).json()["status"] == "recorded"  # first scan saved
    with SessionLocal() as db:  # find the record
        attendance_id = db.scalar(select(Attendance.id))  # the only row
    assert client.post(f"/lecturer/attendance/{attendance_id}/revoke", json={"reason": "wrong person"}, headers=lecturer_headers).status_code == 200  # lecturer revokes it
    assert mark(call, world).json()["status"] == "duplicate"  # only the lecturer can reinstate
    with SessionLocal() as db:  # still revoked
        assert db.get(Attendance, attendance_id).revoked_at is not None  # revocation untouched by the scan
    assert rows() == 1  # still exactly one row
