const $ = (id) => document.getElementById(id);
const camera = $("camera"), overlay = $("overlay"), capture = $("capture");
const ctx = overlay.getContext("2d"), captureCtx = capture.getContext("2d");
let masks = [], processing = false, active = false, segmentationMode = "instance";

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
function draw() {
  if (!active) return;
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  const count = +$("colorCount").value, flash = +$("flash").value / 100;
  const pulse = 0.55 + Math.sin(Date.now() / 180) * flash * 0.45;
  const foregroundColorCount = Math.max(count - 1, 1);
  const backgroundColor = colorFromIndex(count - 1, count);

  // Reserve one palette color for pixels that are not part of an object mask.
  ctx.fillStyle = backgroundColor;
  ctx.globalAlpha = pulse * .28;
  ctx.fillRect(0, 0, overlay.width, overlay.height);

  masks.forEach((mask, index) => {
    const points = mask.points; if (!points?.length) return;
    ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath();
    const colorIndex = segmentationMode === "semantic" ? mask.class_id % foregroundColorCount : index % foregroundColorCount;
    const color = colorFromIndex(colorIndex, count);
    ctx.fillStyle = color; ctx.globalAlpha = pulse * .66; ctx.fill();
    ctx.globalAlpha = .95; ctx.lineWidth = 2; ctx.strokeStyle = color; ctx.stroke();
  });
  ctx.globalAlpha = 1; requestAnimationFrame(draw);
}

async function infer() {
  if (!active || processing || !camera.videoWidth) return;
  processing = true;
  capture.width = camera.videoWidth; capture.height = camera.videoHeight;
  captureCtx.drawImage(camera, 0, 0); 
  try {
    const response = await fetch("/segment", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({image:capture.toDataURL("image/jpeg", .72), mode:segmentationMode}) });
    const data = await response.json();
    if (!response.ok) throw Error(data.error);
    masks = data.masks;
    $("status").textContent = segmentationMode === "semantic"
      ? `${data.class_count} semantic classes detected`
      : `${masks.length} instances detected`;
  } catch (error) { $("status").textContent = `Segmentation unavailable: ${error.message}`; }
  processing = false; setTimeout(infer, 80);
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
$("flash").oninput = (e) => $("flashValue").textContent = `${e.target.value}%`;
$("logoFile").onchange = (e) => { const file=e.target.files[0]; if (file) { $("logo").src=URL.createObjectURL(file); $("logo").style.display="block"; } };
$("logoSize").oninput = (e) => { $("logo").style.width = `${e.target.value}px`; $("logoSizeValue").textContent = `${e.target.value} px`; };
$("logoPosition").onchange = (e) => { $("logo").className = e.target.value; };
$("fullscreen").onclick = () => $("stage").requestFullscreen?.();
window.onresize = fitCanvas;
