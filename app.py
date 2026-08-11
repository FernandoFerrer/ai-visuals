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


@app.get("/")
def index():
    return render_template("index.html")


@app.post("/segment")
def segment():
    payload = request.get_json(silent=True) or {}
    image_data = payload.get("image", "")
    if "," not in image_data:
        return jsonify(error="Expected a base64 image data URL."), 400

    try:
        encoded = base64.b64decode(image_data.split(",", 1)[1])
        frame = cv2.imdecode(np.frombuffer(encoded, np.uint8), cv2.IMREAD_COLOR)
        if frame is None:
            raise ValueError("The image could not be decoded.")

        result = get_model()(frame, verbose=False)[0]
        polygons = []
        if result.masks is not None:
            for index, points in enumerate(result.masks.xy):
                polygons.append({
                    "points": np.asarray(points).round(1).tolist(),
                    "class_id": int(result.boxes.cls[index]),
                })
        return jsonify(width=int(frame.shape[1]), height=int(frame.shape[0]), masks=polygons)
    except Exception as error:
        return jsonify(error=str(error)), 503


if __name__ == "__main__":
    app.run(debug=True)
