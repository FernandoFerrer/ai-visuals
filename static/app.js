const $ = (id) => document.getElementById(id);
const camera = $("camera"), overlay = $("overlay"), capture = $("capture");
const ctx = overlay.getContext("2d"), captureCtx = capture.getContext("2d");
const CAPTURE_MAX_DIMENSION = 640;
const INFERENCE_INTERVAL_MS = 20;
let masks = [], processing = false, active = false, segmentationMode = "instance", latestInference = null;
let nerdLogLines = [], nerdLogTimer = null, nerdSequence = 0, lastNerdInferenceLog = 0;
const PERSON_ALIASES = [
  "Wandering Wizard", "Dancing Goblin", "Dancefloor Angel", "Neon Witch", "Moonlit Mage",
  "Astral Wanderer", "Cosmic Oracle", "Dream Alchemist", "Midnight Seer", "Starlight Shaman",
  "Rave Goblin", "Groove Gremlin", "Disco Imp", "Rhythm Elf", "Beat Pixie", "Techno Sprite",
  "Groove Gnome", "Dancing Dryad", "Neon Angel", "Cosmic Dancer", "Lunar Spirit",
  "Galactic Pilgrim", "Astral Dancer", "Moon Child", "Wandering Soul", "Dream Walker",
  "Night Spirit", "Electric Soul", "Velvet Phantom", "Dancing Shadow", "Beat Sorcerer",
  "Bass Wizard", "Groove Prophet", "Rhythm Shaman", "Dance Alchemist", "Sonic Nomad",
  "Rhythm Oracle", "Dancefloor Entity", "Party Cryptid", "Creature of the Night",
];
let personAliasAssignments = [], labelFrame = 0;

async function loadDeviceStatus() {
  try {
    const response = await fetch("/gpu-status");
    const data = await response.json();
    if (!response.ok || !data.accelerated) throw Error(data.error || data.message || "GPU acceleration is unavailable.");
    $("deviceStatus").textContent = `GPU active: ${data.name} (${data.device}, CUDA ${data.cuda_version})`;
    $("deviceStatus").className = "device-status active";
  } catch (error) {
    $("deviceStatus").textContent = `GPU unavailable: ${error.message}`;
    $("deviceStatus").className = "device-status unavailable";
    $("startCamera").disabled = true;
  }
}

const hexToHsl = (hex) => {
  const rgb = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
  const max = Math.max(...rgb), min = Math.min(...rgb), delta = max - min;
  let hue = 0;

  if (delta) {
    const [red, green, blue] = rgb;
    hue = 60 * (max === red ? (green - blue) / delta : max === green ? (blue - red) / delta + 2 : (red - green) / delta + 4);
  }

  const lightness = (max + min) / 2;
  const saturation = delta ? delta / (1 - Math.abs(2 * lightness - 1)) : 0;
  return { hue: (hue + 360) % 360, saturation: saturation * 100, lightness: lightness * 100 };
};

const colorFromIndex = (index, total) => {
  const base = $("palette").value;
  if (index === 0 || total <= 1) return base;

  const { hue, saturation, lightness } = hexToHsl(base);
  return `hsl(${(hue + index * 360 / total) % 360} ${saturation}% ${lightness}%)`;
};

function fitCanvas() { overlay.width = camera.videoWidth; overlay.height = camera.videoHeight; }

const randomBetween = (min, max) => min + Math.random() * (max - min);

function labelForSegment(mask, points, frame) {
  const label = mask.class_name || `Class ${mask.class_id}`;
  if (label.toLowerCase() !== "person") return label;

  const now = Date.now();
  const center = points.reduce(([sumX, sumY], [x, y]) => [sumX + x, sumY + y], [0, 0])
    .map((value) => value / points.length);
  const maxMatchDistance = Math.max(90, Math.min(overlay.width, overlay.height) * 0.2);
  personAliasAssignments = personAliasAssignments.filter((assignment) => now - assignment.lastSeenAt < 5000);

  let assignment = personAliasAssignments
    .filter((candidate) => candidate.lastFrame !== frame)
    .map((candidate) => ({ candidate, distance: Math.hypot(candidate.x - center[0], candidate.y - center[1]) }))
    .filter(({ distance }) => distance <= maxMatchDistance)
    .sort((left, right) => left.distance - right.distance)[0]?.candidate;

  if (!assignment) {
    assignment = {
      x: center[0], y: center[1], lastSeenAt: now, lastFrame: frame,
      alias: "", aliasUntil: 0, nextAliasAt: now + randomBetween(7000, 14000),
    };
    personAliasAssignments.push(assignment);
  }

  assignment.x = center[0];
  assignment.y = center[1];
  assignment.lastSeenAt = now;
  assignment.lastFrame = frame;
  if (assignment.alias && now >= assignment.aliasUntil) {
    assignment.alias = "";
    assignment.nextAliasAt = now + randomBetween(7000, 14000);
  }
  if (!assignment.alias && now >= assignment.nextAliasAt) {
    const usedAliases = new Set(personAliasAssignments.map(({ alias }) => alias).filter(Boolean));
    const availableAliases = PERSON_ALIASES.filter((alias) => !usedAliases.has(alias));
    const names = availableAliases.length ? availableAliases : PERSON_ALIASES;
    assignment.alias = names[Math.floor(Math.random() * names.length)];
    assignment.aliasUntil = now + randomBetween(2500, 4500);
  }
  return assignment.alias || label;
}

function drawSegmentLabel(points, label, color) {
  const center = points.reduce(([sumX, sumY], [x, y]) => [sumX + x, sumY + y], [0, 0]);
  const [x, y] = center.map((value) => value / points.length);
  const fontSize = Math.max(11, Math.round(overlay.width * 0.012));
  ctx.font = `700 ${fontSize}px ui-monospace, SFMono-Regular, Consolas, monospace`;
  const textWidth = ctx.measureText(label).width;
  const labelX = Math.max(0, Math.min(x - textWidth / 2, overlay.width - textWidth));
  const labelY = Math.max(fontSize, Math.min(y, overlay.height));
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.fillText(label, labelX, labelY);
}

function updateNerdMode() {
  const enabled = $("nerdMode").checked;
  $("nerdOverlay").hidden = !enabled;
  if (!active) $("emptyState").style.display = enabled ? "none" : "grid";
  if (!enabled) {
    clearInterval(nerdLogTimer);
    nerdLogTimer = null;
    return;
  }

  startNerdTerminal();
}

const hexToRgbChannels = (hex) => [1, 3, 5]
  .map((start) => parseInt(hex.slice(start, start + 2), 16))
  .join(" ");

const nerdTimestamp = () => new Date().toISOString().slice(11, 23);
const ZERO_STATE_ASCII_LOGO = [
  "███████╗███████╗██████╗  ██████╗     ███████╗████████╗ █████╗ ████████╗███████╗",
  "╚══███╔╝██╔════╝██╔══██╗██╔═══██╗    ██╔════╝╚══██╔══╝██╔══██╗╚══██╔══╝██╔════╝",
  "  ███╔╝ █████╗  ██████╔╝██║   ██║    ███████╗   ██║   ███████║   ██║   █████╗",
  " ███╔╝  ██╔══╝  ██╔══██╗██║   ██║    ╚════██║   ██║   ██╔══██║   ██║   ██╔══╝",
  "███████╗███████╗██║  ██║╚██████╔╝    ███████║   ██║   ██║  ██║   ██║   ███████╗",
  "╚══════╝╚══════╝╚═╝  ╚═╝ ╚═════╝     ╚══════╝   ╚═╝   ╚═╝  ╚═╝   ╚═╝   ╚══════╝",
];

function appendTerminalText(line, text, className = "") {
  const token = document.createElement("span");
  token.textContent = text;
  if (className) token.className = className;
  line.append(token);
}

function createNerdLogLine(entry) {
  const line = document.createElement("span");
  line.className = "terminal-line";
  if (ZERO_STATE_ASCII_LOGO.includes(entry)) {
    appendTerminalText(line, entry, "terminal-ascii");
    return line;
  }
  if (entry.startsWith("//")) {
    appendTerminalText(line, entry, "terminal-comment");
    return line;
  }

  const match = entry.match(/^\[([^\]]+)] \[([^\]]+)]\s?(.*)$/);
  if (!match) {
    appendTerminalText(line, entry);
    return line;
  }

  const [, timestamp, entity, message] = match;
  const entityType = entity.split(":", 1)[0];
  appendTerminalText(line, `[${timestamp}]`, "terminal-timestamp");
  appendTerminalText(line, " ");
  appendTerminalText(line, `[${entity}]`, `terminal-tag terminal-tag--${entityType}`);
  appendTerminalText(line, " ");

  const highlightedTokens = /(Zerø State|\b(?:class|conf|device|latency|throughput|masks|classes|mode)=\S+)/g;
  let cursor = 0;
  for (const tokenMatch of message.matchAll(highlightedTokens)) {
    const index = tokenMatch.index ?? 0;
    appendTerminalText(line, message.slice(cursor, index));
    const value = tokenMatch[0];
    const tokenClass = value === "Zerø State"
      ? "terminal-author"
      : `terminal-value terminal-value--${value.split("=", 1)[0]}`;
    appendTerminalText(line, value, tokenClass);
    cursor = index + value.length;
  }
  appendTerminalText(line, message.slice(cursor));
  return line;
}

function appendNerdLogs(lines) {
  const terminal = $("nerdLogs");
  nerdLogLines.push(...lines);
  nerdLogLines = nerdLogLines.slice(-280);
  terminal.replaceChildren(...nerdLogLines.map(createNerdLogLine));
  terminal.scrollTop = terminal.scrollHeight;
}

function startNerdTerminal() {
  clearInterval(nerdLogTimer);
  nerdLogLines = [];
  nerdSequence = 0;
  lastNerdInferenceLog = 0;
  appendNerdLogs([
    ...ZERO_STATE_ASCII_LOGO,
    "",
    "// ZERO STATE / AI VISUALS TERMINAL",
    `[${nerdTimestamp()}] [boot] opening live visual terminal`,
    `[${nerdTimestamp()}] [boot] author signature: Zerø State`,
    `[${nerdTimestamp()}] [boot] loading segmentation interface`,
    `[${nerdTimestamp()}] [boot] mounting camera signal buffer`,
    `[${nerdTimestamp()}] [boot] initializing polygon compositor`,
    `[${nerdTimestamp()}] [boot] synchronizing color channels`,
    `[${nerdTimestamp()}] [boot] telemetry stream enabled`,
    "",
    `[${nerdTimestamp()}] [system] neural palette ready`,
    `[${nerdTimestamp()}] [system] experimental systems online`,
    `[${nerdTimestamp()}] [system] visual signal stable`,
    "",
    `[${nerdTimestamp()}] [zero_state] all systems enabled`,
    `[${nerdTimestamp()}] [zero_state] rendering the invisible`,
    `[${nerdTimestamp()}] [terminal] waiting for live inference…`,
  ]);
  const terminal = $("nerdLogs");
  const bootSubsystems = [
    "video ingress", "tensor cache", "class registry", "mask renderer",
    "frame scheduler", "signal analyzer", "palette controller", "telemetry bus",
  ];
  let bootLine = 1;
  while (terminal.scrollHeight <= terminal.clientHeight && bootLine <= 80) {
    const subsystem = bootSubsystems[(bootLine - 1) % bootSubsystems.length];
    appendNerdLogs([`[${nerdTimestamp()}] [boot:${String(bootLine).padStart(2, "0")}] ${subsystem} handshake acknowledged`]);
    bootLine += 1;
  }
  appendNerdLogs([""]);
  renderNerdLogs(true);
  nerdLogTimer = setInterval(() => {
    appendNerdLogs(["", `[${nerdTimestamp()}] [heartbeat] Zerø State visual engine standing by`]);
  }, 1400);
}

function renderNerdLogs(force = false) {
  if (!$("nerdMode").checked) return;
  const nowMs = Date.now();
  if (!force && nowMs - lastNerdInferenceLog < 700) return;
  lastNerdInferenceLog = nowMs;

  const now = new Date();
  const timestamp = now.toISOString().slice(11, 23);
  const info = latestInference || {};
  const detections = (info.detections || []).slice(0, 5);
  const detectionLines = detections.length
    ? detections.map((detection, index) =>
        `[${timestamp}] [detect:${String(index + 1).padStart(2, "0")}] class=${detection.class_name || `id_${detection.class_id}`} conf=${((detection.confidence || 0) * 100).toFixed(1)}%`)
    : [`[${timestamp}] [detect] awaiting objects in camera frame`];
  const mode = info.mode || segmentationMode;
  const latency = info.latency ? `${info.latency.toFixed(0)}ms` : "--ms";
  const frameRate = info.latency ? `${Math.max(1, Math.round(1000 / info.latency))} fps` : "-- fps";
  const device = info.device || "initializing";
  const acceleration = info.accelerated ? "CUDA / FP16 enabled" : "awaiting accelerator";

  $("nerdClock").textContent = timestamp;
  nerdSequence += 1;
  appendNerdLogs([
    "",
    `[${timestamp}] [frame:${String(nerdSequence).padStart(4, "0")}] ${info.width || "----"}x${info.height || "----"} mode=${mode.toUpperCase()}`,
    `[${timestamp}] [model] ${info.model || "YOLO11 segmentation"} device=${device} ${acceleration}`,
    `[${timestamp}] [inference] latency=${latency} throughput=${frameRate} masks=${(info.masks || masks).length} classes=${info.class_count ?? "--"}`,
    "",
    ...detectionLines,
    "",
    `[${timestamp}] [zero_state] polygon trace committed to visual field`,
  ]);
}

function draw() {
  if (!active) return;
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  const count = +$("colorCount").value, flash = +$("flash").value / 100;
  const pulse = 0.55 + Math.sin(Date.now() / 180) * flash * 0.45;
  const foregroundColorCount = Math.max(count - 1, 1);
  const backgroundColor = colorFromIndex(count - 1, count);
  const labels = [];
  const frame = ++labelFrame;
  const showLabels = $("showLabels").checked;

  // Reserve one palette color for pixels that are not part of an object mask.
  ctx.fillStyle = backgroundColor;
  ctx.globalAlpha = pulse * .28;
  ctx.fillRect(0, 0, overlay.width, overlay.height);

  masks.forEach((mask, index) => {
    const points = (mask.points || []).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    if (points.length < 3) return;
    const colorIndex = segmentationMode === "semantic" ? mask.class_id % foregroundColorCount : index % foregroundColorCount;
    const color = colorFromIndex(colorIndex, count);

    ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.fillStyle = color; ctx.globalAlpha = pulse * .66; ctx.fill();
    if (showLabels) labels.push({ points, color, label: labelForSegment(mask, points, frame) });
  });
  if (showLabels) labels.forEach(({ points, color, label }) => drawSegmentLabel(points, label, color));
  ctx.globalAlpha = 1; requestAnimationFrame(draw);
}

async function infer() {
  if (!active || processing || !camera.videoWidth) return;
  processing = true;
  const scale = Math.min(1, CAPTURE_MAX_DIMENSION / Math.max(camera.videoWidth, camera.videoHeight));
  capture.width = Math.round(camera.videoWidth * scale);
  capture.height = Math.round(camera.videoHeight * scale);
  captureCtx.drawImage(camera, 0, 0); 
  try {
    const startedAt = performance.now();
    const response = await fetch("/segment", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({image:capture.toDataURL("image/jpeg", .72), mode:segmentationMode, max_segments:+$("maxSegments").value}) });
    const data = await response.json();
    if (!response.ok) throw Error(data.error);
    // The smaller upload canvas avoids needless JPEG/base64 work. Restore polygon
    // coordinates to the display canvas so the overlay remains pixel-aligned.
    const xScale = overlay.width / data.width;
    const yScale = overlay.height / data.height;
    masks = data.masks.map((mask) => ({
      ...mask,
      points: mask.points.map(([x, y]) => [x * xScale, y * yScale]),
    }));
    latestInference = { ...data, latency: performance.now() - startedAt };
    renderNerdLogs();
    $("status").textContent = segmentationMode === "semantic"
      ? `${data.class_count} semantic classes detected`
      : `${masks.length} instances displayed`;
  } catch (error) { $("status").textContent = `Segmentation unavailable: ${error.message}`; }
  processing = false; setTimeout(infer, INFERENCE_INTERVAL_MS);
}

$("segmentationMode").onchange = (e) => {
  segmentationMode = e.target.value;
  masks = [];
  if (active) $("status").textContent = `Switching to ${segmentationMode} segmentation...`;
};

$("startCamera").onclick = async () => {
  if (!navigator.mediaDevices?.getUserMedia) {
    $("status").textContent = "Camera requires HTTPS or http://localhost.";
    return;
  }
  try {
    camera.srcObject = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    await camera.play(); active = true; fitCanvas(); $("emptyState").style.display = "none"; $("startCamera").textContent = "Camera running"; $("startCamera").disabled = true; $("status").textContent = "Loading segmentation model…"; draw(); infer();
  } catch (error) {
    console.error("Camera request failed:", error);
    const messages = {
      NotAllowedError: "Camera permission was blocked. Allow it in your browser's site settings, then reload.",
      NotFoundError: "No camera was found. Connect or enable one, then try again.",
      NotReadableError: "Your camera is in use by another application. Close it and try again.",
      SecurityError: "Camera requires HTTPS or http://localhost (not a local IP address).",
    };
    $("status").textContent = messages[error.name] || `Camera error: ${error.message}`;
  }
};
$("palette").oninput = (e) => $("paletteValue").textContent = e.target.value.toUpperCase();
$("colorCount").oninput = (e) => $("colorCountValue").textContent = e.target.value;
$("maxSegments").oninput = (e) => { $("maxSegmentsValue").textContent = e.target.value; };
$("flash").oninput = (e) => $("flashValue").textContent = `${e.target.value}%`;
$("nerdMode").onchange = updateNerdMode;
$("nerdBackgroundColor").oninput = (e) => {
  $("nerdBackgroundColorValue").textContent = e.target.value.toUpperCase();
  $("nerdOverlay").style.setProperty("--nerd-background-rgb", hexToRgbChannels(e.target.value));
};
$("nerdOpacity").oninput = (e) => {
  $("nerdOpacityValue").textContent = `${e.target.value}%`;
  $("nerdOverlay").style.setProperty("--nerd-background-opacity", e.target.value / 100);
};
$("logoFile").onchange = (e) => { const file=e.target.files[0]; if (file) { $("logo").src=URL.createObjectURL(file); $("logo").style.display="block"; } };
$("logoSize").oninput = (e) => { $("logo").style.width = `${e.target.value}px`; $("logoSizeValue").textContent = `${e.target.value} px`; };
$("logoPosition").onchange = (e) => { $("logo").className = e.target.value; };
$("fullscreen").onclick = () => $("stage").requestFullscreen?.();
document.addEventListener("fullscreenchange", () => {
  $("fullscreen").hidden = Boolean(document.fullscreenElement);
});
window.onresize = fitCanvas;
loadDeviceStatus();
