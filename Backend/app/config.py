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
        self.face_key = os.getenv("face_key", "")  # Fernet key for face templates; empty = derived from JWT_secret_key
        self.face_match_threshold = float(os.getenv("face_match_threshold", "0.363"))  # min cosine similarity accepted as "same person" (SFace default; tune from measurements)
        self.face_enrol_shots = int(os.getenv("face_enrol_shots", "3"))  # pictures stored per enrolment
        self.face_max_frames = int(os.getenv("face_max_frames", "6"))  # pictures a face command may upload before it fails
        self.face_max_failed_attempts = int(os.getenv("face_max_failed_attempts", "3"))  # failed face checks per student per session, then manual only
        self.face_command_ttl_seconds = int(os.getenv("face_command_ttl_seconds", "120"))  # how long a face command stays valid
        self.face_min_face_px = int(os.getenv("face_min_face_px", "40"))  # smallest face width accepted (pixels in the 320x240 picture)
        self.face_preview_seconds = int(os.getenv("face_preview_seconds", "120"))  # how long the dashboard can see the last picture (memory only)
        self.face_model_dir = os.getenv("face_model_dir", str(Path(__file__).resolve().parent.parent / "models"))  # where the ONNX files live
        

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

    #face settings
    face_key: str  # Fernet key (empty = derived from JWT_secret_key)
    face_match_threshold: float = 0.363  # cosine similarity threshold
    face_enrol_shots: int = 3  # pictures per enrolment
    face_max_frames: int = 6  # upload limit per face command
    face_max_failed_attempts: int = 3  # per student per session
    face_command_ttl_seconds: int = 120  # face command lifetime
    face_min_face_px: int = 40  # smallest usable face
    face_preview_seconds: int = 120  # dashboard preview lifetime (memory only)
    face_model_dir: str  # ONNX model folder


settings = Settings()