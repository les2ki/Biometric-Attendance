import os
from pathlib import Path

def _load_dotenv() -> None:
    env_file = Path(__file__).resolve().parent.parent / ".env"
    if not env_file.is_file():
        env_file = Path(__file__).resolve().parents[2] / ".env"
    if not env_file.is_file():
        return

    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip("'\""))


class Settings:
    def __init__(self) -> None:
        _load_dotenv()
        self.database_url = os.environ["database_url"]
        self.JWT_secret_key = os.environ["JWT_secret_key"]
        self.jwt_expire_minutes = int(os.getenv("jwt_expire_minutes", "30"))
        self.hmac_max_skew_seconds = int(os.getenv("hmac_max_skew_seconds", "300"))
        self.fp_accept_confidence = int(os.getenv("fp_accept_confidence", "50"))  # min R307 score accepted without fallback
        self.cors_origins = [o.strip() for o in os.getenv("cors_origins", "http://localhost:3000").split(",") if o.strip()]  # dashboard URLs allowed by CORS
        self.fp_slot_capacity = int(os.getenv("fp_slot_capacity", "127"))  # highest sensor slot the server may assign
        self.command_ttl_minutes = int(os.getenv("command_ttl_minutes", "10"))  # how long an enrol command stays valid
        self.device_online_seconds = int(os.getenv("device_online_seconds", "30"))  # last_seen within this = "online"
        self.display_timezone = os.getenv("display_timezone", "Africa/Johannesburg")  # timezone used in CSV exports
        

    # Database settings
    database_url: str

    # JWT settings
    JWT_secret_key: str
    jwt_expire_minutes: int = 30

    #hmac settings
    hmac_max_skew_seconds: int = 300

    #fingerprint settings
    fp_accept_confidence: int = 50  # tune this from measured scores, no reflashing needed

    #dashboard settings
    cors_origins: list[str]  # allowed browser origins
    fp_slot_capacity: int = 127  # R307 slots the server hands out (1..capacity)
    command_ttl_minutes: int = 10  # enrol command lifetime
    device_online_seconds: int = 30  # online threshold for the dashboard
    display_timezone: str = "Africa/Johannesburg"  # CSV export timezone


settings = Settings()