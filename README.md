# AI Visuals

Minimal web interface for live YOLO instance segmentation.

## Run locally

1. Install Python 3.10 or newer.
2. Create and activate a virtual environment.
3. Install dependencies: `pip install -r requirements.txt`
4. Start the app: `python app.py`
5. Open `http://127.0.0.1:5000` and allow camera access.

The first inference downloads the default `yolo11n-seg.pt` model. Set `YOLO_MODEL` to use a different Ultralytics segmentation checkpoint.

The browser sends reduced JPEG frames to Flask; the server returns mask polygons, which the browser renders in the chosen palette. This keeps the UI responsive while the Python side owns ML inference.
