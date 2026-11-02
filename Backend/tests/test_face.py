import secrets  # nonces
import time  # timestamps

import numpy as np  # fake embeddings
import pytest  # fixtures

from sqlalchemy import select  # DB checks

from app.db import SessionLocal  # direct DB access
from app.models import Attendance, AuditLog, CommandStatus, DeviceCommand, FaceTemplate, Method  # tables checked
from app.security import compute_signature  # sign raw picture uploads
from app.services import face as face_service  # patched: no real models in tests

PICTURE = bytes(320 * 240)  # a blank 320x240 greyscale picture


@pytest.fixture
def fake_models(monkeypatch):  # replace OpenCV with predictable answers
    state = {"result": "ok", "score": 0.9}  # what the "models" say
    monkeypatch.setattr(face_service, "analyse", lambda raw: (state["result"], np.ones((1, 128), np.float32) if state["result"] == "ok" else None))  # detection + embedding
    monkeypatch.setattr(face_service, "similarity", lambda a, b: state["score"])  # comparison
    return state  # tests change it


def upload(client, world, command_id, body=PICTURE):  # signed raw upload, like the terminal
    path = f"/device/commands/{command_id}/face"  # endpoint
    ts, nonce = int(time.time()), secrets.token_hex(16)  # fresh
    sig = compute_signature(world["secret"], "POST", path, ts, nonce, body)  # over the raw bytes
    headers = {"X-Device-Id": str(world["device_id"]), "X-Timestamp": str(ts), "X-Nonce": nonce, "X-Signature": sig, "Content-Type": "application/octet-stream"}  # auth
    return client.post(path, content=body, headers=headers)  # send


def claim(call):  # terminal polls and claims the next command
    r = call("GET", "/device/commands/next")  # poll
    assert r.status_code == 200, r.text  # one is waiting
    return r.json()  # the command


def test_face_enrol_then_lecturer_verify_marks_present(client, world, call, admin_headers, lecturer_headers, fake_models):
    r = client.post(f"/admin/students/{world['student_yes']}/face/enrol", json={"device_id": world["device_id"]}, headers=admin_headers)  # admin queues enrol
    assert r.status_code == 201, r.text  # queued
    cmd = claim(call)  # terminal picks it up
    assert cmd["type"] == "face_enrol" and cmd["full_name"] == "Has Consent"  # LCD info
    r = upload(client, world, cmd["command_id"])  # picture
    assert r.status_code == 200 and r.json()["status"] == "ok", r.text  # stored
    assert call("POST", f"/device/commands/{cmd['command_id']}/result", {"success": True, "detail": "face_enrolled"}).json()["status"] == "done"  # closed
    with SessionLocal() as db:  # template saved
        assert db.scalars(select(FaceTemplate)).first() is not None  # one row
    assert client.get(f"/admin/students/{world['student_yes']}/face", headers=admin_headers).json()["enrolled"] is True  # status endpoint
    r = client.post(f"/lecturer/sessions/{world['session_id']}/face-verify", json={"student_number": "111"}, headers=lecturer_headers)  # lecturer asks
    assert r.status_code == 201, r.text  # queued
    cmd = claim(call)  # terminal
    assert cmd["type"] == "face_verify"  # verify
    body = upload(client, world, cmd["command_id"]).json()  # picture
    assert body["status"] == "ok" and body["attendance"] == "recorded", body  # present
    with SessionLocal() as db:  # attendance row
        row = db.scalars(select(Attendance)).first()  # the only one
        assert row.method == Method.face  # by face
    with SessionLocal() as db:  # audit trail
        assert "face.verified" in list(db.scalars(select(AuditLog.action)))  # audited


def test_retake_statuses_and_no_match(client, world, call, admin_headers, fake_models):
    client.post(f"/admin/students/{world['student_yes']}/face/enrol", json={"device_id": world["device_id"]}, headers=admin_headers)  # queue
    cmd = claim(call)  # claim
    fake_models["result"] = "no_face"  # empty picture
    assert upload(client, world, cmd["command_id"]).json()["status"] == "no_face"  # retake asked
    fake_models["result"] = "ok"  # good picture
    assert upload(client, world, cmd["command_id"]).json()["status"] == "ok"  # stored
    call("POST", f"/device/commands/{cmd['command_id']}/result", {"success": True})  # close
    client.post(f"/admin/students/{world['student_yes']}/face/verify", json={"device_id": world["device_id"]}, headers=admin_headers)  # admin test
    cmd = claim(call)  # claim
    fake_models["score"] = 0.1  # different person
    body = upload(client, world, cmd["command_id"]).json()  # picture
    assert body["status"] == "no_match" and body["attendance"] is None  # rejected, nothing recorded


def test_guards(client, world, call, admin_headers, lecturer_headers, fake_models):
    assert client.post(f"/admin/students/{world['student_no']}/face/enrol", json={"device_id": world["device_id"]}, headers=admin_headers).json()["detail"] == "no_consent"  # POPIA
    assert client.post(f"/admin/students/{world['student_yes']}/face/verify", json={"device_id": world["device_id"]}, headers=admin_headers).json()["detail"] == "face_not_enrolled"  # nothing to compare
    assert client.post(f"/lecturer/sessions/{world['session_id']}/face-verify", json={"student_number": "333"}, headers=lecturer_headers).json()["detail"] == "not_in_course"  # roster
    client.post(f"/admin/students/{world['student_yes']}/face/enrol", json={"device_id": world["device_id"]}, headers=admin_headers)  # queue
    assert client.post(f"/admin/students/{world['student_yes']}/face/enrol", json={"device_id": world["device_id"]}, headers=admin_headers).json()["detail"] == "face_pending"  # one at a time
    cmd = claim(call)  # claim
    assert upload(client, world, cmd["command_id"], body=b"x" * 10).status_code == 422  # wrong size


def test_consent_withdrawal_deletes_face(client, world, call, admin_headers, fake_models):
    client.post(f"/admin/students/{world['student_yes']}/face/enrol", json={"device_id": world["device_id"]}, headers=admin_headers)  # queue
    cmd = claim(call)  # claim
    upload(client, world, cmd["command_id"])  # stored
    call("POST", f"/device/commands/{cmd['command_id']}/result", {"success": True})  # close
    r = client.put(f"/admin/students/{world['student_yes']}/consent", json={"consent": False}, headers=admin_headers)  # withdraw
    assert r.status_code == 200, r.text  # ok
    with SessionLocal() as db:  # template gone
        assert db.scalars(select(FaceTemplate)).first() is None  # POPIA
