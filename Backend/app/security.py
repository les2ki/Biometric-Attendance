import hashlib  # SHA-256
import hmac  # keyed hashing + constant-time compare
import time  # current Unix time for the freshness check
from datetime import datetime, timedelta, timezone  # timestamp for last_seen_at
from typing import Annotated  # FastAPI dependency typing

from fastapi import Depends, Header, HTTPException, Request, status  # FastAPI building blocks
from sqlalchemy import delete  # purge old nonces
from sqlalchemy.exc import IntegrityError  # raised when a nonce was already used
from sqlalchemy.orm import Session  # DB session type

from app.config import settings  # hmac_max_skew_seconds
from app.db import get_db  # per-request DB session
from app.models import Device, DeviceNonce  # tables we check against


def compute_signature(secret: str, method: str, path: str, timestamp: int, nonce: str, body: bytes) -> str:  # shared by server, tests and fake terminal
    message = f"{method.upper()}\n{path}\n{timestamp}\n{nonce}\n".encode() + body  # exact string the terminal signs
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()  # HMAC-SHA256 as lowercase hex


def _reject(reason: str) -> HTTPException:  # one place to build auth errors
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=reason)  # 401 = not authenticated


async def verify_device(  # dependency that runs before every /device endpoint
    request: Request,  # raw request, needed for the exact body bytes
    db: Annotated[Session, Depends(get_db)],  # same DB session the endpoint will get
    x_device_id: Annotated[int, Header()],  # X-Device-Id header
    x_timestamp: Annotated[int, Header()],  # X-Timestamp header (Unix seconds when sent)
    x_nonce: Annotated[str, Header(min_length=16, max_length=64)],  # X-Nonce header (random, single use)
    x_signature: Annotated[str, Header(min_length=64, max_length=64)],  # X-Signature header (hex HMAC)
) -> Device:  # endpoints receive the authenticated device
    device = db.get(Device, x_device_id)  # look up the terminal
    if device is None or not device.is_active:  # unknown or revoked terminal
        raise _reject("unknown_device")  # stop here
    if abs(time.time() - x_timestamp) > settings.hmac_max_skew_seconds:  # too old or from the future
        raise _reject("stale_timestamp")  # blocks replays of old captured requests
    body = await request.body()  # exact bytes received (cached, so the endpoint can still read them)
    expected = compute_signature(device.hmac_secret, request.method, request.url.path, x_timestamp, x_nonce, body)  # what the signature should be
    if not hmac.compare_digest(expected, x_signature.lower()):  # constant-time compare, leaks nothing via timing
        raise _reject("bad_signature")  # tampered body or wrong secret
    db.add(DeviceNonce(device_id=device.id, nonce=x_nonce))  # remember this nonce (only AFTER the signature checks out)
    device.last_seen_at = datetime.now(timezone.utc)  # terminal liveness for the dashboard
    try:  # composite primary key (device_id, nonce) rejects reuse
        db.commit()  # save now, so a used nonce stays used even if the endpoint fails later
    except IntegrityError:  # this nonce was seen before
        db.rollback()  # clear the failed transaction
        raise _reject("replayed_nonce")  # identical request sent twice
    db.execute(delete(DeviceNonce).where(DeviceNonce.device_id == device.id, DeviceNonce.received_at < datetime.now(timezone.utc) - timedelta(seconds=2 * settings.hmac_max_skew_seconds)))  # old nonces can't be replayed anyway (timestamp check)
    db.commit()  # keep the table small
    return device  # authenticated terminal


CurrentDevice = Annotated[Device, Depends(verify_device)]  # short alias for endpoint parameters