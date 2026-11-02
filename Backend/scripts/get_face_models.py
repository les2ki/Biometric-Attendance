from app.services.face import MODELS_DIR, download_models  # model list + downloader


if __name__ == "__main__":  # python -m scripts.get_face_models
    download_models()  # fetch YuNet + SFace into Backend/models
    print("Face models ready in", MODELS_DIR)  # confirm
