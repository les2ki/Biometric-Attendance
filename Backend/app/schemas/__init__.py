from app.schemas.device import *  # noqa: F403  # keeps "from app.schemas import AttendanceIn" working
from app.schemas.device import AttendanceIn, AttendanceOut, CommandResultIn, CommandResultOut, DeviceCommandOut, SessionOut  # explicit names for __all__

__all__ = ["AttendanceIn", "AttendanceOut", "CommandResultIn", "CommandResultOut", "DeviceCommandOut", "SessionOut"]  # public terminal schemas
