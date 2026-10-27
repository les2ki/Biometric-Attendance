import json  # signed device request
import secrets  # nonces
import time  # timestamps

from sqlalchemy import select  # DB assertions

from app.db import SessionLocal  # direct DB access
from app.models import AuditLog, CommandType, DeviceCommand, FingerprintSlot, Student  # tables checked
from app.security import compute_signature  # sign as a new device


def actions() -> list[str]:  # every audit action so far
    with SessionLocal() as db:  # own session
        return list(db.scalars(select(AuditLog.action).order_by(AuditLog.id)))  # oldest first


def test_create_user(client, admin_headers):  # admin creates a lecturer account
    body = {"email": "New.Lecturer@TUT.ac.za", "full_name": "New Lecturer", "role": "lecturer", "password": "Passw0rd!"}  # mixed-case email
    response = client.post("/admin/users", json=body, headers=admin_headers)  # create it
    assert response.status_code == 201  # created
    assert response.json()["email"] == "new.lecturer@tut.ac.za" and "password_hash" not in response.json()  # email lower-cased, hash hidden
    duplicate = client.post("/admin/users", json=body, headers=admin_headers)  # same email again
    assert duplicate.status_code == 409 and duplicate.json()["detail"] == "email_taken"  # duplicate rejected
    listed = client.get("/admin/users", params={"role": "lecturer"}, headers=admin_headers).json()  # list lecturers
    assert listed["total"] == 1 and all("password_hash" not in u for u in listed["items"])  # one lecturer, no hashes
    assert "user.created" in actions()  # audited


def test_create_student(client, admin_headers):  # admin adds a student
    assert client.post("/admin/students", json={"student_number": "12ab", "full_name": "Bad"}, headers=admin_headers).status_code == 422  # non-digit number rejected
    response = client.post("/admin/students", json={"student_number": "220000009", "full_name": "Nine"}, headers=admin_headers)  # valid student
    assert response.status_code == 201 and response.json()["biometric_consent"] is False  # created without consent
    duplicate = client.post("/admin/students", json={"student_number": "220000009", "full_name": "Nine"}, headers=admin_headers)  # same number again
    assert duplicate.status_code == 409 and duplicate.json()["detail"] == "student_number_taken"  # duplicate rejected
    assert client.get("/admin/students", params={"search": "Nine"}, headers=admin_headers).json()["total"] == 1  # search finds it


def test_consent_grant_and_withdrawal(client, enrolled, admin_headers):  # consent changes are saved and audited
    world = enrolled  # 111 has slot 1
    granted = client.put(f"/admin/students/{world['student_no']}/consent", json={"consent": True}, headers=admin_headers)  # grant for 222
    assert granted.json()["biometric_consent"] is True and granted.json()["consent_at"] is not None  # granted with a time
    withdrawn = client.put(f"/admin/students/{world['student_yes']}/consent", json={"consent": False}, headers=admin_headers)  # withdraw for 111
    assert withdrawn.json()["consent_at"] is None and withdrawn.json()["enrolled_device_ids"] == []  # time cleared, no devices left
    with SessionLocal() as db:  # DB state
        assert db.scalars(select(FingerprintSlot)).first() is None  # mapping gone
        wipe = db.scalars(select(DeviceCommand)).one()  # one wipe queued
        assert wipe.type == CommandType.delete_slot and wipe.slot_number == 1  # wipe slot 1
    assert {"consent.granted", "consent.withdrawn", "fingerprint.deleted"} <= set(actions())  # all audited


def test_enrol_without_consent(client, world, admin_headers):  # no consent, no enrolment
    response = client.post(f"/admin/students/{world['student_no']}/enrol", json={"device_id": world["device_id"]}, headers=admin_headers)  # 222 has no consent
    assert response.status_code == 403 and response.json()["detail"] == "no_consent"  # refused
    missing = client.post("/admin/students/99999/enrol", json={"device_id": world["device_id"]}, headers=admin_headers)  # unknown student
    assert missing.status_code == 404 and missing.json()["detail"] == "student_not_found"  # not found


def test_student_detail(client, enrolled, admin_headers):  # detail view shows courses and slots
    detail = client.get(f"/admin/students/{enrolled['student_yes']}", headers=admin_headers).json()  # fetch 111
    assert detail["courses"][0]["code"] == "PD2316D"  # their course
    assert detail["fingerprint_slots"] == [{"device_id": enrolled["device_id"], "device_name": "t1", "slot_number": 1}]  # their slot
    assert detail["enrolled_device_ids"] == [enrolled["device_id"]] and detail["open_commands"] == []  # enrolled, nothing pending


def test_courses_and_rosters(client, world, admin_headers, lecturer_user, admin_user):  # course setup, lecturers and roster edits
    created = client.post("/admin/courses", json={"code": " ab1234c ", "name": "Algorithms"}, headers=admin_headers)  # messy code
    assert created.status_code == 201 and created.json()["code"] == "AB1234C"  # trimmed and upper-cased
    course_id = created.json()["id"]  # its ID
    assert client.post("/admin/courses", json={"code": "AB1234C", "name": "x"}, headers=admin_headers).json()["detail"] == "course_code_taken"  # duplicate rejected
    bad = client.put(f"/admin/courses/{course_id}/lecturers", json={"user_ids": [admin_user["id"]]}, headers=admin_headers)  # assign an admin
    assert bad.status_code == 400 and bad.json()["detail"] == "not_a_lecturer"  # refused
    detail = client.put(f"/admin/courses/{course_id}/lecturers", json={"user_ids": [lecturer_user["id"]]}, headers=admin_headers).json()  # assign the lecturer
    assert [u["id"] for u in detail["lecturers"]] == [lecturer_user["id"]] and detail["lecturer_count"] == 1  # one lecturer set
    added = client.post(f"/admin/courses/{course_id}/students", json={"student_numbers": ["111", "222", "999"]}, headers=admin_headers).json()  # 999 does not exist
    assert added == {"added": ["111", "222"], "already_present": [], "unknown": ["999"]}  # sorted into buckets
    again = client.post(f"/admin/courses/{course_id}/students", json={"student_numbers": ["111"]}, headers=admin_headers).json()  # add 111 twice
    assert again["already_present"] == ["111"]  # not added twice
    assert client.delete(f"/admin/courses/{course_id}/students/{world['student_yes']}", headers=admin_headers).status_code == 204  # remove 111
    gone = client.delete(f"/admin/courses/{course_id}/students/{world['student_yes']}", headers=admin_headers)  # remove again
    assert gone.status_code == 404 and gone.json()["detail"] == "not_on_roster"  # already gone
    assert client.get(f"/admin/courses/{course_id}", headers=admin_headers).json()["student_count"] == 1  # only 222 left
    assert {"course.created", "course.lecturers_set", "course.students_added", "course.student_removed"} <= set(actions())  # all audited


def test_devices(client, admin_headers):  # device register, heartbeat, rotate, revoke
    created = client.post("/admin/devices", json={"name": "terminal-09"}, headers=admin_headers)  # register a terminal
    assert created.status_code == 201  # created
    device = created.json()  # includes the secret
    assert len(device["hmac_secret"]) == 64 and device["online"] is False  # 64-char secret, not seen yet
    assert client.post("/admin/devices", json={"name": "terminal-09"}, headers=admin_headers).json()["detail"] == "device_name_taken"  # duplicate rejected
    listed = client.get("/admin/devices", headers=admin_headers).json()  # list devices
    assert all("hmac_secret" not in d for d in listed)  # secret only on create/rotate
    body, timestamp, nonce = b"", int(time.time()), secrets.token_hex(16)  # signed device call
    headers = {"X-Device-Id": str(device["id"]), "X-Timestamp": str(timestamp), "X-Nonce": nonce, "X-Signature": compute_signature(device["hmac_secret"], "GET", "/device/session", timestamp, nonce, body)}  # auth headers
    assert client.get("/device/session", headers=headers).status_code == 404  # no session, but authenticated
    listed = client.get("/admin/devices", headers=admin_headers).json()  # list again
    assert listed[0]["online"] is True and listed[0]["last_seen_at"] is not None  # now online
    with SessionLocal() as db:  # secret never in the audit trail
        assert device["hmac_secret"] not in json.dumps([a.details for a in db.scalars(select(AuditLog))])  # not logged anywhere
    rotated = client.post(f"/admin/devices/{device['id']}/rotate-secret", headers=admin_headers).json()  # new secret
    assert rotated["hmac_secret"] != device["hmac_secret"]  # actually changed
    off = client.patch(f"/admin/devices/{device['id']}", json={"is_active": False}, headers=admin_headers)  # revoke it
    assert off.json()["is_active"] is False  # revoked


def test_device_commands_list(client, world, admin_headers):  # admin sees a device's queue
    client.post(f"/admin/students/{world['student_yes']}/enrol", json={"device_id": world["device_id"]}, headers=admin_headers)  # queue one enrol
    page = client.get(f"/admin/devices/{world['device_id']}/commands", params={"status": "pending"}, headers=admin_headers).json()  # pending commands
    assert page["total"] == 1 and page["items"][0]["student_number"] == "111"  # the enrol for 111
    assert client.get("/admin/devices/9999/commands", headers=admin_headers).status_code == 404  # unknown device


def test_audit_list(client, admin_headers):  # audit log is listed, filtered and read-only
    client.post("/admin/courses", json={"code": "C1", "name": "One"}, headers=admin_headers)  # audited action 1
    client.post("/admin/students", json={"student_number": "220000010", "full_name": "Ten"}, headers=admin_headers)  # audited action 2
    page = client.get("/admin/audit", headers=admin_headers).json()  # read the log
    assert [a["action"] for a in page["items"]][:2] == ["student.created", "course.created"]  # newest first
    assert page["items"][0]["actor_name"] == "Ada Admin"  # who did it
    filtered = client.get("/admin/audit", params={"action": "course."}, headers=admin_headers).json()  # prefix filter
    assert filtered["total"] == 1 and filtered["items"][0]["action"] == "course.created"  # only course actions
    for method in ("PUT", "PATCH", "DELETE"):  # append-only: no write routes
        assert client.request(method, "/admin/audit", headers=admin_headers).status_code == 405  # method not allowed


def test_user_guards(client, admin_user, admin_headers, lecturer_user):  # admins cannot lock themselves out
    own = client.patch(f"/admin/users/{admin_user['id']}", json={"role": "lecturer"}, headers=admin_headers)  # demote self
    assert own.status_code == 400 and own.json()["detail"] == "cannot_modify_self"  # refused
    own = client.patch(f"/admin/users/{admin_user['id']}", json={"is_active": False}, headers=admin_headers)  # deactivate self
    assert own.status_code == 400 and own.json()["detail"] == "cannot_modify_self"  # refused
    assert client.patch(f"/admin/users/{admin_user['id']}", json={"full_name": "Ada A."}, headers=admin_headers).status_code == 200  # own name is fine
    second = client.post("/admin/users", json={"email": "admin2@tut.ac.za", "full_name": "Second", "role": "admin", "password": "Passw0rd!"}, headers=admin_headers).json()  # a second admin
    updated = client.patch(f"/admin/users/{second['id']}", json={"is_active": False}, headers=admin_headers)  # deactivate them
    assert updated.status_code == 200 and updated.json()["is_active"] is False  # another admin remains
    missing = client.patch("/admin/users/99999", json={"is_active": False}, headers=admin_headers)  # unknown user
    assert missing.status_code == 404 and missing.json()["detail"] == "user_not_found"  # not found
    assert client.post(f"/admin/users/{lecturer_user['id']}/reset-password", json={"new_password": "Another1!"}, headers=admin_headers).status_code == 204  # admin resets a password
    assert client.post("/auth/login", data={"username": lecturer_user["email"], "password": "Another1!"}).status_code == 200  # new password works
    assert {"user.updated", "user.password_reset"} <= set(actions())  # audited


def test_last_admin_guard():  # last_admin is defence in depth: via the API, cannot_modify_self always fires first
    from fastapi import HTTPException  # expected error type
    from app.models import Role, User  # accounts
    from app.routers.admin_users import update_user  # call the endpoint function directly
    from app.schemas.admin import UserUpdate  # its body
    with SessionLocal() as db:  # one admin + a pretend caller that is not an admin row
        only = User(email="only@tut.ac.za", full_name="Only", password_hash="x", role=Role.admin)  # the last active admin
        db.add(only)  # queue insert
        db.commit()  # save
        caller = User(id=-1, email="sys@tut.ac.za", full_name="System", password_hash="x", role=Role.admin)  # transient caller (not in the DB)
        try:  # demoting the last admin must fail
            update_user(only.id, UserUpdate(role=Role.lecturer), caller, db)  # direct call
            raise AssertionError("expected last_admin")  # should not get here
        except HTTPException as error:  # the guard
            assert error.status_code == 400 and error.detail == "last_admin"  # refused as last admin


def test_csv_import_all_or_nothing(client, world, admin_headers):  # one bad row rejects the whole file
    bad = "student_number,full_name\n220000020,Twenty\nabc,Broken\n"  # row 3 invalid
    response = client.post(f"/admin/courses/{world['course_id']}/students/import", files={"file": ("roster.csv", bad, "text/csv")}, headers=admin_headers)  # upload it
    assert response.status_code == 400 and response.json() == {"detail": "bad_csv", "row": 3}  # names the bad row
    with SessionLocal() as db:  # nothing imported
        assert db.scalars(select(Student).where(Student.student_number == "220000020")).first() is None  # valid row not saved either
    client.post("/admin/students", json={"student_number": "220000021", "full_name": "Twenty One"}, headers=admin_headers)  # existing student, not on the roster yet
    client.post(f"/admin/courses/{world['course_id']}/students", json={"student_numbers": ["220000021"]}, headers=admin_headers)  # now on the roster
    good = "﻿student_number,full_name\n220000020,Twenty\n220000021,Twenty One\n"  # BOM (literal U+FEFF char) + one new + one already on the roster
    result = client.post(f"/admin/courses/{world['course_id']}/students/import", files={"file": ("roster.csv", good.encode(), "text/csv")}, headers=admin_headers).json()  # upload the good file
    assert result == {"added": ["220000020"], "already_present": ["220000021"], "unknown": [], "created": ["220000020"]}  # new one created and added, existing one skipped
