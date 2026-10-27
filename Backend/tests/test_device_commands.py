import json  # signed bodies for the second device
import secrets  # nonces
import time  # timestamps
from datetime import datetime, timedelta, timezone  # forcing expiry

from sqlalchemy import func, select  # DB assertions

from app.config import settings  # fp_slot_capacity
from app.db import SessionLocal  # direct DB access
from app.models import AuditLog, CommandStatus, CommandType, Device, DeviceCommand, FingerprintSlot, Student  # tables checked
from app.security import compute_signature  # sign as another terminal


def queue_enrol(client, headers, student_id, device_id):  # admin asks for an enrolment
    return client.post(f"/admin/students/{student_id}/enrol", json={"device_id": device_id}, headers=headers)  # raw response


def next_cmd(call):  # terminal polls
    return call("GET", "/device/commands/next")  # raw response


def report(call, command_id, success=True, detail=None):  # terminal reports a result
    return call("POST", f"/device/commands/{command_id}/result", {"success": success, "detail": detail})  # raw response


def command(command_id) -> DeviceCommand:  # reload a command
    with SessionLocal() as db:  # own session
        return db.get(DeviceCommand, command_id)  # fresh copy


def slot_rows() -> int:  # number of fingerprint mappings
    with SessionLocal() as db:  # own session
        return db.scalar(select(func.count()).select_from(FingerprintSlot))  # count


def audit_actions() -> list[str]:  # every audit action so far
    with SessionLocal() as db:  # own session
        return list(db.scalars(select(AuditLog.action).order_by(AuditLog.id)))  # oldest first


def test_no_commands_returns_204(call):  # empty queue means 204
    response = next_cmd(call)  # poll with nothing queued
    assert response.status_code == 204  # no content
    assert response.content == b""  # empty body


def test_enrol_is_delivered_and_claimed(call, client, world, admin_headers):  # queued enrol reaches the terminal
    queued = queue_enrol(client, admin_headers, world["student_yes"], world["device_id"])  # admin queues it
    assert queued.status_code == 201  # created
    assert queued.json()["slot_number"] == 1  # lowest free slot
    response = next_cmd(call)  # terminal polls
    assert response.status_code == 200  # a command is waiting
    body = response.json()  # command payload
    assert body["type"] == "enrol" and body["slot_number"] == 1 and body["full_name"] == "Has Consent" and body["student_number"] == "111"  # right student and slot
    assert command(body["command_id"]).status == CommandStatus.in_progress  # claimed


def test_next_resumes_in_progress_command(call, client, world, admin_headers):  # a rebooted terminal gets the same job back
    queue_enrol(client, admin_headers, world["student_yes"], world["device_id"])  # queue one enrol
    first = next_cmd(call).json()["command_id"]  # first poll claims it
    assert next_cmd(call).json()["command_id"] == first  # same command after a "reboot"


def test_success_creates_slot_and_audit(call, client, world, admin_headers):  # success saves the mapping and logs it
    queue_enrol(client, admin_headers, world["student_yes"], world["device_id"])  # queue one enrol
    command_id = next_cmd(call).json()["command_id"]  # terminal claims it
    response = report(call, command_id)  # report success
    assert response.status_code == 200 and response.json()["status"] == "done"  # accepted
    assert slot_rows() == 1  # one mapping saved
    assert command(command_id).status == CommandStatus.done  # command finished
    assert "fingerprint.enrolled" in audit_actions()  # audited


def test_result_retry_is_idempotent(call, client, world, admin_headers):  # reporting twice is harmless
    queue_enrol(client, admin_headers, world["student_yes"], world["device_id"])  # queue one enrol
    command_id = next_cmd(call).json()["command_id"]  # terminal claims it
    report(call, command_id)  # first report
    retry = report(call, command_id)  # same report again
    assert retry.status_code == 200 and retry.json()["status"] == "done"  # same answer
    assert slot_rows() == 1  # still one mapping


def test_result_on_cancelled_or_expired_is_409(call, client, world, admin_headers):  # dead commands reject results
    cancelled_id = queue_enrol(client, admin_headers, world["student_yes"], world["device_id"]).json()["id"]  # queue one to cancel
    assert client.post(f"/admin/commands/{cancelled_id}/cancel", headers=admin_headers).json()["status"] == "cancelled"  # admin cancels it
    response = report(call, cancelled_id)  # terminal reports anyway
    assert response.status_code == 409 and response.json()["detail"] == "command_not_active"  # refused
    expired_id = queue_enrol(client, admin_headers, world["student_yes"], world["device_id"]).json()["id"]  # queue one to expire
    with SessionLocal() as db:  # force the deadline into the past
        db.get(DeviceCommand, expired_id).expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)  # expired
        db.commit()  # save
    response = report(call, expired_id)  # report after the deadline
    assert response.status_code == 409 and response.json()["detail"] == "command_not_active"  # refused
    assert command(expired_id).status == CommandStatus.expired  # marked expired


def test_consent_withdrawn_while_pending_is_skipped(call, client, world, admin_headers):  # no capture after consent is withdrawn
    command_id = queue_enrol(client, admin_headers, world["student_yes"], world["device_id"]).json()["id"]  # queue one enrol
    assert client.put(f"/admin/students/{world['student_yes']}/consent", json={"consent": False}, headers=admin_headers).status_code == 200  # withdraw consent
    assert next_cmd(call).status_code == 204  # nothing to capture
    assert command(command_id).status == CommandStatus.cancelled  # enrol cancelled


def test_consent_skip_inside_next(call, client, world, admin_headers):  # the /next safety net, if consent changed behind the API's back
    command_id = queue_enrol(client, admin_headers, world["student_yes"], world["device_id"]).json()["id"]  # queue one enrol
    with SessionLocal() as db:  # flip consent directly
        db.get(Student, world["student_yes"]).biometric_consent = False  # withdrawn
        db.commit()  # save
    assert next_cmd(call).status_code == 204  # nothing handed out
    cmd = command(command_id)  # reload it
    assert cmd.status == CommandStatus.cancelled and cmd.result_detail == "consent_withdrawn"  # cancelled with the reason


def test_consent_withdrawn_after_enrolment_wipes_slot(call, client, enrolled, admin_headers):  # withdrawal queues a sensor wipe
    world = enrolled  # slot 1 = student 111
    assert client.put(f"/admin/students/{world['student_yes']}/consent", json={"consent": False}, headers=admin_headers).status_code == 200  # withdraw consent
    assert slot_rows() == 0  # mapping removed immediately
    wipe = next_cmd(call).json()  # terminal gets the wipe
    assert wipe["type"] == "delete_slot" and wipe["slot_number"] == 1 and wipe["full_name"] is None  # wipe slot 1, no name sent
    assert report(call, wipe["command_id"]).json()["status"] == "done"  # terminal confirms
    assert "fingerprint.slot_wiped" in audit_actions()  # audited


def test_expired_enrol_is_marked_and_skipped(call, client, world, admin_headers):  # stale enrols are not handed out
    command_id = queue_enrol(client, admin_headers, world["student_yes"], world["device_id"]).json()["id"]  # queue one enrol
    with SessionLocal() as db:  # force the deadline into the past
        db.get(DeviceCommand, command_id).expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)  # expired
        db.commit()  # save
    assert next_cmd(call).status_code == 204  # nothing handed out
    assert command(command_id).status == CommandStatus.expired  # marked expired


def test_command_of_another_device_is_404(call, client, world, admin_headers):  # a terminal cannot touch another's command
    command_id = queue_enrol(client, admin_headers, world["student_yes"], world["device_id"]).json()["id"]  # queued for t1
    with SessionLocal() as db:  # a second terminal
        other = Device(name="t2", hmac_secret="o" * 64)  # its secret
        db.add(other)  # queue insert
        db.commit()  # save
        other_id = other.id  # its ID
    path = f"/device/commands/{command_id}/result"  # someone else's command
    body = json.dumps({"success": True}).encode()  # signed body
    timestamp, nonce = int(time.time()), secrets.token_hex(16)  # fresh
    headers = {"X-Device-Id": str(other_id), "X-Timestamp": str(timestamp), "X-Nonce": nonce, "X-Signature": compute_signature("o" * 64, "POST", path, timestamp, nonce, body), "Content-Type": "application/json"}  # signed as t2
    response = client.post(path, content=body, headers=headers)  # t2 reports on t1's command
    assert response.status_code == 404 and response.json()["detail"] == "unknown_command"  # hidden from t2


def test_second_enrol_pending_then_already_enrolled(call, client, world, admin_headers):  # duplicate enrols are blocked
    assert queue_enrol(client, admin_headers, world["student_yes"], world["device_id"]).status_code == 201  # first enrol queued
    again = queue_enrol(client, admin_headers, world["student_yes"], world["device_id"])  # second while pending
    assert again.status_code == 409 and again.json()["detail"] == "enrolment_pending"  # refused
    report(call, next_cmd(call).json()["command_id"])  # finish it
    again = queue_enrol(client, admin_headers, world["student_yes"], world["device_id"])  # try once more
    assert again.status_code == 409 and again.json()["detail"] == "already_enrolled"  # refused again


def test_slot_allocation_and_sensor_full(call, client, world, admin_headers, monkeypatch):  # slots fill up in order
    monkeypatch.setattr(settings, "fp_slot_capacity", 2)  # tiny sensor
    with SessionLocal() as db:  # a third consenting student
        extra = Student(student_number="444", full_name="Extra", biometric_consent=True)  # consented
        db.add(extra)  # queue insert
        db.commit()  # save
        extra_id = extra.id  # its ID
    assert queue_enrol(client, admin_headers, world["student_yes"], world["device_id"]).json()["slot_number"] == 1  # first gets slot 1
    assert queue_enrol(client, admin_headers, world["student_off"], world["device_id"]).json()["slot_number"] == 2  # second gets slot 2
    full = queue_enrol(client, admin_headers, extra_id, world["device_id"])  # third has no room
    assert full.status_code == 409 and full.json()["detail"] == "sensor_full"  # refused


def test_failure_is_recorded(call, client, world, admin_headers):  # a failed capture is logged, no mapping saved
    queue_enrol(client, admin_headers, world["student_yes"], world["device_id"])  # queue one enrol
    command_id = next_cmd(call).json()["command_id"]  # terminal claims it
    response = report(call, command_id, success=False, detail="finger_mismatch")  # report a failure
    assert response.json()["status"] == "failed"  # marked failed
    assert command(command_id).result_detail == "finger_mismatch"  # reason kept
    assert "device.command_failed" in audit_actions()  # audited
    assert slot_rows() == 0  # nothing mapped


def test_wipe_cannot_be_cancelled(client, enrolled, admin_headers):  # wipes must always run
    wipes = client.delete(f"/admin/students/{enrolled['student_yes']}/fingerprints", headers=admin_headers).json()  # admin deletes the prints
    assert len(wipes) == 1 and wipes[0]["type"] == CommandType.delete_slot.value  # one wipe queued
    response = client.post(f"/admin/commands/{wipes[0]['id']}/cancel", headers=admin_headers)  # try to cancel it
    assert response.status_code == 409 and response.json()["detail"] == "wipe_cannot_be_cancelled"  # refused
