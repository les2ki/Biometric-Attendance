from datetime import datetime, timedelta, timezone  # deadlines
from typing import NamedTuple  # small result type

from fastapi import HTTPException, status  # validation errors
from sqlalchemy import delete, select, update  # query builders
from sqlalchemy.exc import IntegrityError  # unique-constraint clashes
from sqlalchemy.orm import Session  # DB session type

from app.config import settings  # fp_slot_capacity, command_ttl_minutes
from app.models import CommandStatus, CommandType, Device, DeviceCommand, FingerprintSlot, Student, User  # tables used here
from app.services.audit import write_audit  # audit trail

OPEN_STATUSES = (CommandStatus.pending, CommandStatus.in_progress)  # commands that still hold a slot
MAX_SKIPS = 10  # max commands cancelled in one /next call before giving up


def _now() -> datetime:  # one place for "now"
    return datetime.now(timezone.utc)  # always timezone-aware UTC


def expire_stale(db: Session, device_id: int, now: datetime) -> None:  # time out commands whose deadline passed
    stale = db.scalars(select(DeviceCommand).where(  # open commands past their deadline
        DeviceCommand.device_id == device_id,  # this terminal
        DeviceCommand.status.in_(OPEN_STATUSES),  # still open
        DeviceCommand.expires_at.is_not(None),  # wipes never expire
        DeviceCommand.expires_at < now,  # deadline passed
    )).all()  # load them
    for cmd in stale:  # each one
        was_claimed = cmd.status == CommandStatus.in_progress  # terminal may have written the sensor already
        cmd.status = CommandStatus.expired  # time out
        cmd.completed_at = now  # finished now
        if was_claimed and cmd.type == CommandType.enrol:  # half-done enrol may have left a template behind
            queue_wipe(db, device_id=cmd.device_id, slot_number=cmd.slot_number, student_id=cmd.student_id, requested_by=None)  # clean the slot


def reserved_slots(db: Session, device_id: int) -> set[int]:  # slots the server must not hand out
    used = set(db.scalars(select(FingerprintSlot.slot_number).where(FingerprintSlot.device_id == device_id)))  # slots holding a template
    queued = set(db.scalars(select(DeviceCommand.slot_number).where(DeviceCommand.device_id == device_id, DeviceCommand.status.in_(OPEN_STATUSES))))  # slots with work pending
    return used | queued  # union of both


def next_free_slot(db: Session, device_id: int) -> int | None:  # lowest free slot (D7)
    free = set(range(1, settings.fp_slot_capacity + 1)) - reserved_slots(db, device_id)  # all slots minus taken ones
    return min(free) if free else None  # None = sensor full


def queue_wipe(db: Session, *, device_id: int, slot_number: int, student_id: int | None, requested_by: User | None) -> DeviceCommand:  # ask a terminal to delete a slot
    cmd = DeviceCommand(  # the wipe command
        device_id=device_id,  # target terminal
        type=CommandType.delete_slot,  # wipe
        status=CommandStatus.pending,  # waiting for the terminal
        slot_number=slot_number,  # slot to wipe
        student_id=student_id,  # whose template it was (may be None)
        requested_by_user_id=requested_by.id if requested_by is not None else None,  # None = system
        expires_at=None,  # POPIA deletion never expires
    )
    db.add(cmd)  # queue insert
    db.flush()  # assign cmd.id and created_at now
    return cmd  # caller commits


def _cancel(db: Session, cmd: DeviceCommand, reason: str, now: datetime) -> DeviceCommand | None:  # cancel one open command; returns any wipe it queued
    was_claimed = cmd.status == CommandStatus.in_progress  # terminal may already be capturing
    cmd.status = CommandStatus.cancelled  # stop it
    cmd.result_detail = reason  # why
    cmd.completed_at = now  # finished now
    if was_claimed and cmd.type == CommandType.enrol:  # a template may land in the slot anyway
        return queue_wipe(db, device_id=cmd.device_id, slot_number=cmd.slot_number, student_id=cmd.student_id, requested_by=None)  # make sure it gets wiped
    return None  # nothing was written to the sensor


def queue_enrol(db: Session, *, student: Student | None, device: Device | None, admin: User) -> DeviceCommand:  # admin asks a terminal to enrol a finger
    if student is None:  # bad student ID
        raise HTTPException(status.HTTP_404_NOT_FOUND, "student_not_found")  # stop
    if device is None:  # bad device ID
        raise HTTPException(status.HTTP_404_NOT_FOUND, "device_not_found")  # stop
    if not student.is_active:  # deactivated student
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "student_inactive")  # stop
    if not device.is_active:  # revoked terminal
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "device_inactive")  # stop
    if not student.biometric_consent:  # POPIA: no consent, no biometrics
        raise HTTPException(status.HTTP_403_FORBIDDEN, "no_consent")  # use the manual fallback instead
    now = _now()  # one timestamp for this action
    expire_stale(db, device.id, now)  # old commands shouldn't block slots or trigger enrolment_pending
    if db.scalars(select(FingerprintSlot).where(FingerprintSlot.device_id == device.id, FingerprintSlot.student_id == student.id)).first():  # already on this sensor
        raise HTTPException(status.HTTP_409_CONFLICT, "already_enrolled")  # stop
    pending = db.scalars(select(DeviceCommand).where(  # open enrol for this student on this device?
        DeviceCommand.device_id == device.id,  # this terminal
        DeviceCommand.student_id == student.id,  # this student
        DeviceCommand.type == CommandType.enrol,  # enrol commands only
        DeviceCommand.status.in_(OPEN_STATUSES),  # still open
    )).first()  # one is enough
    if pending is not None:  # already queued
        raise HTTPException(status.HTTP_409_CONFLICT, "enrolment_pending")  # stop
    slot = next_free_slot(db, device.id)  # server picks the slot (D7)
    if slot is None:  # every slot taken
        raise HTTPException(status.HTTP_409_CONFLICT, "sensor_full")  # stop
    cmd = DeviceCommand(  # the enrol command
        device_id=device.id,  # target terminal
        type=CommandType.enrol,  # enrol
        status=CommandStatus.pending,  # waiting for the terminal
        slot_number=slot,  # where the terminal must store the template
        student_id=student.id,  # who
        requested_by_user_id=admin.id,  # which admin asked
        expires_at=now + timedelta(minutes=settings.command_ttl_minutes),  # stale enrolments time out
    )
    db.add(cmd)  # queue insert
    db.flush()  # get cmd.id for the audit row
    write_audit(db, actor=admin, action="fingerprint.enrol_requested", entity="students", entity_id=student.id, details={"device_id": device.id, "slot": slot, "command_id": cmd.id})  # audit
    return cmd  # caller commits


def delete_student_biometrics(db: Session, *, student: Student, device_id: int | None, admin: User | None) -> list[DeviceCommand]:  # POPIA deletion
    now = _now()  # one timestamp for this action
    slot_query = select(FingerprintSlot).where(FingerprintSlot.student_id == student.id)  # the student's slots
    enrol_query = select(DeviceCommand).where(DeviceCommand.student_id == student.id, DeviceCommand.type == CommandType.enrol, DeviceCommand.status.in_(OPEN_STATUSES))  # open enrolments
    if device_id is not None:  # one terminal only
        slot_query = slot_query.where(FingerprintSlot.device_id == device_id)  # narrow slots
        enrol_query = enrol_query.where(DeviceCommand.device_id == device_id)  # narrow commands
    wipes: list[DeviceCommand] = []  # commands to return
    removed: list[dict] = []  # for the audit row
    for slot in db.scalars(slot_query).all():  # each stored template
        removed.append({"device_id": slot.device_id, "slot_number": slot.slot_number})  # remember for audit
        db.delete(slot)  # server stops linking the template to the student immediately
        db.flush()  # delete before queueing the wipe
        wipes.append(queue_wipe(db, device_id=slot.device_id, slot_number=slot.slot_number, student_id=student.id, requested_by=admin))  # terminal erases it
    for cmd in db.scalars(enrol_query).all():  # unfinished enrolments
        wipe = _cancel(db, cmd, "biometrics_deleted", now)  # stop them
        if wipe is not None:  # it had been claimed, so a wipe was queued too
            wipes.append(wipe)  # include it in the response
    db.flush()  # make sure everything has IDs
    write_audit(db, actor=admin, action="fingerprint.deleted", entity="students", entity_id=student.id, details={"device_id": device_id, "slots": removed})  # audit
    return wipes  # caller commits


def cancel_command(db: Session, *, command_id: int, admin: User) -> DeviceCommand:  # admin cancels a queued command (P2)
    cmd = db.get(DeviceCommand, command_id)  # look it up
    if cmd is None:  # bad ID
        raise HTTPException(status.HTTP_404_NOT_FOUND, "unknown_command")  # stop
    if cmd.type == CommandType.delete_slot:  # POPIA deletion must complete
        raise HTTPException(status.HTTP_409_CONFLICT, "wipe_cannot_be_cancelled")  # stop
    if cmd.status not in OPEN_STATUSES:  # already finished
        raise HTTPException(status.HTTP_409_CONFLICT, "command_not_active")  # stop
    before = cmd.status.value  # for the audit row
    _cancel(db, cmd, "cancelled_by_admin", _now())  # cancel (queues a wipe if it was claimed)
    write_audit(db, actor=admin, action="device.command_cancelled", entity="device_commands", entity_id=cmd.id, details={"before": before, "device_id": cmd.device_id, "slot": cmd.slot_number})  # audit
    return cmd  # caller commits


class NextCommand(NamedTuple):  # what /device/commands/next hands back
    command: DeviceCommand  # the claimed command
    student: Student | None  # student for enrol LCD text


def _oldest(db: Session, device_id: int, status_value: CommandStatus) -> DeviceCommand | None:  # oldest command in one status
    return db.scalars(select(DeviceCommand).where(DeviceCommand.device_id == device_id, DeviceCommand.status == status_value).order_by(DeviceCommand.created_at, DeviceCommand.id)).first()  # FIFO


def next_command(db: Session, device: Device) -> NextCommand | None:  # terminal polls for work
    now = _now()  # one timestamp for this poll
    expire_stale(db, device.id, now)  # time out old commands first
    db.commit()  # save expiries
    for _ in range(MAX_SKIPS):  # skip cancelled ones, but never loop forever
        cmd = _oldest(db, device.id, CommandStatus.in_progress) or _oldest(db, device.id, CommandStatus.pending)  # resume first, then FIFO
        if cmd is None:  # nothing to do
            return None  # router sends 204
        student = db.get(Student, cmd.student_id) if cmd.student_id is not None else None  # who it's for
        if cmd.type == CommandType.enrol and (student is None or not student.is_active or not student.biometric_consent):  # consent gone since queueing
            _cancel(db, cmd, "consent_withdrawn", now)  # don't capture a finger without consent
            db.commit()  # save and look again
            continue  # next command
        if cmd.status == CommandStatus.pending:  # first time the terminal sees it
            cmd.status = CommandStatus.in_progress  # claimed
            cmd.claimed_at = now  # when
            if cmd.type == CommandType.enrol:  # the student needs time at the terminal
                cmd.expires_at = now + timedelta(minutes=settings.command_ttl_minutes)  # fresh deadline from now
        db.commit()  # save the claim
        return NextCommand(cmd, student)  # hand it to the terminal
    return None  # gave up after MAX_SKIPS


def report_result(db: Session, *, device: Device, command_id: int, success: bool, detail: str | None) -> DeviceCommand:  # terminal reports how a command went
    cmd = db.get(DeviceCommand, command_id)  # look it up
    if cmd is None or cmd.device_id != device.id:  # missing or someone else's
        raise HTTPException(status.HTTP_404_NOT_FOUND, "unknown_command")  # stop
    if cmd.status in (CommandStatus.done, CommandStatus.failed):  # retry of a result already saved
        return cmd  # idempotent: same answer
    now = _now()  # one timestamp for this result
    expire_stale(db, device.id, now)  # a result after the deadline counts as expired
    db.commit()  # save expiries (and any wipe they queued)
    if cmd.status != CommandStatus.in_progress:  # pending / cancelled / expired
        raise HTTPException(status.HTTP_409_CONFLICT, "command_not_active")  # stop
    actor = db.get(User, cmd.requested_by_user_id) if cmd.requested_by_user_id is not None else None  # admin who asked (for the audit row)
    if not success:  # terminal couldn't do it
        cmd.status = CommandStatus.failed  # record failure
        cmd.result_detail = detail  # terminal's error text
        cmd.completed_at = now  # finished
        write_audit(db, actor=None, action="device.command_failed", entity="device_commands", entity_id=cmd.id, details={"device_id": device.id, "type": cmd.type.value, "slot": cmd.slot_number, "detail": detail})  # audit
        db.commit()  # save
        return cmd  # done
    if cmd.type == CommandType.delete_slot:  # wipe finished
        cmd.status = CommandStatus.done  # success
        cmd.completed_at = now  # finished
        write_audit(db, actor=actor, action="fingerprint.slot_wiped", entity="device_commands", entity_id=cmd.id, details={"device_id": device.id, "slot": cmd.slot_number, "student_id": cmd.student_id})  # audit
        db.commit()  # save
        return cmd  # done
    student = db.get(Student, cmd.student_id) if cmd.student_id is not None else None  # enrolled student
    if student is None or not student.is_active or not student.biometric_consent:  # consent withdrawn during capture
        cmd.status = CommandStatus.cancelled  # don't keep it
        cmd.result_detail = "consent_withdrawn"  # why
        cmd.completed_at = now  # finished
        queue_wipe(db, device_id=device.id, slot_number=cmd.slot_number, student_id=cmd.student_id, requested_by=None)  # sensor now holds an unwanted template
        db.commit()  # save
        return cmd  # cancelled
    try:  # savepoint so a clash only undoes the mapping
        with db.begin_nested():  # SAVEPOINT
            db.execute(delete(FingerprintSlot).where(FingerprintSlot.device_id == device.id, FingerprintSlot.slot_number == cmd.slot_number))  # drop any stale mapping for this slot
            db.add(FingerprintSlot(device_id=device.id, slot_number=cmd.slot_number, student_id=student.id))  # slot -> student
    except IntegrityError:  # student already has another slot on this sensor
        cmd.status = CommandStatus.failed  # can't keep two templates
        cmd.result_detail = "student_already_enrolled"  # why
        cmd.completed_at = now  # finished
        queue_wipe(db, device_id=device.id, slot_number=cmd.slot_number, student_id=student.id, requested_by=None)  # remove the extra template
        db.commit()  # save
        return cmd  # failed
    cmd.status = CommandStatus.done  # success
    cmd.completed_at = now  # finished
    write_audit(db, actor=actor, action="fingerprint.enrolled", entity="students", entity_id=student.id, details={"device_id": device.id, "slot": cmd.slot_number, "command_id": cmd.id})  # audit
    db.commit()  # mapping + status + audit together
    return cmd  # done
