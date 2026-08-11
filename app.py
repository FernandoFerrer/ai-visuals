from __future__ import annotations

import base64
import os
from functools import lru_cache

import cv2
import numpy as np
from flask import Flask, jsonify, render_template, request


app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 6 * 1024 * 1024


@lru_cache(maxsize=1)
def get_model():
    """Load once, only when the first camera frame arrives."""
    from ultralytics import YOLO

    return YOLO(os.getenv("YOLO_MODEL", "yolo11n-seg.pt"))


def semantic_polygons(instance_polygons: list[dict], frame_shape: tuple[int, ...]) -> list[dict]:
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
                regions.append({"points": contour.reshape(-1, 2).astype(float).tolist(), "class_id": class_id})
    return regions


@app.get("/")
def index():
    return render_template("index.html")


@app.post("/segment")
def segment():
    payload = request.get_json(silent=True) or {}
    image_data = payload.get("image", "")
    mode = payload.get("mode", "instance")
    if "," not in image_data:
        return jsonify(error="Expected a base64 image data URL."), 400
    if mode not in {"instance", "semantic"}:
        return jsonify(error="Mode must be 'instance' or 'semantic'."), 400

    try:
        encoded = base64.b64decode(image_data.split(",", 1)[1])
        frame = cv2.imdecode(np.frombuffer(encoded, np.uint8), cv2.IMREAD_COLOR)
        if frame is None:
            raise ValueError("The image could not be decoded.")

        result = get_model()(frame, verbose=False)[0]
        instance_polygons = []
        if result.masks is not None:
            for index, points in enumerate(result.masks.xy):
                instance_polygons.append({
                    "points": np.asarray(points).round(1).tolist(),
                    "class_id": int(result.boxes.cls[index]),
                })
        masks = semantic_polygons(instance_polygons, frame.shape) if mode == "semantic" else instance_polygons
        return jsonify(width=int(frame.shape[1]), height=int(frame.shape[0]), masks=masks, mode=mode,
                       class_count=len({mask["class_id"] for mask in masks}))
    except Exception as error:
        return jsonify(error=str(error)), 503


if __name__ == "__main__":
    app.run(debug=True)
