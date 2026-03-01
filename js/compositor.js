// compositor.js — Stable source-overlay compositing
//
// ARCHITECTURE (v10 — edge-estimated circular opening):
//   1) Estimate the medallion inner opening radius from radial edge strength.
//   2) Draw generated illustration first, large and centered.
//   3) Draw the source cover on top with a transparent inner circle.
//      This keeps all ornament/frame pixels physically above generated art.
//
// Rationale:
//   - The old tiny-oval punch under-filled the medallion.
//   - Angle-by-angle masks overfit illustration texture and created jagged cutouts.
//   - A smooth, edge-estimated inner circle is stable and preserves ornament integrity.

const INNER_RADIUS_RATIO_GUESS = 0.76;
const INNER_RADIUS_MIN_RATIO = 0.62;
const INNER_RADIUS_MAX_RATIO = 0.86;
const INNER_RADIUS_INSET_PX = 8;

const MASK_SCALE_START = 1.02;
const MASK_SCALE_STEP = 0.02;
const MASK_SCALE_MIN = 0.90;
const MAX_COMPOSE_ATTEMPTS = Math.floor((MASK_SCALE_START - MASK_SCALE_MIN) / MASK_SCALE_STEP) + 1;

const MAX_OUTER_EDGE_DIFF_PIXELS = 36;
const RING_SAMPLE_COUNT = 180;
const IMAGE_OVERDRAW_RATIO = 1.10;

// Exported for compatibility with debug/tools.
const CY_SHIFT_RATIO = 0;
const RX_RATIO = INNER_RADIUS_RATIO_GUESS;
const RY_RATIO = INNER_RADIUS_RATIO_GUESS;
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

function _sampleLuma(data, w, h, x, y) {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || iy < 0 || ix >= w || iy >= h) return 0;
  const idx = (iy * w + ix) * 4;
  const r = data[idx];
  const g = data[idx + 1];
  const b = data[idx + 2];
  return r * 0.299 + g * 0.587 + b * 0.114;
}

function _estimateInnerCircleRadius(coverCtx, W, H, cx, cy, outerRadius) {
  const pad = Math.round(outerRadius * 1.05);
  const x0 = Math.max(0, Math.floor(cx - pad));
  const y0 = Math.max(0, Math.floor(cy - pad));
  const x1 = Math.min(W, Math.ceil(cx + pad));
  const y1 = Math.min(H, Math.ceil(cy + pad));
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);

  const img = coverCtx.getImageData(x0, y0, w, h).data;
  const rMin = Math.round(outerRadius * 0.48);
  const rMax = Math.round(outerRadius * 0.92);
  const expected = outerRadius * INNER_RADIUS_RATIO_GUESS;

  let bestR = expected;
  let bestScore = -Infinity;

  for (let r = rMin; r <= rMax; r += 2) {
    let gradSum = 0;

    for (let i = 0; i < RING_SAMPLE_COUNT; i++) {
      const theta = (i / RING_SAMPLE_COUNT) * Math.PI * 2;
      const c = Math.cos(theta);
      const s = Math.sin(theta);

      const xA = cx + c * (r - 2) - x0;
      const yA = cy + s * (r - 2) - y0;
      const xB = cx + c * (r + 2) - x0;
      const yB = cy + s * (r + 2) - y0;
      gradSum += Math.abs(_sampleLuma(img, w, h, xB, yB) - _sampleLuma(img, w, h, xA, yA));
    }

    const meanGrad = gradSum / RING_SAMPLE_COUNT;
    const score = meanGrad - Math.abs(r - expected) * 0.03;
    if (score > bestScore) {
      bestScore = score;
      bestR = r;
    }
  }

  const clamped = Math.max(
    outerRadius * INNER_RADIUS_MIN_RATIO,
    Math.min(outerRadius * INNER_RADIUS_MAX_RATIO, bestR - INNER_RADIUS_INSET_PX)
  );

  return { radius: clamped, confidence: bestScore };
}

function _buildOverlayCanvas(coverImg, W, H, cx, cy, maskRadius) {
  const overlay = document.createElement('canvas');
  overlay.width = W;
  overlay.height = H;
  const octx = overlay.getContext('2d');
  octx.drawImage(coverImg, 0, 0, W, H);

  octx.globalCompositeOperation = 'destination-out';
  octx.fillStyle = 'rgba(0,0,0,1)';
  octx.beginPath();
  octx.arc(cx, cy, maskRadius, 0, Math.PI * 2);
  octx.closePath();
  octx.fill();

  // Slight feather for seam cleanup.
  octx.globalAlpha = 0.2;
  octx.lineWidth = 3;
  octx.strokeStyle = 'rgba(0,0,0,1)';
  octx.beginPath();
  octx.arc(cx, cy, maskRadius, 0, Math.PI * 2);
  octx.closePath();
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
  const base = _estimateInnerCircleRadius(coverCtx, W, H, cx, cy, radius);

  let fallbackCanvas = null;
  let bestCanvas = null;
  let bestEdgeDiff = Infinity;

  for (let attempt = 0; attempt < MAX_COMPOSE_ATTEMPTS; attempt++) {
    const scale = Math.max(MASK_SCALE_MIN, MASK_SCALE_START - attempt * MASK_SCALE_STEP);
    const maskRadius = Math.max(radius * INNER_RADIUS_MIN_RATIO, Math.min(radius * INNER_RADIUS_MAX_RATIO, base.radius * scale));
    const drawRadius = Math.round(maskRadius * IMAGE_OVERDRAW_RATIO);
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
    ctx.beginPath();
    ctx.arc(cx, cy, Math.round(maskRadius * 1.04), 0, Math.PI * 2);
    ctx.closePath();
    ctx.fill();

    ctx.drawImage(generatedImg, srcX, srcY, srcW, srcH, drawX, drawY, drawW, drawH);

    // Layer 2: original cover overlay with transparent opening.
    const overlayCanvas = _buildOverlayCanvas(coverImg, W, H, cx, cy, maskRadius);
    ctx.drawImage(overlayCanvas, 0, 0);

    const edgeDiff = _measureOuterEdgeDiffPixels(ctx, coverCtx, cx, cy, maskRadius, W, H);

    console.log(
      `[Compositor v10 circle-overlay] attempt=${attempt + 1}/${MAX_COMPOSE_ATTEMPTS} ` +
      `maskR=${Math.round(maskRadius)} draw=${drawW} edgeDiff=${edgeDiff} edgeConfidence=${base.confidence.toFixed(2)}`
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
