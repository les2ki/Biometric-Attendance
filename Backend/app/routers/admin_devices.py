import secrets  # random HMAC secrets
from typing import Annotated  # query alias typing

from fastapi import APIRouter, HTTPException, Query, status  # routing + errors
from sqlalchemy import select  # query builder
from sqlalchemy.exc import IntegrityError  # unique name clash

from app.auth import AdminUser  # admin guard
from app.models import CommandStatus, Device, DeviceCommand  # tables used here
from app.routers.common import DbSession, PageParams, page_rows  # shared dependencies
from app.schemas.admin import CommandOut, DeviceCreate, DeviceCreated, DeviceOut, DeviceUpdate  # request/response shapes
from app.schemas.common import Page  # paged list
from app.services.audit import write_audit  # audit trail
from app.services.commands import cancel_command  # command queue
from app.services.views import command_outs, device_outs  # response builders

router = APIRouter(prefix="/admin", tags=["admin"])  # device + command routes live under /admin


def _get_device(db: DbSession, device_id: int) -> Device:  # load or 404
    device = db.get(Device, device_id)  # look it up
    if device is None:  # bad ID
        raise HTTPException(status.HTTP_404_NOT_FOUND, "device_not_found")  # stop
    return device  # found


def _created(db: DbSession, device: Device) -> DeviceCreated:  # the one response that carries the secret
    return DeviceCreated(**device_outs(db, [device])[0].model_dump(), hmac_secret=device.hmac_secret)  # shown once


@router.get("/devices", response_model=list[DeviceOut])  # list terminals
def list_devices(admin: AdminUser, db: DbSession) -> list[DeviceOut]:  # no filters
    return device_outs(db, list(db.scalars(select(Device).order_by(Device.name))))  # never includes the secret


@router.post("/devices", response_model=DeviceCreated, status_code=status.HTTP_201_CREATED)  # register a terminal
def create_device(payload: DeviceCreate, admin: AdminUser, db: DbSession) -> DeviceCreated:  # validated body
    name = payload.name.strip()  # tidy
    if db.scalars(select(Device).where(Device.name == name)).first():  # name already used
        raise HTTPException(status.HTTP_409_CONFLICT, "device_name_taken")  # stop
    device = Device(name=name, hmac_secret=secrets.token_hex(32), is_active=True)  # 64-char random shared secret
    db.add(device)  # queue insert
    try:  # unique name is the final guard
        db.flush()  # get device.id
    except IntegrityError:  # raced with another create
        db.rollback()  # undo
        raise HTTPException(status.HTTP_409_CONFLICT, "device_name_taken")  # stop
    write_audit(db, actor=admin, action="device.created", entity="devices", entity_id=device.id, details={"name": name})  # audit (never the secret)
    db.commit()  # device + audit together
    return _created(db, device)  # includes the secret this once


@router.patch("/devices/{device_id}", response_model=DeviceOut)  # revoke / restore a terminal
def update_device(device_id: int, payload: DeviceUpdate, admin: AdminUser, db: DbSession) -> DeviceOut:  # validated body
    device = _get_device(db, device_id)  # load or 404
    before = {"is_active": device.is_active}  # for the audit row
    if payload.is_active is not None:  # flag change
        device.is_active = payload.is_active  # apply
    write_audit(db, actor=admin, action="device.updated", entity="devices", entity_id=device.id, details={"before": before, "after": {"is_active": device.is_active}})  # audit
    db.commit()  # change + audit together
    return device_outs(db, [device])[0]  # response


@router.post("/devices/{device_id}/rotate-secret", response_model=DeviceCreated)  # issue a new secret (P2)
def rotate_secret(device_id: int, admin: AdminUser, db: DbSession) -> DeviceCreated:  # path ID
    device = _get_device(db, device_id)  # load or 404
    device.hmac_secret = secrets.token_hex(32)  # old secret stops working immediately
    write_audit(db, actor=admin, action="device.secret_rotated", entity="devices", entity_id=device.id)  # audit (never the secret)
    db.commit()  # change + audit together
    return _created(db, device)  # includes the new secret this once


@router.get("/devices/{device_id}/commands", response_model=Page[CommandOut])  # command history for a terminal
def list_commands(device_id: int, admin: AdminUser, db: DbSession, page: PageParams, status_filter: Annotated[CommandStatus | None, Query(alias="status")] = None) -> Page[CommandOut]:  # optional ?status= filter
    device = _get_device(db, device_id)  # load or 404
    stmt = select(DeviceCommand).where(DeviceCommand.device_id == device.id).order_by(DeviceCommand.created_at.desc(), DeviceCommand.id.desc())  # newest first
    if status_filter is not None:  # one status only
        stmt = stmt.where(DeviceCommand.status == status_filter)  # filter
    rows, total = page_rows(db, stmt, page)  # one page
    return Page[CommandOut](items=command_outs(db, rows), total=total)  # response


@router.post("/commands/{command_id}/cancel", response_model=CommandOut)  # cancel a queued enrol (P2)
def cancel(command_id: int, admin: AdminUser, db: DbSession) -> CommandOut:  # path ID
    cmd = cancel_command(db, command_id=command_id, admin=admin)  # validates + audits
    db.commit()  # change + audit together
    return command_outs(db, [cmd])[0]  # response
