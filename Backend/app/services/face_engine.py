"""Face engine: turns one camera picture into a 128-number face embedding.

Models (OpenCV Zoo, Apache-2.0), downloaded by `python -m scripts.get_face_models`:
  - YuNet  (face_detection_yunet_2023mar.onnx)   finds faces and 5 landmarks (eyes, nose, mouth corners)
  - SFace  (face_recognition_sface_2021dec.onnx) aligns the face and makes a 128-d embedding
Two embeddings are compared with cosine similarity: 1.0 = identical, about 0 = unrelated.
OpenCV is imported lazily, so the rest of the API (and its tests) never load it.
"""
import struct  # unpack the little-endian camera packet header
import threading  # one model load even if two requests arrive together
from dataclasses import dataclass  # small result type
from pathlib import Path  # model file paths

from fastapi import HTTPException, status  # bad uploads

from app.config import settings  # face_model_dir, face_min_face_px

DETECTOR_FILE = "face_detection_yunet_2023mar.onnx"  # YuNet detector
RECOGNISER_FILE = "face_recognition_sface_2021dec.onnx"  # SFace recogniser
MODEL_VERSION = "sface-2021dec"  # stored with every template; embeddings from other models are never compared
MAX_PIXELS = 640 * 480  # largest picture accepted (VGA); the OV7670 sends 320x240
DETECT_SCORE = 0.6  # YuNet confidence needed to count as a face
SECOND_FACE_RATIO = 0.5  # another face at least half the size of the biggest one = "more than one person"

_lock = threading.Lock()  # guards the lazy load
_models = None  # (detector, recogniser) once loaded


@dataclass
class Frame:  # one decoded camera picture
    width: int  # pixels
    height: int  # pixels
    grey: object  # numpy uint8 array, shape (height, width)


@dataclass
class Analysis:  # what the engine found in a picture
    status: str  # ok / no_face / multiple_faces / face_too_small
    embedding: list[float] | None  # 128 numbers when status == ok
    box: tuple[int, int, int, int] | None  # x, y, w, h of the face used (or the biggest one found)
    detection_score: float | None  # YuNet confidence of that face


def parse_packet(body: bytes) -> Frame:  # camera ESP packet: "FRM1" | w u16 | h u16 | len u32 | pixels | checksum u16
    import numpy as np  # only needed here
    if len(body) < 14 or body[:4] != b"FRM1":  # not a picture packet
        raise HTTPException(422, "bad_frame")  # stop
    width, height, length = struct.unpack_from("<HHI", body, 4)  # header numbers
    if width == 0 or height == 0 or width * height != length or length > MAX_PIXELS:  # header doesn't add up
        raise HTTPException(422, "bad_frame")  # stop
    if len(body) != 12 + length + 2:  # truncated or padded upload
        raise HTTPException(422, "bad_frame_length")  # stop
    pixels = body[12:12 + length]  # one byte per pixel (greyscale)
    (checksum,) = struct.unpack_from("<H", body, 12 + length)  # sent by the camera ESP
    if sum(pixels) & 0xFFFF != checksum:  # damaged on the UART or HTTP leg
        raise HTTPException(422, "bad_checksum")  # stop
    grey = np.frombuffer(pixels, dtype=np.uint8).reshape(height, width)  # 2-D picture
    return Frame(width=width, height=height, grey=grey)  # decoded


def models_present() -> bool:  # both ONNX files on disk?
    folder = Path(settings.face_model_dir)  # model folder
    return (folder / DETECTOR_FILE).is_file() and (folder / RECOGNISER_FILE).is_file()  # True when ready


def _load():  # load both networks once
    global _models  # module cache
    with _lock:  # one loader at a time
        if _models is None:  # first use
            import cv2  # heavy import, only on the first face request
            if not models_present():  # not downloaded
                raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "face_models_missing")  # run scripts.get_face_models
            folder = Path(settings.face_model_dir)  # model folder
            cv2.setNumThreads(1)  # small free-tier server: keep memory and CPU use low
            detector = cv2.FaceDetectorYN.create(str(folder / DETECTOR_FILE), "", (320, 240), DETECT_SCORE, 0.3, 5000)  # YuNet
            recogniser = cv2.FaceRecognizerSF.create(str(folder / RECOGNISER_FILE), "")  # SFace
            _models = (detector, recogniser)  # cache
    return _models  # (detector, recogniser)


def analyse(frame: Frame) -> Analysis:  # find one face and make its embedding
    import cv2  # loaded by _load already
    detector, recogniser = _load()  # cached networks
    image = cv2.cvtColor(frame.grey, cv2.COLOR_GRAY2BGR)  # the networks expect 3 channels; greyscale copied into all three
    detector.setInputSize((frame.width, frame.height))  # match the picture size
    _, faces = detector.detect(image)  # rows: x, y, w, h, 10 landmark numbers, score
    if faces is None or len(faces) == 0:  # nothing found
        return Analysis("no_face", None, None, None)  # ask for another picture
    faces = sorted(faces, key=lambda f: f[2] * f[3], reverse=True)  # biggest face first
    best = faces[0]  # the person closest to the camera
    box = tuple(int(round(v)) for v in best[:4])  # x, y, w, h
    score = float(best[-1])  # detector confidence
    if len(faces) > 1 and faces[1][2] * faces[1][3] >= SECOND_FACE_RATIO * best[2] * best[3]:  # a second person just as close
        return Analysis("multiple_faces", None, box, score)  # can't tell who is being checked
    if best[2] < settings.face_min_face_px:  # too far away for a useful embedding
        return Analysis("face_too_small", None, box, score)  # ask them to come closer
    aligned = recogniser.alignCrop(image, best)  # rotate/crop to the 112x112 face SFace expects
    feature = recogniser.feature(aligned).flatten()  # 128 numbers
    return Analysis("ok", [float(v) for v in feature], box, score)  # usable


def cosine(a: list[float], b: list[float]) -> float:  # cosine similarity of two embeddings
    dot = sum(x * y for x, y in zip(a, b))  # a . b
    na = sum(x * x for x in a) ** 0.5  # |a|
    nb = sum(y * y for y in b) ** 0.5  # |b|
    return dot / (na * nb) if na and nb else 0.0  # 1 = same direction


def preview_png(frame: Frame, analysis: Analysis, label: str) -> bytes:  # the picture with the face box drawn, for the dashboard only
    import cv2  # drawing + PNG encoding
    image = cv2.cvtColor(frame.grey, cv2.COLOR_GRAY2BGR)  # colour so the box stands out
    if analysis.box is not None:  # a face was found
        x, y, w, h = analysis.box  # where
        colour = (80, 200, 80) if analysis.status == "ok" else (60, 160, 255)  # green ok, amber problem (BGR)
        cv2.rectangle(image, (x, y), (x + w, y + h), colour, 2)  # face box
    cv2.rectangle(image, (0, frame.height - 22), (frame.width, frame.height), (0, 0, 0), -1)  # dark strip so the text is readable on bright pictures
    cv2.putText(image, label, (6, frame.height - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1, cv2.LINE_AA)  # status text
    ok, png = cv2.imencode(".png", image)  # compress
    return png.tobytes() if ok else b""  # bytes for the HTTP response
