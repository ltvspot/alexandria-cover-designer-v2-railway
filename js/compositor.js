// compositor.js — Frame-overlay compositing with parametric inner-boundary mask
//
// ARCHITECTURE (v8 — source-overlay mask):
//   1) Draw the generated illustration first (large fill region, smart-cropped).
//   2) Draw an overlay derived from the source cover on top.
//      The overlay is fully opaque except for a transparent medallion opening.
//   3) Because the frame lives in the top layer, ornament bleed is physically blocked.
//
// This replaces the old inner-oval punch approach, which was too conservative and
// could still mismatch the non-geometric baroque opening.

// Approximate opening model from the report's parametric boundary.
// Ratios are relative to detected OUTER medallion radius.
const MASK_BASE_RATIO = 0.808;
const MASK_TOP_INDENT_RATIO = 0.135;
const MASK_BOTTOM_EXPAND_RATIO = 0.058;
const MASK_SIDE_INDENT_RATIO = 0.029;
const MASK_OVAL_BIAS_RATIO = 0.029;

const MASK_SCALE_START = 1.02;
const MASK_SCALE_STEP = 0.02;
const MASK_SCALE_MIN = 0.84;
const MAX_COMPOSE_ATTEMPTS = Math.floor((MASK_SCALE_START - MASK_SCALE_MIN) / MASK_SCALE_STEP) + 1;
const MAX_FRAME_DIFF_PIXELS = 80;
const MAX_CUT_ORNAMENT_PIXELS = 24;
const MASK_STEPS = 720;
const IMAGE_OVERDRAW_RATIO = 1.12;

// Exported for compatibility with debug/tools.
const CY_SHIFT_RATIO = 0;
const RX_RATIO = 0.78;
const RY_RATIO = 0.78;
const FILL_RATIO = 0.96;
const RING_WIDTH = 0;

// ---------------------------------------------------------------------------
// findBestCropCenter — energy-based detail center detection
// Returns {x, y} in 0-1 normalized coords
// ---------------------------------------------------------------------------
function findBestCropCenter(imageElement) {
  const size = 150;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imageElement, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;

  const energy = new Float32Array(size * size);
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const idx = (y * size + x) * 4;
      const right = (y * size + x + 1) * 4;
      const down = ((y + 1) * size + x) * 4;
      const gx = Math.abs(data[idx] - data[right]) +
                 Math.abs(data[idx + 1] - data[right + 1]) +
                 Math.abs(data[idx + 2] - data[right + 2]);
      const gy = Math.abs(data[idx] - data[down]) +
                 Math.abs(data[idx + 1] - data[down + 1]) +
                 Math.abs(data[idx + 2] - data[down + 2]);
      energy[y * size + x] = (gx + gy) / 6;
    }
  }

  const blurred = new Float32Array(size * size);
  const kernel = [1, 2, 1, 2, 4, 2, 1, 2, 1];
  const kSum = 16;
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      let v = 0;
      let ki = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          v += energy[(y + dy) * size + (x + dx)] * kernel[ki++];
        }
      }
      blurred[y * size + x] = v / kSum;
    }
  }

  let totalW = 0;
  let wx = 0;
  let wy = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const w = blurred[y * size + x];
      totalW += w;
      wx += x * w;
      wy += y * w;
    }
  }

  if (totalW === 0) return { x: 0.5, y: 0.5 };
  return { x: (wx / totalW) / size, y: (wy / totalW) / size };
}

// ---------------------------------------------------------------------------
// compositeOnCover — backward compat wrapper
// ---------------------------------------------------------------------------
function compositeOnCover(coverImg, generatedImg, cx = 2850, cy = 1350, radius = 520) {
  return smartComposite(coverImg, generatedImg, cx, cy, radius);
}

function _fitSourceRectToDestAspect(imgW, imgH, destAspect, cropCenterX, cropCenterY) {
  const imgAspect = imgW / imgH;
  let srcW;
  let srcH;

  if (imgAspect > destAspect) {
    srcH = imgH;
    srcW = Math.round(imgH * destAspect);
  } else {
    srcW = imgW;
    srcH = Math.round(imgW / destAspect);
  }

  let srcX = Math.round(cropCenterX * imgW - srcW / 2);
  let srcY = Math.round(cropCenterY * imgH - srcH / 2);

  srcX = Math.max(0, Math.min(imgW - srcW, srcX));
  srcY = Math.max(0, Math.min(imgH - srcH, srcY));

  return { srcX, srcY, srcW, srcH };
}

function _isOrnamentPixel(r, g, b) {
  const strongGold = r > 140 && g > 95 && b < 145 && r > g && g > b;
  const warmIvory = r > 170 && g > 145 && b > 100 && (r - g) < 65 && (g - b) < 60;
  const bronze = r > 120 && g > 80 && b > 45 && b < 130 && (r - g) < 85;
  return strongGold || warmIvory || bronze;
}

function _getRegionBounds(W, H, cx, cy, radius, pad) {
  const x0 = Math.max(0, Math.floor(cx - radius - pad));
  const y0 = Math.max(0, Math.floor(cy - radius - pad));
  const x1 = Math.min(W, Math.ceil(cx + radius + pad));
  const y1 = Math.min(H, Math.ceil(cy + radius + pad));
  return { x0, y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

function _drawCoverToCanvas(coverImg, W, H) {
  const coverCanvas = document.createElement('canvas');
  coverCanvas.width = W;
  coverCanvas.height = H;
  const coverCtx = coverCanvas.getContext('2d');
  coverCtx.drawImage(coverImg, 0, 0, W, H);
  return { coverCanvas, coverCtx };
}

function _angleDistance(a, b) {
  const TAU = Math.PI * 2;
  const d = Math.abs((a - b) % TAU);
  return Math.min(d, TAU - d);
}

function _innerRadiusAtAngle(radius, theta, scale = 1) {
  const top = Math.exp(-Math.pow(_angleDistance(theta, (3 * Math.PI) / 2), 2) / 0.09);
  const bottom = Math.exp(-Math.pow(_angleDistance(theta, Math.PI / 2), 2) / 0.16);
  const right = Math.exp(-Math.pow(_angleDistance(theta, 0), 2) / 0.04);
  const left = Math.exp(-Math.pow(_angleDistance(theta, Math.PI), 2) / 0.04);
  const ovalBias = Math.cos(2 * theta);

  let ratio =
    MASK_BASE_RATIO -
    MASK_TOP_INDENT_RATIO * top +
    MASK_BOTTOM_EXPAND_RATIO * bottom -
    MASK_SIDE_INDENT_RATIO * right -
    MASK_SIDE_INDENT_RATIO * left -
    MASK_OVAL_BIAS_RATIO * ovalBias;

  ratio *= scale;
  ratio = Math.max(0.58, Math.min(0.95, ratio));
  return radius * ratio;
}

function _traceMaskPath(ctx, cx, cy, radius, scale = 1) {
  ctx.beginPath();
  for (let i = 0; i <= MASK_STEPS; i++) {
    const theta = (i / MASK_STEPS) * Math.PI * 2;
    const r = _innerRadiusAtAngle(radius, theta, scale);
    const x = cx + r * Math.cos(theta);
    const y = cy + r * Math.sin(theta);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function _maskBounds(cx, cy, radius, scale = 1) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i <= MASK_STEPS; i++) {
    const theta = (i / MASK_STEPS) * Math.PI * 2;
    const r = _innerRadiusAtAngle(radius, theta, scale);
    const x = cx + r * Math.cos(theta);
    const y = cy + r * Math.sin(theta);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

function _buildOverlayCanvas(coverImg, W, H, cx, cy, radius, scale = 1) {
  const overlay = document.createElement('canvas');
  overlay.width = W;
  overlay.height = H;
  const octx = overlay.getContext('2d');
  octx.drawImage(coverImg, 0, 0, W, H);

  octx.globalCompositeOperation = 'destination-out';
  octx.fillStyle = 'rgba(0,0,0,1)';
  _traceMaskPath(octx, cx, cy, radius, scale);
  octx.fill();

  // Soften only the cut edge very slightly to avoid jagged seams.
  octx.globalAlpha = 0.25;
  octx.lineWidth = 3;
  octx.strokeStyle = 'rgba(0,0,0,1)';
  _traceMaskPath(octx, cx, cy, radius, scale);
  octx.stroke();
  octx.globalAlpha = 1;
  octx.globalCompositeOperation = 'source-over';

  return overlay;
}

function _measureFrameDiffPixels(ctx, coverCtx, cx, cy, radius, W, H) {
  const pad = Math.round(radius * 0.28);
  const { x0, y0, w, h } = _getRegionBounds(W, H, cx, cy, radius, pad);
  if (!w || !h) return 0;

  const comp = ctx.getImageData(x0, y0, w, h).data;
  const cov = coverCtx.getImageData(x0, y0, w, h).data;
  let diffPixels = 0;

  for (let py = 0; py < h; py++) {
    const y = y0 + py;
    for (let px = 0; px < w; px++) {
      const x = x0 + px;
      const idx = (py * w + px) * 4;
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.hypot(dx, dy);
      if (d < radius * 0.58 || d > radius * 1.2) continue;

      const r = cov[idx];
      const g = cov[idx + 1];
      const b = cov[idx + 2];
      if (!_isOrnamentPixel(r, g, b)) continue;

      const dr = Math.abs(comp[idx] - r);
      const dg = Math.abs(comp[idx + 1] - g);
      const db = Math.abs(comp[idx + 2] - b);
      if (dr + dg + db > 24) diffPixels++;
    }
  }

  return diffPixels;
}

function _countOrnamentsCutByMask(overlayCtx, coverCtx, cx, cy, radius, W, H) {
  const pad = Math.round(radius * 0.28);
  const { x0, y0, w, h } = _getRegionBounds(W, H, cx, cy, radius, pad);
  if (!w || !h) return 0;

  const over = overlayCtx.getImageData(x0, y0, w, h).data;
  const cov = coverCtx.getImageData(x0, y0, w, h).data;
  let cut = 0;

  for (let py = 0; py < h; py++) {
    const y = y0 + py;
    for (let px = 0; px < w; px++) {
      const x = x0 + px;
      const idx = (py * w + px) * 4;
      const d = Math.hypot(x - cx, y - cy);
      if (d < radius * 0.52 || d > radius * 1.05) continue;

      if (over[idx + 3] > 8) continue; // not transparent => not cut from overlay

      const r = cov[idx];
      const g = cov[idx + 1];
      const b = cov[idx + 2];
      if (_isOrnamentPixel(r, g, b)) cut++;
    }
  }

  return cut;
}

// ---------------------------------------------------------------------------
// smartComposite — source-overlay mask compositing
// ---------------------------------------------------------------------------
function smartComposite(coverImg, generatedImg, cx = 2850, cy = 1350, radius = 520) {
  const W = coverImg.width || 3784;
  const H = coverImg.height || 2777;

  const detailCenter = findBestCropCenter(generatedImg);
  const cropCenterX = Math.max(0.15, Math.min(0.85, detailCenter.x));
  const cropCenterY = Math.max(0.15, Math.min(0.85, detailCenter.y));

  const { coverCtx } = _drawCoverToCanvas(coverImg, W, H);
  let fallbackCanvas = null;

  for (let attempt = 0; attempt < MAX_COMPOSE_ATTEMPTS; attempt++) {
    const scale = Math.max(MASK_SCALE_MIN, MASK_SCALE_START - attempt * MASK_SCALE_STEP);
    const mask = _maskBounds(cx, cy, radius, scale);
    const maskW = Math.max(100, Math.round(mask.maxX - mask.minX));
    const maskH = Math.max(100, Math.round(mask.maxY - mask.minY));
    const drawW = Math.round(maskW * IMAGE_OVERDRAW_RATIO);
    const drawH = Math.round(maskH * IMAGE_OVERDRAW_RATIO);
    const drawX = Math.round(cx - drawW / 2);
    const drawY = Math.round(cy - drawH / 2);

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // Layer 1: generated art base (will be masked by cover overlay).
    const destAspect = drawW / drawH;
    const { srcX, srcY, srcW, srcH } = _fitSourceRectToDestAspect(
      generatedImg.width,
      generatedImg.height,
      destAspect,
      cropCenterX,
      cropCenterY
    );

    ctx.drawImage(
      generatedImg,
      srcX,
      srcY,
      srcW,
      srcH,
      drawX,
      drawY,
      drawW,
      drawH
    );

    // Layer 2: source cover overlay with transparent medallion opening.
    const overlayCanvas = _buildOverlayCanvas(coverImg, W, H, cx, cy, radius, scale);
    ctx.drawImage(overlayCanvas, 0, 0);

    const overlayCtx = overlayCanvas.getContext('2d');
    const frameDiff = _measureFrameDiffPixels(ctx, coverCtx, cx, cy, radius, W, H);
    const cutOrnaments = _countOrnamentsCutByMask(overlayCtx, coverCtx, cx, cy, radius, W, H);

    console.log(
      `[Compositor v8 overlay] attempt=${attempt + 1}/${MAX_COMPOSE_ATTEMPTS} scale=${scale.toFixed(2)} ` +
      `draw=(${drawW}x${drawH}) frameDiff=${frameDiff} cutOrnaments=${cutOrnaments}`
    );

    fallbackCanvas = canvas;
    if (frameDiff <= MAX_FRAME_DIFF_PIXELS && cutOrnaments <= MAX_CUT_ORNAMENT_PIXELS) {
      return canvas;
    }
  }

  return fallbackCanvas;
}

// Create a thumbnail of a canvas
function createThumbnail(canvas, maxWidth = 400) {
  const scale = maxWidth / canvas.width;
  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = maxWidth;
  thumbCanvas.height = Math.round(canvas.height * scale);
  const ctx = thumbCanvas.getContext('2d');
  ctx.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
  return thumbCanvas;
}

// Canvas to Blob
function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.9) {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });
}

// Canvas to data URL
function canvasToDataUrl(canvas, type = 'image/jpeg', quality = 0.9) {
  return canvas.toDataURL(type, quality);
}

window.Compositor = {
  compositeOnCover,
  smartComposite,
  findBestCropCenter,
  createThumbnail,
  canvasToBlob,
  canvasToDataUrl,
  RX_RATIO,
  RY_RATIO,
  CY_SHIFT_RATIO,
  FILL_RATIO,
  RING_WIDTH,
};
