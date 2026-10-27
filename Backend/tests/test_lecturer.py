import secrets  # idempotency keys
from datetime import datetime, timedelta, timezone  # late scans

from sqlalchemy import select  # DB assertions

from app.db import SessionLocal  # direct DB access
from app.models import Attendance, AuditLog, Course, Device, LectureSession  # tables checked


def actions() -> list[str]:  # every audit action so far
    with SessionLocal() as db:  # own session
        return list(db.scalars(select(AuditLog.action).order_by(AuditLog.id)))  # oldest first


def scan(call, session_id, slot=1, device_time=None):  # one fingerprint scan from the test terminal
    payload = {"idempotency_key": secrets.token_hex(16), "session_id": session_id, "slot_number": slot, "confidence": 120}  # scan body
    if device_time is not None:  # terminal clock time
        payload["device_time"] = device_time.isoformat()  # ISO with offset
    return call("POST", "/device/attendance", payload)  # raw response


def close_world_session(world):  # free the test device so a new session can be opened
    with SessionLocal() as db:  # own session
        db.get(LectureSession, world["session_id"]).closed_at = datetime.now(timezone.utc)  # closed
        db.commit()  # save


def test_course_visibility(client, world, lecturer_headers, other_lecturer_headers, admin_headers):  # lecturers see only their courses
    with SessionLocal() as db:  # a course nobody teaches
        db.add(Course(code="ZZ1000", name="Other"))  # unassigned
        db.commit()  # save
    assert [c["code"] for c in client.get("/lecturer/courses", headers=lecturer_headers).json()] == ["PD2316D"]  # only their own
    assert client.get("/lecturer/courses", headers=other_lecturer_headers).json() == []  # teaches nothing
    assert [c["code"] for c in client.get("/lecturer/courses", headers=admin_headers).json()] == ["PD2316D", "ZZ1000"]  # admin sees all


def test_open_session_and_device_busy(client, call, world, lecturer_headers):  # one open session per device
    body = {"course_id": world["course_id"], "device_id": world["device_id"], "venue": "Room 112"}  # same device as the world session
    busy = client.post("/lecturer/sessions", json=body, headers=lecturer_headers)  # try while busy
    assert busy.status_code == 409 and busy.json()["detail"] == "device_busy"  # refused
    devices = client.get("/lecturer/devices", headers=lecturer_headers).json()  # device picker
    assert devices[0]["busy"] is True  # shown as busy
    close_world_session(world)  # free the device
    opened = client.post("/lecturer/sessions", json=body, headers=lecturer_headers)  # try again
    assert opened.status_code == 201  # opened
    session = opened.json()  # session summary
    assert session["is_open"] and session["course_code"] == "PD2316D" and session["counts"] == {"roster": 2, "present": 0, "absent": 2}  # open, nobody present yet
    terminal = call("GET", "/device/session").json()  # what the terminal sees
    assert terminal["session_id"] == session["id"] and terminal["course_code"] == "PD2316D"  # the new session
    assert "session.opened" in actions()  # audited


def test_open_session_errors(client, world, lecturer_headers, admin_headers):  # each bad course/device gives its own error
    with SessionLocal() as db:  # an archived course + a revoked device
        db.add(Course(code="OLD1", name="Old", is_active=False))  # archived
        db.add(Device(name="t9", hmac_secret="z" * 64, is_active=False))  # revoked
        db.commit()  # save
        old_id = db.scalars(select(Course.id).where(Course.code == "OLD1")).one()  # its ID
        dead_id = db.scalars(select(Device.id).where(Device.name == "t9")).one()  # its ID
    def post(course_id, device_id):  # open helper (admin sees every course)
        return client.post("/lecturer/sessions", json={"course_id": course_id, "device_id": device_id, "venue": "X"}, headers=admin_headers).json()["detail"]  # error code
    assert post(old_id, world["device_id"]) == "course_inactive"  # archived course
    assert post(world["course_id"], 9999) == "device_not_found"  # unknown device
    assert post(world["course_id"], dead_id) == "device_inactive"  # revoked device
    assert post(9999, world["device_id"]) == "course_not_found"  # unknown course


def test_other_lecturer_gets_404(client, world, other_lecturer_headers):  # other lecturers' data looks missing
    body = {"course_id": world["course_id"], "device_id": world["device_id"], "venue": "X"}  # not their course
    response = client.post("/lecturer/sessions", json=body, headers=other_lecturer_headers)  # try to open a session
    assert response.status_code == 404 and response.json()["detail"] == "course_not_found"  # hidden
    response = client.get(f"/lecturer/sessions/{world['session_id']}", headers=other_lecturer_headers)  # try to view the session
    assert response.status_code == 404 and response.json()["detail"] == "session_not_found"  # hidden
    assert client.get(f"/lecturer/sessions/{world['session_id']}/attendance", headers=other_lecturer_headers).status_code == 404  # roster hidden too
    assert client.get("/lecturer/sessions", headers=other_lecturer_headers).json()["total"] == 0  # list is empty


def test_roster_view_after_scan(client, call, enrolled, lecturer_headers):  # a scan shows up on the roster
    world = enrolled  # slot 1 = student 111
    assert scan(call, world["session_id"]).json()["status"] == "recorded"  # 111 scans in
    view = client.get(f"/lecturer/sessions/{world['session_id']}/attendance", headers=lecturer_headers).json()  # lecturer's roster view
    assert view["session"]["counts"] == {"roster": 2, "present": 1, "absent": 1}  # one of two present
    assert [e["full_name"] for e in view["entries"]] == ["Has Consent", "No Consent"]  # sorted by name
    assert [e["status"] for e in view["entries"]] == ["present", "absent"]  # 111 present, 222 absent
    assert view["entries"][0]["method"] == "fingerprint" and view["entries"][0]["fp_confidence"] == 120  # scan details kept


def test_manual_mark(client, world, lecturer_headers):  # lecturer marks a student present by hand
    url = f"/lecturer/sessions/{world['session_id']}/manual"  # endpoint
    marked = client.post(url, json={"student_number": "222", "reason": "No biometric consent, ID checked"}, headers=lecturer_headers)  # mark 222
    assert marked.status_code == 201  # recorded
    entry = marked.json()  # the new entry
    assert entry["status"] == "present" and entry["method"] == "manual" and entry["note"] == "No biometric consent, ID checked" and entry["recorded_by_name"] == "Lee Lecturer"  # who, how and why
    again = client.post(url, json={"student_number": "222", "reason": "again"}, headers=lecturer_headers)  # mark twice
    assert again.status_code == 409 and again.json()["detail"] == "already_present"  # refused
    off = client.post(url, json={"student_number": "333", "reason": "not on roster"}, headers=lecturer_headers)  # student not in the course
    assert off.status_code == 400 and off.json()["detail"] == "not_in_course"  # refused
    unknown = client.post(url, json={"student_number": "000", "reason": "nobody"}, headers=lecturer_headers)  # no such student
    assert unknown.status_code == 404 and unknown.json()["detail"] == "unknown_student"  # not found
    assert client.post(url, json={"student_number": "222", "reason": "x"}, headers=lecturer_headers).status_code == 422  # reason too short
    assert "attendance.manual" in actions()  # audited


def test_revoke_and_reinstate(client, world, lecturer_headers, other_lecturer_headers):  # revoke keeps the row, re-marking restores it
    url = f"/lecturer/sessions/{world['session_id']}/manual"  # endpoint
    attendance_id = client.post(url, json={"student_number": "222", "reason": "ID checked"}, headers=lecturer_headers).json()["attendance_id"]  # mark 222 present
    hidden = client.post(f"/lecturer/attendance/{attendance_id}/revoke", json={"reason": "wrong student"}, headers=other_lecturer_headers)  # other lecturer tries to revoke
    assert hidden.status_code == 404 and hidden.json()["detail"] == "attendance_not_found"  # not their course
    revoked = client.post(f"/lecturer/attendance/{attendance_id}/revoke", json={"reason": "wrong student"}, headers=lecturer_headers)  # owner revokes
    assert revoked.status_code == 200 and revoked.json()["status"] == "revoked" and revoked.json()["revoke_reason"] == "wrong student"  # revoked with reason
    with SessionLocal() as db:  # row still exists
        assert db.get(Attendance, attendance_id) is not None  # soft revoke, not a delete
    again = client.post(f"/lecturer/attendance/{attendance_id}/revoke", json={"reason": "again"}, headers=lecturer_headers)  # revoke twice
    assert again.status_code == 409 and again.json()["detail"] == "already_revoked"  # refused
    reinstated = client.post(url, json={"student_number": "222", "reason": "confirmed present"}, headers=lecturer_headers)  # mark again
    assert reinstated.status_code == 201 and reinstated.json()["attendance_id"] == attendance_id and reinstated.json()["status"] == "present"  # same row, present again
    assert {"attendance.revoked", "attendance.reinstated"} <= set(actions())  # both audited


def test_close_session(client, call, enrolled, lecturer_headers):  # closing stops further scans
    world = enrolled  # slot 1 = student 111
    closed = client.post(f"/lecturer/sessions/{world['session_id']}/close", headers=lecturer_headers)  # close it
    assert closed.status_code == 200 and closed.json()["is_open"] is False  # closed
    again = client.post(f"/lecturer/sessions/{world['session_id']}/close", headers=lecturer_headers)  # close twice
    assert again.status_code == 409 and again.json()["detail"] == "session_already_closed"  # refused
    late = scan(call, world["session_id"], device_time=datetime.now(timezone.utc) + timedelta(minutes=1))  # scan after closing
    assert late.status_code == 409 and late.json()["detail"] == "session_closed"  # refused
    assert "session.closed" in actions()  # audited


def test_csv_export(client, call, enrolled, lecturer_headers):  # roster downloads as a CSV
    world = enrolled  # slot 1 = student 111
    scan(call, world["session_id"])  # 111 present
    response = client.get(f"/lecturer/sessions/{world['session_id']}/export.csv", headers=lecturer_headers)  # download it
    assert response.status_code == 200 and response.headers["content-type"].startswith("text/csv")  # a CSV file
    assert response.content.startswith(b"\xef\xbb\xbf")  # UTF-8 BOM
    assert response.headers["content-disposition"].startswith('attachment; filename="attendance_PD2316D_')  # download with the spec filename
    assert response.headers["content-disposition"].endswith(f'_session{world["session_id"]}.csv"')  # ...ending in the session ID
    lines = response.content.decode("utf-8-sig").splitlines()  # strip the BOM, split rows
    assert lines[0] == "student_number,full_name,status,method,recorded_at,device_time,note,revoked_reason"  # header row
    assert len(lines) == 3  # header + one per roster student
    assert lines[1].startswith("111,Has Consent,present,fingerprint,") and "+02:00" in lines[1]  # Johannesburg offset
    assert lines[2].startswith("222,No Consent,absent,")  # absent student listed too
    assert "attendance.exported" in actions()  # audited


def test_course_report(client, call, enrolled, lecturer_headers):  # per-student attendance percentages
    world = enrolled  # slot 1 = student 111
    scan(call, world["session_id"])  # 111 present
    client.post(f"/lecturer/sessions/{world['session_id']}/close", headers=lecturer_headers)  # counts only closed sessions
    report = client.get(f"/lecturer/courses/{world['course_id']}/report", headers=lecturer_headers).json()  # fetch the report
    assert report["closed_sessions"] == 1  # one session counted
    assert {r["student_number"]: r["percentage"] for r in report["students"]} == {"111": 100.0, "222": 0.0}  # 111 always, 222 never


def test_list_sessions_filters(client, world, lecturer_headers):  # session list filters work
    page = client.get("/lecturer/sessions", params={"open_only": True}, headers=lecturer_headers).json()  # open sessions only
    assert page["total"] == 1 and page["items"][0]["lecturer_name"] == "Lee Lecturer"  # the world session
    close_world_session(world)  # close it
    assert client.get("/lecturer/sessions", params={"open_only": True}, headers=lecturer_headers).json()["total"] == 0  # none open now
    assert client.get("/lecturer/sessions", params={"course_id": world["course_id"]}, headers=lecturer_headers).json()["total"] == 1  # still listed by course
