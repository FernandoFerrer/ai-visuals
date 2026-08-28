from __future__ import annotations

import base64
import os
from functools import lru_cache

import cv2
import numpy as np
from flask import Flask, jsonify, render_template, request


app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 6 * 1024 * 1024


def inference_image_size() -> int:
    """Return a safe model input size aligned to the network stride."""
    try:
        requested_size = int(os.getenv("YOLO_IMGSZ", "512"))
    except ValueError:
        requested_size = 512
    return max(320, min(requested_size // 32 * 32, 1280))


def inference_device() -> tuple[str, bool]:
    """Return the configured inference device, requiring CUDA unless CPU is explicit."""
    requested_device = os.getenv("YOLO_DEVICE", "cuda:0").strip().lower()
    if requested_device != "auto":
        if requested_device.isdigit():
            requested_device = f"cuda:{requested_device}"
        if requested_device == "cpu":
            return requested_device, False

        import torch

        if not torch.cuda.is_available():
            raise RuntimeError(
                "CUDA was requested, but PyTorch cannot access an NVIDIA GPU. "
                "Install a CUDA-enabled PyTorch build or set YOLO_DEVICE=cpu explicitly."
            )
        return requested_device, True

    import torch

    if not torch.cuda.is_available():
        raise RuntimeError(
            "CUDA is required by default, but PyTorch cannot access an NVIDIA GPU. "
            "Set YOLO_DEVICE=cpu only if CPU inference is intended."
        )
    return "cuda:0", True


@lru_cache(maxsize=1)
def get_model():
    """Load once, only when the first camera frame arrives."""
    from ultralytics import YOLO

    model = YOLO(os.getenv("YOLO_MODEL", "yolo11n-seg.pt"))
    device, _ = inference_device()
    model.to(device)
    return model


def semantic_polygons(instance_polygons: list[dict], frame_shape: tuple[int, ...], class_names: dict[int, str]) -> list[dict]:
    """Merge instance masks into one or more regions per detected class."""
    height, width = frame_shape[:2]
    class_masks: dict[int, np.ndarray] = {}

    for polygon in instance_polygons:
        class_id = polygon["class_id"]
        mask = class_masks.setdefault(class_id, np.zeros((height, width), dtype=np.uint8))
        points = np.asarray(polygon["points"], dtype=np.int32)
        if len(points) >= 3:
            cv2.fillPoly(mask, [points], 255)

    regions = []
    for class_id, mask in class_masks.items():
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            if len(contour) >= 3:
                regions.append({
                    "points": contour.reshape(-1, 2).astype(float).tolist(),
                    "class_id": class_id,
                    "class_name": class_names[class_id],
                })
    return regions


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/gpu-status")
def gpu_status():
    """Report the device that will be used before the camera starts."""
    try:
        device, accelerated = inference_device()
        if not accelerated:
            return jsonify(device=device, accelerated=False, message="CPU inference selected explicitly.")

        import torch

        device_index = int(device.split(":", 1)[1]) if ":" in device else 0
        return jsonify(
            device=device,
            accelerated=True,
            name=torch.cuda.get_device_name(device_index),
            cuda_version=torch.version.cuda,
        )
    except Exception as error:
        return jsonify(device="unavailable", accelerated=False, error=str(error)), 503


@app.post("/segment")
def segment():
    payload = request.get_json(silent=True) or {}
    image_data = payload.get("image", "")
    mode = payload.get("mode", "instance")
    max_segments = payload.get("max_segments", 8)
    if "," not in image_data:
        return jsonify(error="Expected a base64 image data URL."), 400
    if mode not in {"instance", "semantic"}:
        return jsonify(error="Mode must be 'instance' or 'semantic'."), 400
    try:
        max_segments = max(1, min(int(max_segments), 50))
    except (TypeError, ValueError):
        return jsonify(error="max_segments must be a number between 1 and 50."), 400

    try:
        encoded = base64.b64decode(image_data.split(",", 1)[1])
        frame = cv2.imdecode(np.frombuffer(encoded, np.uint8), cv2.IMREAD_COLOR)
        if frame is None:
            raise ValueError("The image could not be decoded.")

        device, use_half_precision = inference_device()
        result = get_model()(
            frame,
            device=device,
            half=use_half_precision,
            imgsz=inference_image_size(),
            max_det=max_segments,
            verbose=False,
        )[0]
        instance_polygons = []
        if result.masks is not None:
            for index, points in enumerate(result.masks.xy):
                class_id = int(result.boxes.cls[index])
                instance_polygons.append({
                    "points": np.asarray(points).round(1).tolist(),
                    "class_id": class_id,
                    "class_name": result.names[class_id],
                    "confidence": round(float(result.boxes.conf[index]), 4),
                })
        class_names = {class_id: str(name) for class_id, name in result.names.items()}
        masks = semantic_polygons(instance_polygons, frame.shape, class_names) if mode == "semantic" else instance_polygons
        masks = masks[:max_segments]
        # The client already receives polygon points in ``masks``. Nerd Mode
        # only needs these three fields, so do not send a second copy of every
        # polygon in ``detections``.
        detections = [
            {key: polygon[key] for key in ("class_id", "class_name", "confidence")}
            for polygon in instance_polygons[:max_segments]
        ]
        return jsonify(width=int(frame.shape[1]), height=int(frame.shape[0]), masks=masks, mode=mode,
                       class_count=len({mask["class_id"] for mask in masks}), device=device,
                       accelerated=use_half_precision, model=os.getenv("YOLO_MODEL", "yolo11n-seg.pt"),
                       imgsz=inference_image_size(),
                       detections=detections)
    except Exception as error:
        return jsonify(error=str(error)), 503


if __name__ == "__main__":
    # The debugger/reloader creates extra processes and is unsuitable for a long-running visual.
    app.run(debug=os.getenv("FLASK_DEBUG", "").lower() in {"1", "true", "yes"})
