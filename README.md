# AI Visuals

Minimal web interface for live YOLO instance segmentation.

## Run locally

1. Install Python 3.10 or newer.
2. Create and activate a virtual environment.
3. Install dependencies: `pip install -r requirements.txt`
4. Start the app: `python app.py`
5. Open `http://127.0.0.1:5000` and allow camera access.

The first inference downloads the default `yolo11n-seg.pt` model. Set `YOLO_MODEL` to use a different Ultralytics segmentation checkpoint.

## GPU acceleration

The app requires the first CUDA GPU by default (`cuda:0`) and uses FP16 inference for faster segmentation. It fails clearly instead of silently falling back to CPU when CUDA is unavailable. To choose a device explicitly, set `YOLO_DEVICE` (for example, `cuda:0`, `cuda:1`, or `cpu`); use `cpu` only when CPU inference is intentional. The interface displays the active GPU and CUDA version before the camera starts.

PyTorch must be installed with CUDA support for GPU acceleration. This project uses Python 3.12 so it can use the CUDA 12.1 PyTorch wheel supported by older NVIDIA drivers. Follow the [PyTorch installation selector](https://pytorch.org/get-started/locally/) to install the wheel that matches your NVIDIA driver and CUDA runtime, then restart the app.

The browser downsizes camera frames to a 640px maximum dimension before JPEG upload; Flask returns mask polygons, which the browser scales back to the display and renders in the chosen palette. This avoids spending CPU and bandwidth on camera pixels YOLO would discard during preprocessing.

For a faster long-running installation, the default inference size is 512 pixels (instead of Ultralytics' 640px default). On the bundled `yolo11n-seg` model this is a useful speed/quality balance. Set `YOLO_IMGSZ=640` to prioritize mask detail, or another multiple of 32 between 320 and 1280. The app now runs without Flask's debugger/reloader unless `FLASK_DEBUG=1` is explicitly set; restart it after updating.

Use the **Segments to display** control to limit the number of returned mask regions (1–20). This lets you show more than the previous one or two detected regions when they are present in the frame.
