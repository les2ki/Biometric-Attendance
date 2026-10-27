from typing import Literal  # restricts a field to a fixed set of values

from pydantic import AwareDatetime, BaseModel, Field  # validation for requests and responses


class SessionOut(BaseModel):  # what the terminal learns about the open session
    session_id: int  # terminal caches this and sends it with every scan
    course_code: str  # shown on the LCD
    venue: str  # shown on the LCD


class AttendanceIn(BaseModel):  # one fingerprint scan event
    idempotency_key: str = Field(min_length=16, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")  # made ONCE per scan, reused on every retry
    session_id: int  # from GET /device/session
    slot_number: int = Field(ge=1, le=1000)  # slot the R307 matched
    confidence: int = Field(ge=0, le=65535)  # R307 match score
    device_time: AwareDatetime | None = None  # RTC time of the scan; must include a timezone


class AttendanceOut(BaseModel):  # decision the terminal turns into LCD/LED/buzzer feedback
    status: Literal["recorded", "duplicate", "low_confidence", "not_in_course"]  # recorded = saved (or retry of a saved one); duplicate = already present; low_confidence = use fallback; not_in_course = not on the class list
    student_number: str  # who it was
    full_name: str  # for the LCD


class DeviceCommandOut(BaseModel):  # next job for the terminal (enrol a finger / wipe a slot)
    command_id: int  # echoed back in the result call
    type: Literal["enrol", "delete_slot"]  # what to do
    slot_number: int  # sensor slot to fill or wipe
    student_number: str | None  # LCD info for enrol (None for wipes)
    full_name: str | None  # LCD shows "Enrol: <name>"
    expires_at: AwareDatetime | None  # finish before this (None = no deadline)


class CommandResultIn(BaseModel):  # terminal reports how a command went
    success: bool  # True = done on the sensor
    detail: str | None = Field(default=None, max_length=255)  # error text when it failed


class CommandResultOut(BaseModel):  # server's verdict on the reported result
    command_id: int  # which command
    status: str  # final status: done / failed / cancelled
