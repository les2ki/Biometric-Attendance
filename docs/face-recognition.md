# Face recognition (Milestone C): how it works

Face is the **backup** for when a fingerprint can't be read. The terminal's camera takes the pictures and the server does the matching. Only encrypted face numbers (embeddings) are stored. Pictures are never saved.

```
Dashboard (admin: Enrol face / Test match, lecturer: Verify by face)
   │  POST /admin/students/{id}/face/enrol | /face/check | /lecturer/sessions/{id}/face-verify
   ▼
Server queues a device command (type face_enrol / face_verify)
   │  main ESP32 polls GET /device/commands/next (every 5 s)
   ▼
Main ESP32 ──'C' over UART──► Camera ESP32 (OV7670, 320×240 greyscale)
Main ESP32 ◄──"FRM1" packet── Camera ESP32
   │  POST /device/commands/{id}/frame  (the packet bytes, unchanged)
   ▼
Server: YuNet finds the face → SFace makes 128 numbers → store (enrol) or compare (verify)
   │  reply tells the terminal what to show (LCD lines + LED) and whether to take another picture
   ▼
Dashboard polls GET /face/commands/{id} and shows the result + the last picture (kept in server memory for 2 min)
```

## Server setup (one time)

```powershell
cd Backend
pip install -r requirements.txt          # adds opencv-python-headless, numpy, cryptography
python -m scripts.get_face_models        # downloads the 2 models (~38 MB) into Backend/models (git-ignored)
python -m alembic upgrade head           # face_templates table + new command types
```

Render does the model download in its build command (`render.yaml`). Push, then redeploy.

| Setting (env var) | Default | Meaning |
|---|---|---|
| `face_match_threshold` | `0.363` | Cosine similarity needed to accept a match. **Tune it from your own measurements** (see below). |
| `face_enrol_shots` | `3` | Good pictures stored per enrolment |
| `face_max_frames` | `6` | Pictures a job may upload before it fails (covers "no face seen" retries) |
| `face_max_failed_attempts` | `3` | Failed face checks per student per session, after which only manual marking is allowed |
| `face_command_ttl_seconds` | `120` | A face job expires if the terminal doesn't finish in time |
| `face_key` | *(empty)* | Fernet key for the templates. Empty = derived from `JWT_secret_key`. **If the JWT secret changes, stored faces become unreadable: re-enrol.** |

## Terminal contract (for the main ESP32 firmware)

### 1. Polling: `GET /device/commands/next`

Face jobs arrive through the same poll as fingerprint jobs:

```json
{"command_id": 12, "type": "face_enrol", "slot_number": null, "student_number": "220000001",
 "full_name": "Test Student One", "expires_at": "2026-11-03T09:02:00Z", "shots": 3}
```

- `type` is `"face_enrol"` (3 good pictures) or `"face_verify"` (1 good picture).
- `slot_number` is `null` for face jobs. **The current `pollCommands()` returns early when `slot == 0`, so it must check `type` first**, or face jobs are ignored. An ignored job blocks the queue until it expires after 2 minutes.

### 2. Getting a picture from the camera ESP32

Use UART1 on the main board: `HardwareSerial camSerial(1); camSerial.setRxBufferSize(4096); camSerial.begin(921600, SERIAL_8N1, 22 /*RX*/, 21 /*TX*/);`

1. Send the single byte `'C'`.
2. Read until you see `"FRM1"` (picture) or `"ERR!"` (camera failed). Allow 6 s.
3. After `FRM1`: width u16, height u16, length u32 (little-endian), then `length` pixel bytes, then a u16 checksum. With 320×240 the full packet is **76,814 bytes**.

**Memory:** allocate the 76,814-byte buffer **once in `setup()`, before `WiFi.begin()`**, and keep it. After Wi-Fi and TLS start, the heap is too fragmented for one 77 KB block. If memory is still short, the camera ESP can send 160×120 instead; the server accepts any size up to 640×480.

### 3. Uploading: `POST /device/commands/{id}/frame`

- Body = **the whole packet exactly as received**, from `FRM1` to the checksum. The server checks the checksum.
- Header `Content-Type: application/octet-stream`, plus the usual 4 signed headers.
- Signature = same HMAC as every other request, over `METHOD\nPATH\nTS\nNONCE\n` **followed by the raw bytes**. The existing `hmacSha256Hex(String)` can't take binary data, so call `mbedtls_md_hmac_update` twice: once with the text prefix, once with the buffer.
- Send with `http.POST(buf, len)` (the `uint8_t*` overload).

```cpp
String hmacHexBytes(const String &prefix, const uint8_t *data, size_t len) {  // HMAC over text prefix + binary body
  uint8_t out[32]; mbedtls_md_context_t ctx; mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), 1);
  mbedtls_md_hmac_starts(&ctx, (const unsigned char *)DEVICE_SECRET, strlen(DEVICE_SECRET));
  mbedtls_md_hmac_update(&ctx, (const unsigned char *)prefix.c_str(), prefix.length());
  mbedtls_md_hmac_update(&ctx, data, len);
  mbedtls_md_hmac_finish(&ctx, out); mbedtls_md_free(&ctx);
  String hex; for (int i = 0; i < 32; i++) { if (out[i] < 16) hex += '0'; hex += String(out[i], HEX); }
  return hex;
}
// prefix = "POST\n" + path + "\n" + ts + "\n" + nonce + "\n"
```

### 4. The reply tells the terminal what to do

```json
{"command_id": 12, "outcome": "next_shot", "done": false, "remaining": 2,
 "led": "y", "lcd1": "Got 1 of 3", "lcd2": "Hold still", "score": null}
```

- Show `lcd1` / `lcd2` (already 16 characters or fewer) and the `led` colour (`g`/`y`/`r`).
- `done: false` → wait about 1.5 s and take another picture. `done: true` → stop, beep (`g` = success, `r` = failure), go back to idle.
- `outcome` values: `retry` (no usable face; the LCD says why), `next_shot`, `enrolled`, `matched`, `not_matched`, `already_present`, `session_closed`, `failed`, `cancelled`.

| HTTP status | Meaning | Terminal action |
|---|---|---|
| 200 | Normal reply | As above |
| 422 `bad_checksum` / `bad_frame_length` | Picture damaged on the UART or the upload | Take the picture again (it isn't counted) |
| 409 `command_not_active` | Job expired, cancelled or already finished | Drop the job, go back to idle |
| 503 `face_models_missing` | Server not set up | Report failure: `POST /result {"success": false, "detail": "server_models_missing"}` |

If the camera answers `ERR!` twice in a row, report `POST /device/commands/{id}/result` with `{"success": false, "detail": "camera_error"}`. Never report `success: true` for a face job: the server rejects it, because face jobs finish through `/frame`.

### Suggested loop (main ESP32)

```
LCD "Look at camera" / first name, LED yellow
loop (stop after 8 uploads, or when the reply says done):
    LCD countdown 3-2-1 + short beep (first picture only)
    ask the camera for a picture (if ERR! twice: report camera_error, stop)
    upload it
    422 → take it again;  409 → stop
    show lcd1/lcd2/led from the reply;  if done: final beep, stop;  else wait 1.5 s
```

## Testing without the hardware

```powershell
python -m scripts.fake_terminal next                      # claim the job the dashboard queued
python -m scripts.fake_terminal frame 12 face.png         # upload any picture as if the camera took it
```

## Demo tips (OV7670)

- **Focus the lens.** Turn it until a face about 40 cm away is sharp. Most test frames where no face was found were simply blurred.
- **Avoid light behind the student** (a window). The OV7670 overexposes and the face turns dark.
- One person in front of the camera. If a second face is at least half the size of the first, the job asks the others to step back.
- Enrol and verify under the same lighting as the venue.

## Honest limitations (for the report)

- On 34 real OV7670 bench frames, the detector found faces in 12 and 9 were usable (one clear face). The rest were out of focus, back-lit, or early corrupted frames.
- The default threshold (0.363) is OpenCV's recommendation for SFace on good-quality photos. The OV7670's soft greyscale pictures give lower similarities for the same person and higher ones for different people. In one bench test a different person scored 0.34 against a 0.363 threshold. **Measure before the demo:** enrol 3–5 volunteers, run genuine and impostor checks, then set `face_match_threshold` between the two groups (probably about 0.40–0.45).
- There is no liveness check. A printed photo could pass. The check is supervised: the lecturer asks for it and is in the room.
- Matching is 1:1 (the student the lecturer selected), not identification from the whole class.
