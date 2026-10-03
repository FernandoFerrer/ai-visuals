const $ = (id) => document.getElementById(id);
const camera = $("camera"), stage = $("synthwaveStage"), canvas = $("synthwaveCanvas"), capture = $("capture");
const ctx = canvas.getContext("2d"), captureCtx = capture.getContext("2d");
const CAPTURE_MAX_DIMENSION = 640;
const CHARACTER_TYPES = ["runner", "ship", "hover", "robot"];
const CHARACTER_COLORS = ["#ff5ebc", "#5de4ff", "#ffad58", "#ad86ff"];
const PALETTES = {
  sunset: { skyTop: "#070b29", skyMid: "#21114d", skyBottom: "#090d25", grid: "123 81 203", pulse: "118 243 255", mountainNear: "#292263", mountainFar: "#1b1d4d", colors: CHARACTER_COLORS },
  violet: { skyTop: "#090726", skyMid: "#29104d", skyBottom: "#0b0928", grid: "143 88 230", pulse: "224 151 255", mountainNear: "#332061", mountainFar: "#201343", colors: ["#ff74c5", "#c5a1ff", "#ffb36b", "#79e7ff"] },
  ocean: { skyTop: "#061329", skyMid: "#10285a", skyBottom: "#08162e", grid: "51 148 207", pulse: "105 236 255", mountainNear: "#173f5a", mountainFar: "#122a4c", colors: ["#ff8aa4", "#65eaff", "#ffd07e", "#a897ff"] },
};
let active = false, processing = false, width = 0, height = 0, ratio = 1, nextTrackId = 1;
let tracks = [], waves = [], stars = Array.from({ length: 82 }, (_, index) => ({ x: (index * 79 % 997) / 997, y: (index * 41 % 571) / 571, phase: index * 0.61, size: 0.4 + (index % 4) * 0.24 }));

function controls() {
  return {
    density: +$("gridDensity").value, perspective: +$("perspective").value / 100,
    size: +$("characterSize").value, smoothing: +$("smoothing").value / 100,
    radius: +$("interactionRadius").value, strength: +$("interactionStrength").value / 100,
    trail: +$("trailLength").value, glow: +$("glow").value / 100,
    speed: +$("animationSpeed").value, decay: +$("effectDecay").value / 100,
    ...PALETTES[$("palette").value],
  };
}

function fitStage() {
  const bounds = stage.getBoundingClientRect(), nextWidth = Math.max(1, Math.round(bounds.width)), nextHeight = Math.max(1, Math.round(bounds.height));
  const nextRatio = Math.min(window.devicePixelRatio || 1, 2);
  if (width === nextWidth && height === nextHeight && ratio === nextRatio) return;
  width = nextWidth; height = nextHeight; ratio = nextRatio;
  canvas.width = width * ratio; canvas.height = height * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function cameraPoint(x, y) {
  const scale = Math.max(width / camera.videoWidth, height / camera.videoHeight);
  return { x: x * scale + (width - camera.videoWidth * scale) / 2, y: y * scale + (height - camera.videoHeight * scale) / 2 };
}

function peopleFromMasks(masks) {
  return masks.filter((mask) => String(mask.class_name).toLowerCase() === "person").map((mask) => {
    const points = mask.points;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of points) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    const point = cameraPoint((minX + maxX) / 2, maxY);
    // Keep every traveller on the virtual ground plane even when a camera's
    // crop places a person's feet above the visible terrain.
    return { x: Math.max(28, Math.min(width - 28, point.x)), y: Math.max(height * .52, Math.min(height * .91, point.y)), scale: Math.max(.75, Math.min(1.4, (maxY - minY) / camera.videoHeight * 2.8)) };
  });
}

function updateTracks(people) {
  const now = performance.now(), unmatched = new Set(tracks.filter((track) => track.age < 1400));
  for (const person of people) {
    let match = null, closest = 150;
    for (const track of unmatched) {
      const distance = Math.hypot(track.targetX - person.x, track.targetY - person.y);
      if (distance < closest) { closest = distance; match = track; }
    }
    if (!match) {
      match = { id: nextTrackId++, x: person.x, y: person.y, targetX: person.x, targetY: person.y, scale: person.scale, targetScale: person.scale, vx: 0, vy: 0, age: 0, opacity: 0, trail: [], type: CHARACTER_TYPES[(nextTrackId - 2) % CHARACTER_TYPES.length], color: CHARACTER_COLORS[(nextTrackId - 2) % CHARACTER_COLORS.length] };
      tracks.push(match);
    }
    unmatched.delete(match); match.targetX = person.x; match.targetY = person.y; match.targetScale = person.scale; match.age = 0; match.seenAt = now;
  }
  $("status").textContent = people.length ? `${people.length} traveller${people.length === 1 ? "" : "s"} in the landscape` : "The landscape is at rest";
}

function drawSun(horizon, now) {
  const sunX = width * .69, sunY = horizon - height * .205, radius = Math.min(width, height) * .18;
  const halo = ctx.createRadialGradient(sunX, sunY, radius * .12, sunX, sunY, radius * 1.72);
  halo.addColorStop(0, "#ffd384cc"); halo.addColorStop(.47, "#ff7ba07a"); halo.addColorStop(1, "#ff5eae00");
  ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(sunX, sunY, radius * 1.72, 0, Math.PI * 2); ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.arc(sunX, sunY, radius, 0, Math.PI * 2); ctx.clip();
  const core = ctx.createLinearGradient(0, sunY - radius, 0, sunY + radius); core.addColorStop(0, "#fff0a5"); core.addColorStop(.52, "#ffb16d"); core.addColorStop(1, "#f253a7");
  ctx.fillStyle = core; ctx.fillRect(sunX - radius, sunY - radius, radius * 2, radius * 2);
  ctx.strokeStyle = "#be377f"; ctx.lineWidth = Math.max(2, radius * .032);
  for (let y = sunY - radius + 12; y < sunY + radius; y += Math.max(9, radius * .15)) { ctx.beginPath(); ctx.moveTo(sunX - radius, y + Math.sin(now * .001 + y) * .65); ctx.lineTo(sunX + radius, y + Math.sin(now * .001 + y) * .65); ctx.stroke(); }
  ctx.restore();
}

function drawMountainRange(horizon, now, color, highlight, heightFactor, drift) {
  const step = Math.max(28, width / 19), points = [];
  for (let x = -step; x <= width + step; x += step) {
    const ridge = .25 + Math.abs(Math.sin(x * .012 + drift + now * .000012)) * .48 + Math.abs(Math.sin(x * .027 - drift)) * .27;
    points.push([x, horizon - height * heightFactor * ridge]);
  }
  ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(-step, horizon + 12); for (const [x, y] of points) ctx.lineTo(x, y); ctx.lineTo(width + step, horizon + 12); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = highlight; ctx.globalAlpha = .5; ctx.lineWidth = 1; ctx.beginPath(); points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke(); ctx.globalAlpha = 1;
}

function drawMountains(horizon, now, cfg) {
  drawMountainRange(horizon, now, "#121a49", "#6570c3", .12, .5);
  drawMountainRange(horizon, now, cfg.mountainFar, "#9b70d0", .18, 1.4);
  drawMountainRange(horizon, now, cfg.mountainNear, "#e15dac", .135, 2.2);
}

function drawSkyline(horizon, now) {
  const baseY = horizon + 5, buildingWidth = Math.max(14, width / 38);
  ctx.fillStyle = "#11143b";
  for (let index = 0; index < 40; index++) {
    const x = index * buildingWidth - buildingWidth, buildingHeight = 9 + ((index * 37) % 43);
    ctx.fillRect(x, baseY - buildingHeight, buildingWidth - 1, buildingHeight);
    if (index % 3) { ctx.fillStyle = `rgb(112 197 255 / ${.24 + .16 * Math.sin(now * .001 + index)})`; ctx.fillRect(x + 4, baseY - buildingHeight + 6, 2, 2); ctx.fillStyle = "#11143b"; }
  }
}

function projectGrid(x, z, horizon, perspective) { return { x: width / 2 + x / (z + .35) * width * .54, y: horizon + (1 - 1 / (z + .35)) * height * perspective }; }
function gridPulse(x, y, now, cfg) {
  let pulse = 0;
  for (const track of tracks) { const distance = Math.hypot(x - track.x, y - track.y); pulse += Math.max(0, 1 - distance / cfg.radius) * .6; }
  for (const wave of waves) { const distance = Math.hypot(x - wave.x, y - wave.y), ring = Math.max(0, 1 - Math.abs(distance - wave.radius) / 34); pulse += ring * wave.power; }
  return Math.min(1, pulse * cfg.strength * (0.78 + .22 * Math.sin(now * .007)));
}

function drawGrid(horizon, now, cfg) {
  const rows = cfg.density, cols = Math.round(rows * 1.4);
  ctx.lineWidth = 1; ctx.lineCap = "round";
  for (let r = 0; r <= rows; r++) {
    const z = r / rows * 2.4, a = projectGrid(-1.2, z, horizon, cfg.perspective), b = projectGrid(1.2, z, horizon, cfg.perspective);
    const pulse = gridPulse((a.x + b.x) / 2, a.y, now, cfg);
    ctx.strokeStyle = pulse ? `rgb(${cfg.pulse} / ${.24 + pulse * .54})` : `rgb(${cfg.grid} / .35)`;
    ctx.shadowBlur = pulse * cfg.glow * 16; ctx.shadowColor = "#55dcff"; ctx.beginPath(); ctx.moveTo(a.x, a.y - pulse * 12); ctx.lineTo(b.x, b.y - pulse * 12); ctx.stroke();
  }
  for (let c = -cols; c <= cols; c++) {
    const x = c / cols * 1.18, near = projectGrid(x, 2.4, horizon, cfg.perspective), far = projectGrid(x, 0, horizon, cfg.perspective);
    ctx.strokeStyle = "rgb(196 72 199 / .35)"; ctx.shadowBlur = 0; ctx.beginPath(); ctx.moveTo(far.x, far.y); ctx.lineTo(near.x, near.y); ctx.stroke();
  }
  // The road gives the terrain a recognisable arcade-game direction while the
  // rest of the grid remains available for overlapping person interactions.
  const roadTop = width * .09, roadBottom = width * .33;
  ctx.strokeStyle = "rgb(255 106 188 / .46)"; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(width / 2 - roadTop, horizon); ctx.lineTo(width / 2 - roadBottom, height); ctx.moveTo(width / 2 + roadTop, horizon); ctx.lineTo(width / 2 + roadBottom, height); ctx.stroke();
  ctx.strokeStyle = "rgb(255 212 127 / .52)"; ctx.lineWidth = 2;
  for (let y = horizon + 18; y < height; y += 28) { const perspective = (y - horizon) / (height - horizon); const dash = 6 + perspective * 20; ctx.beginPath(); ctx.moveTo(width / 2, y); ctx.lineTo(width / 2, y + dash); ctx.stroke(); }
  ctx.shadowBlur = 0;
}

function drawCharacter(track, cfg) {
  const size = cfg.size * track.scale, angle = Math.atan2(track.vy, track.vx || .001);
  ctx.save(); ctx.translate(track.x, track.y); ctx.globalAlpha = track.opacity; ctx.shadowColor = track.color; ctx.shadowBlur = cfg.glow * 22;
  ctx.fillStyle = track.color; ctx.strokeStyle = "#fff1dc"; ctx.lineWidth = 1.2;
  if (track.type === "runner") { ctx.fillRect(-size * .2, -size, size * .4, size * .54); ctx.fillRect(-size * .34, -size * .78, size * .68, size * .16); ctx.fillStyle = "#fff1dc"; ctx.fillRect(-size * .12, -size * .84, size * .1, size * .1); ctx.fillRect(size * .05, -size * .84, size * .1, size * .1); ctx.fillStyle = track.color; ctx.fillRect(-size * .3, -size * .45, size * .12, size * .35); ctx.fillRect(size * .18, -size * .45, size * .12, size * .35); ctx.fillRect(-size * .16, -size * .13, size * .12, size * .31); ctx.fillRect(size * .04, -size * .13, size * .12, size * .31); }
  else if (track.type === "ship") { ctx.rotate(angle + Math.PI / 2); ctx.beginPath(); ctx.moveTo(0, -size); ctx.lineTo(size * .62, size * .56); ctx.lineTo(0, size * .32); ctx.lineTo(-size * .62, size * .56); ctx.closePath(); ctx.fill(); ctx.fillStyle = "#ffe4a1"; ctx.fillRect(-size * .13, -size * .24, size * .26, size * .35); }
  else if (track.type === "hover") { ctx.fillRect(-size * .7, -size * .32, size * 1.4, size * .25); ctx.fillRect(-size * .36, -size * .55, size * .72, size * .25); ctx.fillStyle = "#17214c"; ctx.fillRect(-size * .2, -size * .48, size * .4, size * .12); ctx.fillStyle = "#ffe4a1"; ctx.fillRect(-size * .52, -size * .21, size * .14, size * .07); ctx.fillRect(size * .38, -size * .21, size * .14, size * .07); }
  else { ctx.fillRect(-size * .36, -size * .8, size * .72, size * .64); ctx.fillRect(-size * .5, -size * .58, size * .14, size * .34); ctx.fillRect(size * .36, -size * .58, size * .14, size * .34); ctx.fillStyle = "#fff1dc"; ctx.fillRect(-size * .18, -size * .62, size * .13, size * .12); ctx.fillRect(size * .05, -size * .62, size * .13, size * .12); ctx.fillStyle = track.color; ctx.fillRect(-size * .26, -size * .14, size * .17, size * .22); ctx.fillRect(size * .09, -size * .14, size * .17, size * .22); }
  ctx.restore();
}

function animate(now) {
  fitStage(); const cfg = controls(), horizon = height * .43;
  const sky = ctx.createLinearGradient(0, 0, 0, height); sky.addColorStop(0, cfg.skyTop); sky.addColorStop(.52, cfg.skyMid); sky.addColorStop(1, cfg.skyBottom); ctx.fillStyle = sky; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#b9dfff"; for (const star of stars) { const alpha = .22 + .4 * (0.5 + .5 * Math.sin(now * .001 * cfg.speed + star.phase)); ctx.globalAlpha = alpha; ctx.fillRect(star.x * width, star.y * horizon * .92, star.size, star.size); } ctx.globalAlpha = 1;
  drawSun(horizon, now); drawMountains(horizon, now, cfg); drawSkyline(horizon, now); drawGrid(horizon, now, cfg);
  for (const track of tracks) {
    track.age += 16; const oldX = track.x, oldY = track.y; const easing = track.age > 150 ? .05 : cfg.smoothing;
    track.x += (track.targetX - track.x) * easing; track.y += (track.targetY - track.y) * easing; track.scale += (track.targetScale - track.scale) * easing;
    track.vx = track.x - oldX; track.vy = track.y - oldY; track.color = cfg.colors[(track.id - 1) % cfg.colors.length]; track.opacity += ((track.age > 900 ? 0 : 1) - track.opacity) * .08;
    if (track.opacity > .03) { track.trail.unshift({ x: track.x, y: track.y }); track.trail.length = Math.min(track.trail.length, cfg.trail); }
  }
  tracks = tracks.filter((track) => track.age < 1500 || track.opacity > .02);
  for (const track of tracks) { for (let i = track.trail.length - 1; i >= 0; i--) { const point = track.trail[i], alpha = (1 - i / track.trail.length) * .27 * track.opacity; ctx.fillStyle = track.color; ctx.globalAlpha = alpha; ctx.beginPath(); ctx.arc(point.x, point.y, 2 + (1 - i / track.trail.length) * 4, 0, Math.PI * 2); ctx.fill(); } ctx.globalAlpha = 1; drawCharacter(track, cfg); }
  waves = waves.filter((wave) => { wave.radius += 2.1 * cfg.speed; wave.power *= 1 - cfg.decay * .12; return wave.power > .04; });
  for (const track of tracks) if (Math.hypot(track.vx, track.vy) > .9 && Math.random() < .12) waves.push({ x: track.x, y: track.y, radius: 5, power: Math.min(.6, .15 + Math.hypot(track.vx, track.vy) * .07) });
  requestAnimationFrame(animate);
}

async function loadDeviceStatus() {
  try { const response = await fetch("/gpu-status"), data = await response.json(); if (!response.ok || !data.accelerated) throw Error(data.error || data.message || "GPU acceleration is unavailable."); $("deviceStatus").textContent = `GPU active: ${data.name} (${data.device}, CUDA ${data.cuda_version})`; $("deviceStatus").className = "device-status active"; }
  catch (error) { $("deviceStatus").textContent = `GPU unavailable: ${error.message}`; $("deviceStatus").className = "device-status unavailable"; $("startCamera").disabled = true; }
}

async function infer() {
  if (!active || processing || !camera.videoWidth) return; processing = true;
  const scale = Math.min(1, CAPTURE_MAX_DIMENSION / Math.max(camera.videoWidth, camera.videoHeight)); capture.width = Math.round(camera.videoWidth * scale); capture.height = Math.round(camera.videoHeight * scale); captureCtx.drawImage(camera, 0, 0, capture.width, capture.height);
  try { const response = await fetch("/segment", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: capture.toDataURL("image/jpeg", .72), mode: "instance", max_segments: 16 }) }); const data = await response.json(); if (!response.ok) throw Error(data.error); const xScale = camera.videoWidth / data.width, yScale = camera.videoHeight / data.height; const masks = data.masks.map((mask) => ({ ...mask, points: mask.points.map(([x, y]) => [x * xScale, y * yScale]) })); updateTracks(peopleFromMasks(masks)); }
  catch (error) { $("status").textContent = `Detection unavailable: ${error.message}`; }
  processing = false; setTimeout(infer, 0);
}

$("startCamera").onclick = async () => {
  if (!navigator.mediaDevices?.getUserMedia) { $("status").textContent = "Camera requires HTTPS or http://localhost."; return; }
  try { camera.srcObject = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); await camera.play(); active = true; fitStage(); $("emptyState").style.display = "none"; $("startCamera").textContent = "Camera running"; $("startCamera").disabled = true; $("status").textContent = "Looking for travellers..."; infer(); }
  catch (error) { const messages = { NotAllowedError: "Camera permission was blocked. Allow it in your browser's site settings, then reload.", NotFoundError: "No camera was found. Connect or enable one, then try again.", NotReadableError: "Your camera is in use by another application. Close it and try again.", SecurityError: "Camera requires HTTPS or http://localhost (not a local IP address)." }; $("status").textContent = messages[error.name] || `Camera error: ${error.message}`; }
};

for (const [id, suffix, format] of [["gridDensity", "", (v) => v], ["perspective", "%", (v) => v], ["characterSize", " px", (v) => v], ["smoothing", "%", (v) => v], ["interactionRadius", " px", (v) => v], ["interactionStrength", "%", (v) => v], ["trailLength", "", (v) => v], ["glow", "%", (v) => v], ["animationSpeed", "", (v) => `${(+v).toFixed(1)}×`], ["effectDecay", "%", (v) => v]]) { $(id).oninput = (event) => { $(`${id}Value`).textContent = `${format(event.target.value)}${id === "animationSpeed" ? "" : suffix}`; }; }
$("fullscreen").onclick = () => stage.requestFullscreen?.(); new ResizeObserver(fitStage).observe(stage); document.addEventListener("fullscreenchange", fitStage); fitStage(); requestAnimationFrame(animate); loadDeviceStatus();
