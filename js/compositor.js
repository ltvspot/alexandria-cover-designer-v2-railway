// compositor.js — Stable source-overlay compositing
//
// ARCHITECTURE (v11 — deterministic source-overlay opening):
//   1) Draw generated illustration first (clipped to a medallion opening path).
//   2) Draw the source cover on top with that opening cut transparent.
//      This keeps ornamental/frame pixels physically above generated art.
//   3) If the source cover already has an alpha opening (future PNG overlays),
//      use it directly (no runtime hole punching).
//
// This follows the "source-file adjustment" direction from the report:
// frame pixels must always be the top-most layer.

const OPENING_BASE_RATIO = 420 / 520;
const OPENING_TOP_INDENT_RATIO = 70 / 520;
const OPENING_BOTTOM_EXPAND_RATIO = 30 / 520;
const OPENING_SIDE_INDENT_RATIO = 15 / 520;
const OPENING_OVAL_BIAS_RATIO = 15 / 520;
const OPENING_INSET_PX = 8;
const OPENING_SEGMENTS = 720;

const MASK_SCALE_START = 1.0;
const MASK_SCALE_STEP = 0.02;
const MASK_SCALE_MIN = 0.94;
const MAX_COMPOSE_ATTEMPTS = Math.floor((MASK_SCALE_START - MASK_SCALE_MIN) / MASK_SCALE_STEP) + 1;

const MAX_OUTER_EDGE_DIFF_PIXELS = 36;
const RING_SAMPLE_COUNT = 180;
const IMAGE_OVERDRAW_RATIO = 1.12;

// Exported for compatibility with debug/tools.
const CY_SHIFT_RATIO = 0;
const RX_RATIO = OPENING_BASE_RATIO;
const RY_RATIO = OPENING_BASE_RATIO;
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

function _estimateFallbackFillColor(imageElement) {
  const size = 40;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(imageElement, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;

  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let n = 0;

  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 20) continue;
    rSum += data[i];
    gSum += data[i + 1];
    bSum += data[i + 2];
    n++;
  }

  if (!n) return 'rgb(30,30,30)';
  return `rgb(${Math.round(rSum / n)}, ${Math.round(gSum / n)}, ${Math.round(bSum / n)})`;
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

function _drawCoverToCanvas(coverImg, W, H) {
  const coverCanvas = document.createElement('canvas');
  coverCanvas.width = W;
  coverCanvas.height = H;
  const coverCtx = coverCanvas.getContext('2d');
  coverCtx.drawImage(coverImg, 0, 0, W, H);
  return { coverCanvas, coverCtx };
}

function _getRegionBounds(W, H, cx, cy, radius, pad) {
  const x0 = Math.max(0, Math.floor(cx - radius - pad));
  const y0 = Math.max(0, Math.floor(cy - radius - pad));
  const x1 = Math.min(W, Math.ceil(cx + radius + pad));
  const y1 = Math.min(H, Math.ceil(cy + radius + pad));
  return { x0, y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

function _angleDelta(a, b) {
  const TAU = Math.PI * 2;
  let d = Math.abs(a - b) % TAU;
  if (d > Math.PI) d = TAU - d;
  return d;
}

function _openingRadiusAt(theta, outerRadius) {
  const topDelta = _angleDelta(theta, Math.PI * 1.5);
  const bottomDelta = _angleDelta(theta, Math.PI * 0.5);
  const rightDelta = _angleDelta(theta, 0);
  const leftDelta = _angleDelta(theta, Math.PI);

  const topIndent = outerRadius * OPENING_TOP_INDENT_RATIO * Math.exp(-(topDelta * topDelta) / 0.09);
  const bottomExpand = outerRadius * OPENING_BOTTOM_EXPAND_RATIO * Math.exp(-(bottomDelta * bottomDelta) / 0.16);
  const rightIndent = outerRadius * OPENING_SIDE_INDENT_RATIO * Math.exp(-(rightDelta * rightDelta) / 0.04);
  const leftIndent = outerRadius * OPENING_SIDE_INDENT_RATIO * Math.exp(-(leftDelta * leftDelta) / 0.04);
  const ovalBias = outerRadius * OPENING_OVAL_BIAS_RATIO * Math.cos(2 * theta);

  return (outerRadius * OPENING_BASE_RATIO) - topIndent + bottomExpand - rightIndent - leftIndent - ovalBias;
}

function _getOpeningRadiusRange(outerRadius, scale = 1) {
  let minR = Infinity;
  let maxR = -Infinity;

  for (let i = 0; i < OPENING_SEGMENTS; i++) {
    const theta = (i / OPENING_SEGMENTS) * Math.PI * 2;
    const r = Math.max(outerRadius * 0.56, _openingRadiusAt(theta, outerRadius) * scale - OPENING_INSET_PX);
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
  }

  return { minR, maxR };
}

function _traceOpeningPath(ctx, cx, cy, outerRadius, scale = 1) {
  ctx.beginPath();

  for (let i = 0; i <= OPENING_SEGMENTS; i++) {
    const theta = (i / OPENING_SEGMENTS) * Math.PI * 2;
    const r = Math.max(outerRadius * 0.56, _openingRadiusAt(theta, outerRadius) * scale - OPENING_INSET_PX);
    const x = cx + Math.cos(theta) * r;
    const y = cy + Math.sin(theta) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }

  ctx.closePath();
}

function _coverHasTransparentOpening(coverImg, W, H, cx, cy, radius) {
  const probe = document.createElement('canvas');
  probe.width = W;
  probe.height = H;
  const pctx = probe.getContext('2d', { willReadFrequently: true });
  pctx.drawImage(coverImg, 0, 0, W, H);

  const samplePoints = [
    [cx, cy],
    [cx + radius * 0.14, cy],
    [cx - radius * 0.14, cy],
    [cx, cy + radius * 0.14],
    [cx, cy - radius * 0.14],
  ];

  for (const [x, y] of samplePoints) {
    const ix = Math.max(0, Math.min(W - 1, Math.round(x)));
    const iy = Math.max(0, Math.min(H - 1, Math.round(y)));
    const alpha = pctx.getImageData(ix, iy, 1, 1).data[3];
    if (alpha < 245) return true;
  }
  return false;
}

function _buildOverlayCanvas(coverImg, W, H, cx, cy, outerRadius, scale) {
  const overlay = document.createElement('canvas');
  overlay.width = W;
  overlay.height = H;
  const octx = overlay.getContext('2d');
  octx.drawImage(coverImg, 0, 0, W, H);

  octx.globalCompositeOperation = 'destination-out';
  octx.fillStyle = 'rgba(0,0,0,1)';
  _traceOpeningPath(octx, cx, cy, outerRadius, scale);
  octx.fill();

  // Slight feather for seam cleanup.
  octx.globalAlpha = 0.2;
  octx.lineWidth = 3;
  octx.strokeStyle = 'rgba(0,0,0,1)';
  _traceOpeningPath(octx, cx, cy, outerRadius, scale);
  octx.stroke();

  octx.globalAlpha = 1;
  octx.globalCompositeOperation = 'source-over';
  return overlay;
}

function _measureOuterEdgeDiffPixels(ctx, coverCtx, cx, cy, maskRadius, W, H) {
  const pad = Math.round(maskRadius * 0.25);
  const { x0, y0, w, h } = _getRegionBounds(W, H, cx, cy, maskRadius, pad);
  if (!w || !h) return 0;

  const comp = ctx.getImageData(x0, y0, w, h).data;
  const cov = coverCtx.getImageData(x0, y0, w, h).data;
  let diff = 0;

  for (let i = 0; i < RING_SAMPLE_COUNT; i++) {
    const theta = (i / RING_SAMPLE_COUNT) * Math.PI * 2;
    const c = Math.cos(theta);
    const s = Math.sin(theta);

    for (const offset of [8, 12, 16]) {
      const x = Math.round(cx + (maskRadius + offset) * c);
      const y = Math.round(cy + (maskRadius + offset) * s);
      const lx = x - x0;
      const ly = y - y0;
      if (lx < 0 || ly < 0 || lx >= w || ly >= h) continue;

      const idx = (ly * w + lx) * 4;
      const dr = Math.abs(comp[idx] - cov[idx]);
      const dg = Math.abs(comp[idx + 1] - cov[idx + 1]);
      const db = Math.abs(comp[idx + 2] - cov[idx + 2]);
      if (dr + dg + db > 28) diff++;
    }
  }

  return diff;
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
  const fallbackFillColor = _estimateFallbackFillColor(generatedImg);

  const { coverCtx } = _drawCoverToCanvas(coverImg, W, H);
  const hasTransparentOpening = _coverHasTransparentOpening(coverImg, W, H, cx, cy, radius);

  let fallbackCanvas = null;
  let bestCanvas = null;
  let bestEdgeDiff = Infinity;

  for (let attempt = 0; attempt < MAX_COMPOSE_ATTEMPTS; attempt++) {
    const scale = Math.max(MASK_SCALE_MIN, MASK_SCALE_START - attempt * MASK_SCALE_STEP);
    const openingRange = _getOpeningRadiusRange(radius, scale);
    const drawRadius = Math.round(openingRange.maxR * IMAGE_OVERDRAW_RATIO);
    const drawW = drawRadius * 2;
    const drawH = drawRadius * 2;
    const drawX = Math.round(cx - drawRadius);
    const drawY = Math.round(cy - drawRadius);

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    const destAspect = drawW / drawH;
    const { srcX, srcY, srcW, srcH } = _fitSourceRectToDestAspect(
      generatedImg.width,
      generatedImg.height,
      destAspect,
      cropCenterX,
      cropCenterY
    );

    // Layer 1: base fill + generated illustration.
    // Some providers return transparent edges; this prevents old cover pixels
    // from showing through inside the medallion opening.
    ctx.fillStyle = fallbackFillColor;
    _traceOpeningPath(ctx, cx, cy, radius, scale);
    ctx.fill();

    ctx.save();
    _traceOpeningPath(ctx, cx, cy, radius, scale);
    ctx.clip();
    ctx.drawImage(generatedImg, srcX, srcY, srcW, srcH, drawX, drawY, drawW, drawH);
    ctx.restore();

    // Layer 2: original cover overlay with transparent opening.
    if (hasTransparentOpening) {
      ctx.drawImage(coverImg, 0, 0, W, H);
    } else {
      const overlayCanvas = _buildOverlayCanvas(coverImg, W, H, cx, cy, radius, scale);
      ctx.drawImage(overlayCanvas, 0, 0);
    }

    const edgeDiff = _measureOuterEdgeDiffPixels(ctx, coverCtx, cx, cy, openingRange.maxR, W, H);

    console.log(
      `[Compositor v11 source-overlay] attempt=${attempt + 1}/${MAX_COMPOSE_ATTEMPTS} ` +
      `scale=${scale.toFixed(2)} maxR=${Math.round(openingRange.maxR)} draw=${drawW} edgeDiff=${edgeDiff} alphaOverlay=${hasTransparentOpening}`
    );

    fallbackCanvas = canvas;
    if (edgeDiff < bestEdgeDiff) {
      bestEdgeDiff = edgeDiff;
      bestCanvas = canvas;
    }
    if (edgeDiff <= MAX_OUTER_EDGE_DIFF_PIXELS) {
      return canvas;
    }
  }

  return bestCanvas || fallbackCanvas;
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
