const $ = (id) => document.getElementById(id);
const camera = $("camera"), stage = $("hiveStage"), canvas = $("hiveCanvas"), capture = $("capture");
const ctx = canvas.getContext("2d"), captureCtx = capture.getContext("2d");
const CAPTURE_MAX_DIMENSION = 640;
const INACTIVE = [52, 56, 50], ACCENTS = [[231, 226, 214], [200, 169, 107], [169, 121, 66], [101, 135, 131]];

let active = false, processing = false, sourceMasks = [], cells = [];
let canvasWidth = 0, canvasHeight = 0, pixelRatio = 1, hexPath = null, hexRadius = 0;
let beeCountHistory = Array(24).fill(0);
let latestInference = null, hiveLogLines = [], hiveLogTimer = null, hiveLogSequence = 0, lastHiveLogAt = 0;

function hiveTimestamp(date = new Date()) {
  const pad = (value, length = 2) => String(value).padStart(length, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

function createHiveLogLine(entry) {
  const line = document.createElement("span");
  line.className = "hive-log";
  const match = entry.match(/^\[([^\]]+)] \[([^\]]+)]\s?(.*)$/);
  if (!match) { line.textContent = entry; return line; }
  const [, timestamp, tag, message] = match;
  const time = document.createElement("span");
  time.className = "hive-log__time";
  time.textContent = `[${timestamp}]`;
  const label = document.createElement("span");
  label.className = `hive-log__tag hive-log__tag--${tag.split(":", 1)[0]}`;
  label.textContent = ` [${tag}]`;
  line.append(time, label, document.createTextNode(` ${message}`));
  return line;
}

function appendHiveLogs(lines) {
  const terminal = $("hiveNerdLogs");
  hiveLogLines.push(...lines);
  hiveLogLines = hiveLogLines.slice(-80);
  terminal.replaceChildren(...hiveLogLines.map(createHiveLogLine));
  terminal.scrollTop = terminal.scrollHeight;
}

function startHiveLogs() {
  clearInterval(hiveLogTimer);
  hiveLogLines = [];
  hiveLogSequence = 0;
  lastHiveLogAt = 0;
  const timestamp = hiveTimestamp();
  appendHiveLogs([
    `[${timestamp}] [boot] opening live visual terminal`,
    `[${timestamp}] [boot] author signature: Zerø State`,
    `[${timestamp}] [boot] loading segmentation interface`,
    `[${timestamp}] [boot] mounting camera signal buffer`,
    `[${timestamp}] [boot] initializing polygon compositor`,
    `[${timestamp}] [system] neural palette ready`,
    `[${timestamp}] [system] visual signal stable`,
    `[${timestamp}] [zero_state] all systems enabled`,
    `[${timestamp}] [terminal] waiting for live inference…`,
  ]);
  hiveLogTimer = setInterval(() => {
    appendHiveLogs([`[${hiveTimestamp()}] [heartbeat] Zerø State visual engine standing by`]);
  }, 1800);
}

function renderHiveLogs(force = false) {
  if (!$("hiveNerdMode").checked) return;
  const now = Date.now();
  if (!force && now - lastHiveLogAt < 700) return;
  lastHiveLogAt = now;
  const timestamp = hiveTimestamp();
  const info = latestInference || {};
  const detections = (info.detections || []).slice(0, 5);
  const detectionLines = detections.length
    ? detections.map((detection, index) => `[${timestamp}] [detect:${String(index + 1).padStart(2, "0")}] class=${detection.class_name || `id_${detection.class_id}`} conf=${((detection.confidence || 0) * 100).toFixed(1)}%`)
    : [`[${timestamp}] [detect] awaiting objects in camera frame`];
  const latency = info.latency ? `${info.latency.toFixed(0)}ms` : "--ms";
  const throughput = info.latency ? `${Math.max(1, Math.round(1000 / info.latency))} fps` : "-- fps";
  hiveLogSequence += 1;
  appendHiveLogs([
    `[${timestamp}] [frame:${String(hiveLogSequence).padStart(4, "0")}] ${info.width || "----"}x${info.height || "----"} mode=${(info.mode || "instance").toUpperCase()}`,
    `[${timestamp}] [model] ${info.model || "YOLO11 segmentation"} device=${info.device || "initializing"}`,
    `[${timestamp}] [inference] latency=${latency} throughput=${throughput} masks=${sourceMasks.length} classes=${info.class_count ?? "--"}`,
    ...detectionLines,
    `[${timestamp}] [zero_state] polygon trace committed to visual field`,
  ]);
}

function updateNerdTelemetry() {
  if (!$("hiveNerdMode").checked) return;
  const beeCount = sourceMasks.length;
  beeCountHistory = [...beeCountHistory.slice(-23), beeCount];
  const highest = Math.max(...beeCountHistory, 1);
  const points = beeCountHistory.map((count, index) => {
    const x = index / (beeCountHistory.length - 1) * 184;
    const y = 47 - count / highest * 38;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  $("hiveBeeChart").setAttribute("points", points);
  $("hiveBeeCount").textContent = beeCount;
  $("hiveBeeStatus").textContent = active ? (beeCount ? "TRACKING" : "SCANNING") : "IDLE";
}

function profileFor(mask, areaRatio) {
  // A small integer hash gives every YOLO class a repeatable visual character.
  const hash = ((mask.class_id + 1) * 1103515245 + 12345) >>> 0;
  const unit = (shift) => ((hash >>> shift) & 255) / 255;
  const isPerson = String(mask.class_name).toLowerCase() === "person";
  const large = Math.min(1, areaRatio * 5);
  const accentIndex = Math.floor(unit(0) * ACCENTS.length);
  return {
    color: ACCENTS[accentIndex],
    flowColor: ACCENTS[(accentIndex + 1 + ((hash >>> 28) % 2)) % ACCENTS.length],
    maxScale: (isPerson ? 0.22 : 0.16 + unit(8) * 0.15) * (0.92 + large * 0.16),
    radius: (isPerson ? 135 : 72 + unit(16) * 108) * (0.82 + large * 0.55),
    frequency: isPerson ? 0.22 : 0.45 + unit(24) * 0.7,
    waveLength: 72 + unit(4) * 105,
    waveSpeed: isPerson ? 0.55 : 0.9 + unit(20) * 1.4,
    response: 0.75 + unit(12) * 0.25,
  };
}

function makeHexPath(radius) {
  const path = new Path2D();
  for (let point = 0; point < 6; point += 1) {
    const angle = Math.PI / 3 * point + Math.PI / 6;
    const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
    if (point) path.lineTo(x, y); else path.moveTo(x, y);
  }
  path.closePath();
  return path;
}

function rebuildGrid() {
  const size = +$("hexSize").value;
  hexRadius = size / 2;
  hexPath = makeHexPath(hexRadius * 0.86);
  cells = [];
  const xStep = Math.sqrt(3) * hexRadius;
  const yStep = hexRadius * 1.5;
  let row = 0;
  for (let y = hexRadius; y < canvasHeight + hexRadius; y += yStep, row += 1) {
    const offset = row % 2 ? xStep / 2 : 0;
    for (let x = hexRadius + offset; x < canvasWidth + hexRadius; x += xStep) {
      cells.push({
        x, y, phase: (x * 0.018 + y * 0.012) % (Math.PI * 2),
        activation: 0, targetActivation: 0, scale: 1, targetScale: 1,
        color: INACTIVE.slice(), targetColor: INACTIVE.slice(), flowColor: INACTIVE.slice(), targetFlowColor: INACTIVE.slice(), frequency: 0.3, targetFrequency: 0.3,
        waveSpeed: 0.4, targetWaveSpeed: 0.4, wavePhase: 0, targetWavePhase: 0,
      });
    }
  }
  updateCellTargets();
}

function fitStage() {
  const bounds = stage.getBoundingClientRect();
  const width = Math.max(1, Math.round(bounds.width)), height = Math.max(1, Math.round(bounds.height));
  const nextRatio = Math.min(window.devicePixelRatio || 1, 2);
  if (width === canvasWidth && height === canvasHeight && nextRatio === pixelRatio) return;
  canvasWidth = width; canvasHeight = height; pixelRatio = nextRatio;
  canvas.width = Math.round(width * pixelRatio); canvas.height = Math.round(height * pixelRatio);
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  rebuildGrid();
}

function projectMasks() {
  if (!camera.videoWidth || !camera.videoHeight) return [];
  const scale = Math.max(canvasWidth / camera.videoWidth, canvasHeight / camera.videoHeight);
  const offsetX = (canvasWidth - camera.videoWidth * scale) / 2;
  const offsetY = (canvasHeight - camera.videoHeight * scale) / 2;
  return sourceMasks.map((mask) => {
    // YOLO contours can contain many nearly identical points. Retaining a
    // bounded, evenly-spaced contour keeps interaction checks smooth without
    // touching pixels or changing the inference result.
    const stride = Math.max(1, Math.ceil(mask.points.length / 180));
    const points = [];
    for (let index = 0; index < mask.points.length; index += stride) {
      const [x, y] = mask.points[index];
      points.push([x * scale + offsetX, y * scale + offsetY]);
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of points) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
    const area = Math.max(1, (maxX - minX) * (maxY - minY));
    return { points, minX, minY, maxX, maxY, profile: profileFor(mask, area / (canvasWidth * canvasHeight)) };
  });
}

function pointInPolygon(x, y, points) {
  let inside = false;
  for (let current = 0, previous = points.length - 1; current < points.length; previous = current++) {
    const [xi, yi] = points[current], [xj, yj] = points[previous];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distanceToPolygon(x, y, points) {
  let nearest = Infinity;
  for (let current = 0, previous = points.length - 1; current < points.length; previous = current++) {
    const [ax, ay] = points[previous], [bx, by] = points[current];
    const dx = bx - ax, dy = by - ay, length = dx * dx + dy * dy;
    const ratio = length ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length)) : 0;
    const px = ax + dx * ratio, py = ay + dy * ratio;
    nearest = Math.min(nearest, Math.hypot(x - px, y - py));
  }
  return nearest;
}

function updateCellTargets() {
  if (!cells.length) return;
  const masks = projectMasks(), radiusControl = +$("interactionRadius").value / 100;
  const intensity = +$("intensity").value / 100;
  for (const cell of cells) {
    cell.targetActivation = 0; cell.targetScale = 1; cell.targetColor = INACTIVE; cell.targetFlowColor = INACTIVE; cell.targetFrequency = 0.3;
    cell.targetWaveSpeed = 0.4; cell.targetWavePhase = 0;
    for (const mask of masks) {
      const profile = mask.profile, radius = profile.radius * radiusControl;
      if (cell.x < mask.minX - radius || cell.x > mask.maxX + radius || cell.y < mask.minY - radius || cell.y > mask.maxY + radius) continue;
      const inside = cell.x >= mask.minX && cell.x <= mask.maxX && cell.y >= mask.minY && cell.y <= mask.maxY && pointInPolygon(cell.x, cell.y, mask.points);
      const distance = inside ? 0 : distanceToPolygon(cell.x, cell.y, mask.points);
      if (!inside && distance >= radius) continue;
      const falloff = inside ? 1 : Math.pow(1 - distance / radius, 2);
      const activation = Math.min(1, falloff * profile.response * intensity);
      if (activation > cell.targetActivation) {
        cell.targetActivation = activation;
        cell.targetScale = 1 + activation * profile.maxScale * intensity;
        cell.targetColor = profile.color;
        cell.targetFlowColor = profile.flowColor;
        cell.targetFrequency = profile.frequency;
        cell.targetWaveSpeed = profile.waveSpeed;
        cell.targetWavePhase = distance / profile.waveLength;
      }
    }
  }
}

function render(now) {
  fitStage();
  const speed = +$("animationSpeed").value;
  const gradientFlow = +$("gradientFlow").value / 100;
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  const rise = 0.07 * speed, rest = 0.025 * speed;
  for (const cell of cells) {
    const easing = cell.targetActivation > cell.activation ? rise : rest;
    cell.activation += (cell.targetActivation - cell.activation) * easing;
    cell.scale += (cell.targetScale - cell.scale) * easing;
    cell.frequency += (cell.targetFrequency - cell.frequency) * easing;
    cell.waveSpeed += (cell.targetWaveSpeed - cell.waveSpeed) * easing;
    cell.wavePhase += (cell.targetWavePhase - cell.wavePhase) * easing;
    cell.color[0] += (cell.targetColor[0] - cell.color[0]) * easing;
    cell.color[1] += (cell.targetColor[1] - cell.color[1]) * easing;
    cell.color[2] += (cell.targetColor[2] - cell.color[2]) * easing;
    cell.flowColor[0] += (cell.targetFlowColor[0] - cell.flowColor[0]) * easing;
    cell.flowColor[1] += (cell.targetFlowColor[1] - cell.flowColor[1]) * easing;
    cell.flowColor[2] += (cell.targetFlowColor[2] - cell.flowColor[2]) * easing;
    const breathing = Math.sin(now * 0.001 * cell.waveSpeed * Math.PI * 2 * speed - cell.wavePhase + cell.phase * cell.frequency) * cell.activation * 0.018;
    const scale = cell.scale + breathing;
    const flow = cell.activation * gradientFlow * (0.14 + (0.5 + 0.5 * Math.sin(now * 0.001 * cell.waveSpeed * Math.PI * 2 * speed - cell.wavePhase * 1.35 + cell.phase * 0.8)) * 0.46);
    const red = cell.color[0] + (cell.flowColor[0] - cell.color[0]) * flow;
    const green = cell.color[1] + (cell.flowColor[1] - cell.color[1]) * flow;
    const blue = cell.color[2] + (cell.flowColor[2] - cell.color[2]) * flow;
    ctx.save(); ctx.translate(cell.x, cell.y); ctx.scale(scale, scale);
    ctx.strokeStyle = `rgb(${red | 0} ${green | 0} ${blue | 0})`;
    ctx.globalAlpha = 0.28 + cell.activation * 0.52;
    ctx.lineWidth = 0.75 + cell.activation * 0.45;
    ctx.stroke(hexPath); ctx.restore();
  }
  ctx.globalAlpha = 1;
  requestAnimationFrame(render);
}

async function loadDeviceStatus() {
  try {
    const response = await fetch("/gpu-status"), data = await response.json();
    if (!response.ok || !data.accelerated) throw Error(data.error || data.message || "GPU acceleration is unavailable.");
    $("deviceStatus").textContent = `GPU active: ${data.name} (${data.device}, CUDA ${data.cuda_version})`;
    $("deviceStatus").className = "device-status active";
  } catch (error) {
    $("deviceStatus").textContent = `GPU unavailable: ${error.message}`;
    $("deviceStatus").className = "device-status unavailable";
    $("startCamera").disabled = true;
  }
}

async function infer() {
  if (!active || processing || !camera.videoWidth) return;
  processing = true;
  const scale = Math.min(1, CAPTURE_MAX_DIMENSION / Math.max(camera.videoWidth, camera.videoHeight));
  capture.width = Math.round(camera.videoWidth * scale); capture.height = Math.round(camera.videoHeight * scale);
  captureCtx.drawImage(camera, 0, 0, capture.width, capture.height);
  try {
    const startedAt = performance.now();
    const response = await fetch("/segment", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: capture.toDataURL("image/jpeg", 0.72), mode: "instance", max_segments: 12 }) });
    const data = await response.json();
    if (!response.ok) throw Error(data.error);
    const xScale = camera.videoWidth / data.width, yScale = camera.videoHeight / data.height;
    sourceMasks = data.masks.map((mask) => ({ ...mask, points: mask.points.map(([x, y]) => [x * xScale, y * yScale]) }));
    latestInference = { ...data, latency: performance.now() - startedAt };
    updateCellTargets();
    updateNerdTelemetry();
    renderHiveLogs();
    $("status").textContent = sourceMasks.length ? `${sourceMasks.length} object${sourceMasks.length === 1 ? "" : "s"} shaping the field` : "The field is at rest";
  } catch (error) { $("status").textContent = `Segmentation unavailable: ${error.message}`; }
  processing = false;
  setTimeout(infer, 0);
}

$("startCamera").onclick = async () => {
  if (!navigator.mediaDevices?.getUserMedia) { $("status").textContent = "Camera requires HTTPS or http://localhost."; return; }
  try {
    camera.srcObject = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    await camera.play(); active = true; fitStage(); $("emptyState").style.display = "none";
    $("startCamera").textContent = "Camera running"; $("startCamera").disabled = true; $("status").textContent = "Listening to the field..."; infer();
  } catch (error) {
    const messages = { NotAllowedError: "Camera permission was blocked. Allow it in your browser's site settings, then reload.", NotFoundError: "No camera was found. Connect or enable one, then try again.", NotReadableError: "Your camera is in use by another application. Close it and try again.", SecurityError: "Camera requires HTTPS or http://localhost (not a local IP address)." };
    $("status").textContent = messages[error.name] || `Camera error: ${error.message}`;
  }
};

$("hexSize").oninput = (event) => { $("hexSizeValue").textContent = `${event.target.value} px`; rebuildGrid(); };
$("intensity").oninput = (event) => { $("intensityValue").textContent = `${event.target.value}%`; updateCellTargets(); };
$("gradientFlow").oninput = (event) => { $("gradientFlowValue").textContent = `${event.target.value}%`; };
$("interactionRadius").oninput = (event) => { $("interactionRadiusValue").textContent = `${event.target.value}%`; updateCellTargets(); };
$("animationSpeed").oninput = (event) => { $("animationSpeedValue").textContent = `${(+event.target.value).toFixed(1)}×`; };
$("cameraOpacity").oninput = (event) => { $("cameraOpacityValue").textContent = `${event.target.value}%`; camera.style.opacity = event.target.value / 100; };
$("hiveNerdMode").onchange = (event) => {
  $("hiveNerd").hidden = !event.target.checked;
  clearInterval(hiveLogTimer);
  if (event.target.checked) {
    beeCountHistory = Array(24).fill(0);
    updateNerdTelemetry();
    startHiveLogs();
    renderHiveLogs(true);
  }
};
$("fullscreen").onclick = () => stage.requestFullscreen?.();

new ResizeObserver(fitStage).observe(stage);
document.addEventListener("fullscreenchange", fitStage);
camera.style.opacity = 0.28;
fitStage(); requestAnimationFrame(render); loadDeviceStatus();
