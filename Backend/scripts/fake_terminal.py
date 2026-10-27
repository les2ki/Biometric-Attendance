import json  # build request bodies
import os  # read device ID/secret from environment variables
import secrets  # random nonces and idempotency keys
import sys  # command-line arguments
import time  # Unix timestamp

import httpx  # HTTP client (already installed)

from app.security import compute_signature  # EXACT same signing as the server

API_URL = os.getenv("API_URL", "http://127.0.0.1:8000")  # where the API runs
DEVICE_ID = int(os.environ["DEVICE_ID"])  # from seed output
DEVICE_SECRET = os.environ["DEVICE_SECRET"]  # from seed output


def send(method: str, path: str, payload: dict | None = None) -> None:  # sign and send one request, like the ESP32 will
    body = json.dumps(payload).encode() if payload is not None else b""  # raw bytes that get signed
    timestamp = int(time.time())  # send time
    nonce = secrets.token_hex(16)  # 32 random hex chars, fresh every request
    signature = compute_signature(DEVICE_SECRET, method, path, timestamp, nonce, body)  # HMAC over method/path/ts/nonce/body
    headers = {"X-Device-Id": str(DEVICE_ID), "X-Timestamp": str(timestamp), "X-Nonce": nonce, "X-Signature": signature, "Content-Type": "application/json"}  # the 4 auth headers + JSON type
    response = httpx.request(method, API_URL + path, content=body, headers=headers)  # send the exact signed bytes
    print(response.status_code, response.text or ("no commands" if response.status_code == 204 else ""))  # show the server's answer (204 = nothing queued)


def main() -> None:  # tiny command-line interface
    args = sys.argv[1:]  # everything after the script name
    if args[:1] == ["session"]:  # python -m scripts.fake_terminal session
        send("GET", "/device/session")  # which session is open?
    elif args[:1] == ["mark"] and len(args) in (4, 5):  # ... mark <session_id> <slot> <confidence> [key]
        key = args[4] if len(args) == 5 else secrets.token_hex(16)  # reuse a key to simulate a retry
        print("idempotency_key:", key)  # so you can copy it for a retry test
        send("POST", "/device/attendance", {"idempotency_key": key, "session_id": int(args[1]), "slot_number": int(args[2]), "confidence": int(args[3])})  # one scan
    elif args[:1] == ["next"]:  # ... next
        send("GET", "/device/commands/next")  # any enrol/wipe work queued? (204 = none)
    elif args[:1] == ["result"] and len(args) >= 3 and args[2] in ("ok", "fail"):  # ... result <command_id> ok|fail [detail]
        detail = " ".join(args[3:]) or None  # optional error text
        send("POST", f"/device/commands/{int(args[1])}/result", {"success": args[2] == "ok", "detail": detail})  # report the outcome
    else:  # wrong usage
        print("usage: session | next | result <command_id> ok|fail [detail] | mark <session_id> <slot> <confidence> [key]")  # help text


if __name__ == "__main__":  # only when run directly
    main()  # do it