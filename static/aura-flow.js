const $ = (id) => document.getElementById(id);
const stage = $("stage"), camera = $("camera"), capture = $("capture"), auraCanvas = $("auraCanvas");
const aura = auraCanvas.getContext("2d"), captureContext = capture.getContext("2d");
const CAPTURE_MAX_DIMENSION = 640;
const PALETTES = {
  seaglass: ["#7FCFC2", "#A7A1C6", "#D7A0AA", "#D6B57A"],
  dusk: ["#A7A1C6", "#D7A0AA", "#7FCFC2", "#D6B57A"],
  amber: ["#D6B57A", "#D7A0AA", "#A7A1C6", "#7FCFC2"],
};
let active = false, processing = false, tracks = [], nextTrackId = 1;
let stageWidth = 1, stageHeight = 1, pixelRatio = 1, lastAmbient = 0;

function controls() {
  return {
    colors: PALETTES[$("palette").value],
    intensity: +$("auraIntensity").value / 100,
    interaction: +$("interaction").value / 100,
    persistence: +$("persistence").value / 100,
    maxSegments: +$("maxSegments").value,
  };
}

function hexColor(hex) {
  return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
}

function fluidColor(hex) {
  const color = hexColor(hex);
  return { r: color.r / 255 * 1.1, g: color.g / 255 * 1.1, b: color.b / 255 * 1.1 };
}

function fitStage() {
  const bounds = stage.getBoundingClientRect();
  const nextWidth = Math.max(1, Math.round(bounds.width)), nextHeight = Math.max(1, Math.round(bounds.height));
  const nextRatio = Math.min(window.devicePixelRatio || 1, 2);
  if (nextWidth === stageWidth && nextHeight === stageHeight && nextRatio === pixelRatio) return;
  stageWidth = nextWidth; stageHeight = nextHeight; pixelRatio = nextRatio;
  auraCanvas.width = stageWidth * pixelRatio; auraCanvas.height = stageHeight * pixelRatio;
  aura.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  window.AuraFluid?.resize();
}

function cameraPoint(x, y) {
  const scale = Math.max(stageWidth / camera.videoWidth, stageHeight / camera.videoHeight);
  return { x: x * scale + (stageWidth - camera.videoWidth * scale) / 2, y: y * scale + (stageHeight - camera.videoHeight * scale) / 2 };
}

function polygonArea(points) {
  let sum = 0;
  for (let index = 0; index < points.length; index++) {
    const [x1, y1] = points[index], [x2, y2] = points[(index + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

function centroid(points) {
  let signedArea = 0, x = 0, y = 0;
  for (let index = 0; index < points.length; index++) {
    const [x1, y1] = points[index], [x2, y2] = points[(index + 1) % points.length];
    const cross = x1 * y2 - x2 * y1;
    signedArea += cross; x += (x1 + x2) * cross; y += (y1 + y2) * cross;
  }
  if (Math.abs(signedArea) < .001) {
    const total = points.reduce((value, point) => ({ x: value.x + point[0], y: value.y + point[1] }), { x: 0, y: 0 });
    return { x: total.x / points.length, y: total.y / points.length };
  }
  return { x: x / (3 * signedArea), y: y / (3 * signedArea) };
}

function objectFromMask(mask) {
  const points = mask.points.map(([x, y]) => {
    const point = cameraPoint(x, y);
    return [point.x, point.y];
  });
  const center = centroid(points), area = polygonArea(points);
  const radius = Math.max(.07, Math.min(.30, .07 + Math.sqrt(area) / Math.min(stageWidth, stageHeight) * .18));
  return { points, center, area, radius, classId: mask.class_id, className: mask.class_name };
}

function updateTracks(masks) {
  const now = performance.now(), remaining = new Set(tracks.filter((track) => track.age < 1600));
  for (const object of masks.map(objectFromMask)) {
    let match = null, nearest = Math.min(stageWidth, stageHeight) * .24;
    for (const track of remaining) {
      const distance = Math.hypot(track.targetX - object.center.x, track.targetY - object.center.y);
      if (distance < nearest && (track.classId === object.classId || distance < nearest * .58)) { nearest = distance; match = track; }
    }
    if (!match) {
      match = { id: nextTrackId++, x: object.center.x, y: object.center.y, targetX: object.center.x, targetY: object.center.y, points: object.points, targetPoints: object.points, radius: object.radius, targetRadius: object.radius, vx: 0, vy: 0, age: 0, opacity: 0, lastSeen: now, lastSplat: 0, classId: object.classId, className: object.className };
      tracks.push(match);
    } else {
      const elapsed = Math.max(.08, (now - match.lastSeen) / 1000);
      const observedX = (object.center.x - match.targetX) / elapsed, observedY = (object.center.y - match.targetY) / elapsed;
      match.vx += (observedX - match.vx) * .32;
      match.vy += (observedY - match.vy) * .32;
    }
    remaining.delete(match);
    match.targetX = object.center.x; match.targetY = object.center.y; match.targetPoints = object.points;
    match.targetRadius = object.radius; match.classId = object.classId; match.className = object.className;
    match.lastSeen = now; match.age = 0;
  }
  $("status").textContent = masks.length ? `${masks.length} presence${masks.length === 1 ? "" : "s"} shaping the field` : "The field is at rest";
}

function drawAura(track, now, cfg) {
  if (!track.targetPoints?.length) return;
  const offsetX = track.x - track.targetX, offsetY = track.y - track.targetY;
  const path = new Path2D();
  track.targetPoints.forEach(([x, y], index) => index ? path.lineTo(x + offsetX, y + offsetY) : path.moveTo(x + offsetX, y + offsetY));
  path.closePath();
  const speed = Math.hypot(track.vx, track.vy), directionX = speed > 1 ? track.vx / speed : Math.cos(now * .00018 + track.id), directionY = speed > 1 ? track.vy / speed : Math.sin(now * .00018 + track.id);
  const palette = cfg.colors, colorIndex = (track.id - 1) % palette.length;
  const first = hexColor(palette[colorIndex]), second = hexColor(palette[(colorIndex + 1) % palette.length]), third = hexColor(palette[(colorIndex + 2) % palette.length]);
  const spread = Math.max(60, track.radius * Math.min(stageWidth, stageHeight) * 2.5);
  const gradient = aura.createLinearGradient(track.x - directionX * spread, track.y - directionY * spread, track.x + directionX * spread, track.y + directionY * spread);
  gradient.addColorStop(0, `rgb(${first.r} ${first.g} ${first.b} / .18)`);
  gradient.addColorStop(.52, `rgb(${second.r} ${second.g} ${second.b} / .10)`);
  gradient.addColorStop(1, `rgb(${third.r} ${third.g} ${third.b} / .03)`);
  aura.save();
  aura.globalAlpha = cfg.intensity * track.opacity * .62;
  aura.filter = `blur(${Math.max(8, Math.min(24, track.radius * 65))}px)`;
  aura.fillStyle = gradient; aura.fill(path);
  aura.restore();
  aura.save();
  aura.clip(path);
  aura.globalAlpha = cfg.intensity * track.opacity * (speed > 100 ? 1.1 : .78);
  aura.fillStyle = gradient; aura.fillRect(0, 0, stageWidth, stageHeight);
  aura.restore();
}

function injectFluid(track, now, cfg) {
  const speed = Math.hypot(track.vx, track.vy);
  if (speed < 10 || now - track.lastSplat < 86) return;
  const color = fluidColor(cfg.colors[(track.id - 1) % cfg.colors.length]);
  const force = Math.min(720, speed * (1.5 + cfg.interaction * 3.8));
  const directionX = track.vx / speed, directionY = track.vy / speed;
  const x = Math.max(0, Math.min(1, track.x / stageWidth)), y = Math.max(0, Math.min(1, 1 - track.y / stageHeight));
  window.AuraFluid?.splat(x, y, directionX * force, -directionY * force, color, track.radius * (.7 + cfg.interaction * .6));
  if (speed > 170) {
    const leadingX = Math.max(0, Math.min(1, x + directionX * track.radius * .42)), leadingY = Math.max(0, Math.min(1, y - directionY * track.radius * .42));
    window.AuraFluid?.splat(leadingX, leadingY, directionX * force * .32, -directionY * force * .32, color, track.radius * .58);
  }
  track.lastSplat = now;
}

function seedAmbient(now, cfg) {
  if (lastAmbient && now - lastAmbient < 9000) return;
  const phase = now * .00006;
  [[.27, .42], [.68, .58], [.46, .24]].forEach(([x, y], index) => {
    const color = fluidColor(cfg.colors[index]);
    window.AuraFluid?.splat(x + Math.sin(phase + index) * .04, y + Math.cos(phase + index * 1.7) * .03, 18 * Math.cos(phase + index), 12 * Math.sin(phase + index), color, .13);
  });
  lastAmbient = now;
}

function render(now) {
  fitStage();
  const cfg = controls();
  window.AuraFluid?.configure({ DENSITY_DISSIPATION: .975 + cfg.persistence * .024 });
  aura.clearRect(0, 0, stageWidth, stageHeight);
  for (const track of tracks) {
    track.age += 16;
    const easing = track.age > 220 ? .055 : .18;
    track.x += (track.targetX - track.x) * easing; track.y += (track.targetY - track.y) * easing;
    track.radius += (track.targetRadius - track.radius) * easing;
    track.opacity += ((track.age > 1100 ? 0 : 1) - track.opacity) * .07;
    drawAura(track, now, cfg); injectFluid(track, now, cfg);
  }
  tracks = tracks.filter((track) => track.age < 1800 || track.opacity > .02);
  seedAmbient(now, cfg);
  requestAnimationFrame(render);
}

async function loadDeviceStatus() {
  try {
    const response = await fetch("/gpu-status"), data = await response.json();
    if (!response.ok || !data.accelerated) throw Error(data.error || data.message || "GPU acceleration is unavailable.");
    $("deviceStatus").textContent = `GPU active: ${data.name} (${data.device}, CUDA ${data.cuda_version})`; $("deviceStatus").className = "device-status active";
  } catch (error) {
    $("deviceStatus").textContent = `GPU unavailable: ${error.message}`; $("deviceStatus").className = "device-status unavailable"; $("startCamera").disabled = true;
  }
}

async function infer() {
  if (!active || processing || !camera.videoWidth) return;
  processing = true;
  const scale = Math.min(1, CAPTURE_MAX_DIMENSION / Math.max(camera.videoWidth, camera.videoHeight));
  capture.width = Math.round(camera.videoWidth * scale); capture.height = Math.round(camera.videoHeight * scale);
  captureContext.drawImage(camera, 0, 0, capture.width, capture.height);
  try {
    const response = await fetch("/segment", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: capture.toDataURL("image/jpeg", .72), mode: "instance", max_segments: controls().maxSegments }) });
    const data = await response.json(); if (!response.ok) throw Error(data.error);
    const xScale = camera.videoWidth / data.width, yScale = camera.videoHeight / data.height;
    updateTracks(data.masks.map((mask) => ({ ...mask, points: mask.points.map(([x, y]) => [x * xScale, y * yScale]) })));
  } catch (error) { $("status").textContent = `Segmentation unavailable: ${error.message}`; }
  processing = false; setTimeout(infer, 0);
}

$("startCamera").onclick = async () => {
  if (!navigator.mediaDevices?.getUserMedia) { $("status").textContent = "Camera requires HTTPS or http://localhost."; return; }
  try {
    camera.srcObject = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); await camera.play();
    active = true; $("emptyState").style.display = "none"; $("startCamera").textContent = "Camera running"; $("startCamera").disabled = true; $("status").textContent = "Listening to the field…"; infer();
  } catch (error) {
    const messages = { NotAllowedError: "Camera permission was blocked. Allow it in your browser's site settings, then reload.", NotFoundError: "No camera was found. Connect or enable one, then try again.", NotReadableError: "Your camera is in use by another application. Close it and try again.", SecurityError: "Camera requires HTTPS or http://localhost (not a local IP address)." };
    $("status").textContent = messages[error.name] || `Camera error: ${error.message}`;
  }
};

for (const [id, value] of [["auraIntensity", (v) => `${v}%`], ["interaction", (v) => `${v}%`], ["persistence", (v) => `${v}%`], ["maxSegments", (v) => v]]) $(id).oninput = (event) => { $(`${id}Value`).textContent = value(event.target.value); };
$("fullscreen").onclick = () => stage.requestFullscreen?.();
new ResizeObserver(fitStage).observe(stage); document.addEventListener("fullscreenchange", fitStage);
fitStage(); requestAnimationFrame(render); loadDeviceStatus();
