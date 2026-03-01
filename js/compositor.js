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

const MASK_SCALE_START = 1.0;
const MASK_SCALE_STEP = 0.02;
const MASK_SCALE_MIN = 0.86;
const MAX_COMPOSE_ATTEMPTS = Math.floor((MASK_SCALE_START - MASK_SCALE_MIN) / MASK_SCALE_STEP) + 1;
const MAX_PROFILE_EDGE_DIFF_PIXELS = 42;
const MASK_STEPS = 360;
const IMAGE_OVERDRAW_RATIO = 1.12;
const PROFILE_INSET_PX = 12;

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

function _buildEdgeGuidedProfile(coverCtx, W, H, cx, cy, radius) {
  const pad = Math.round(radius * 1.05);
  const x0 = Math.max(0, Math.floor(cx - pad));
  const y0 = Math.max(0, Math.floor(cy - pad));
  const x1 = Math.min(W, Math.ceil(cx + pad));
  const y1 = Math.min(H, Math.ceil(cy + pad));
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  const img = coverCtx.getImageData(x0, y0, w, h).data;

  const profile = new Float32Array(MASK_STEPS + 1);
  let gradTotal = 0;

  for (let i = 0; i <= MASK_STEPS; i++) {
    const theta = (i / MASK_STEPS) * Math.PI * 2;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const expected = _innerRadiusAtAngle(radius, theta, 1);
    const rMin = Math.max(radius * 0.45, expected - 80);
    const rMax = Math.min(radius * 0.97, expected + 80);

    let bestR = expected;
    let bestScore = -Infinity;
    let bestGrad = 0;

    for (let r = rMin + 2; r <= rMax - 2; r += 2) {
      const xA = cx + cosT * (r - 2) - x0;
      const yA = cy + sinT * (r - 2) - y0;
      const xB = cx + cosT * (r + 2) - x0;
      const yB = cy + sinT * (r + 2) - y0;
      const grad = Math.abs(_sampleLuma(img, w, h, xB, yB) - _sampleLuma(img, w, h, xA, yA));
      const score = grad - Math.abs(r - expected) * 0.08;

      if (score > bestScore) {
        bestScore = score;
        bestR = r;
        bestGrad = grad;
      }
    }

    gradTotal += bestGrad;
    profile[i] = Math.max(radius * 0.55, bestR - PROFILE_INSET_PX);
  }

  // Circular smooth (9-point moving average) to remove noisy spikes.
  const smooth = new Float32Array(MASK_STEPS + 1);
  for (let i = 0; i <= MASK_STEPS; i++) {
    let sum = 0;
    let n = 0;
    for (let k = -4; k <= 4; k++) {
      let j = i + k;
      if (j < 0) j += MASK_STEPS;
      if (j > MASK_STEPS) j -= MASK_STEPS;
      sum += profile[j];
      n++;
    }
    smooth[i] = sum / n;
  }

  return {
    profile: smooth,
    confidence: gradTotal / (MASK_STEPS + 1),
  };
}

function _traceMaskPath(ctx, cx, cy, radius, scale = 1, profile = null) {
  ctx.beginPath();
  for (let i = 0; i <= MASK_STEPS; i++) {
    const theta = (i / MASK_STEPS) * Math.PI * 2;
    const baseR = profile ? profile[i] : _innerRadiusAtAngle(radius, theta, 1);
    const r = Math.max(radius * 0.52, baseR * scale);
    const x = cx + r * Math.cos(theta);
    const y = cy + r * Math.sin(theta);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function _maskBounds(cx, cy, radius, scale = 1, profile = null) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i <= MASK_STEPS; i++) {
    const theta = (i / MASK_STEPS) * Math.PI * 2;
    const baseR = profile ? profile[i] : _innerRadiusAtAngle(radius, theta, 1);
    const r = Math.max(radius * 0.52, baseR * scale);
    const x = cx + r * Math.cos(theta);
    const y = cy + r * Math.sin(theta);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

function _buildOverlayCanvas(coverImg, W, H, cx, cy, radius, scale = 1, profile = null) {
  const overlay = document.createElement('canvas');
  overlay.width = W;
  overlay.height = H;
  const octx = overlay.getContext('2d');
  octx.drawImage(coverImg, 0, 0, W, H);

  octx.globalCompositeOperation = 'destination-out';
  octx.fillStyle = 'rgba(0,0,0,1)';
  _traceMaskPath(octx, cx, cy, radius, scale, profile);
  octx.fill();

  // Soften only the cut edge very slightly to avoid jagged seams.
  octx.globalAlpha = 0.25;
  octx.lineWidth = 3;
  octx.strokeStyle = 'rgba(0,0,0,1)';
  _traceMaskPath(octx, cx, cy, radius, scale, profile);
  octx.stroke();
  octx.globalAlpha = 1;
  octx.globalCompositeOperation = 'source-over';

  return overlay;
}

function _measureProfileEdgeDiffPixels(ctx, coverCtx, cx, cy, profile, scale, W, H) {
  const pad = Math.round(Math.max(40, Math.min(260, (Math.max(...profile) || 400) * 0.15)));
  const outer = Math.max(...profile) * scale + 26;
  const { x0, y0, w, h } = _getRegionBounds(W, H, cx, cy, outer, pad);
  if (!w || !h) return 0;

  const comp = ctx.getImageData(x0, y0, w, h).data;
  const cov = coverCtx.getImageData(x0, y0, w, h).data;
  let diff = 0;

  // Sample just outside the boundary where frame pixels should be unchanged.
  for (let i = 0; i < MASK_STEPS; i += 2) {
    const theta = (i / MASK_STEPS) * Math.PI * 2;
    const r0 = profile[i] * scale;
    for (const offset of [8, 12, 16]) {
      const x = Math.round(cx + (r0 + offset) * Math.cos(theta));
      const y = Math.round(cy + (r0 + offset) * Math.sin(theta));
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

  const { coverCtx } = _drawCoverToCanvas(coverImg, W, H);
  const edgeGuided = _buildEdgeGuidedProfile(coverCtx, W, H, cx, cy, radius);
  const profile = edgeGuided.profile;

  let fallbackCanvas = null;
  let bestCanvas = null;
  let bestEdgeDiff = Infinity;

  for (let attempt = 0; attempt < MAX_COMPOSE_ATTEMPTS; attempt++) {
    const scale = Math.max(MASK_SCALE_MIN, MASK_SCALE_START - attempt * MASK_SCALE_STEP);
    const mask = _maskBounds(cx, cy, radius, scale, profile);
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
    const overlayCanvas = _buildOverlayCanvas(coverImg, W, H, cx, cy, radius, scale, profile);
    ctx.drawImage(overlayCanvas, 0, 0);

    const edgeDiff = _measureProfileEdgeDiffPixels(ctx, coverCtx, cx, cy, profile, scale, W, H);

    console.log(
      `[Compositor v9 edge-mask] attempt=${attempt + 1}/${MAX_COMPOSE_ATTEMPTS} scale=${scale.toFixed(2)} ` +
      `draw=(${drawW}x${drawH}) edgeDiff=${edgeDiff} edgeConfidence=${edgeGuided.confidence.toFixed(2)}`
    );

    fallbackCanvas = canvas;
    if (edgeDiff < bestEdgeDiff) {
      bestEdgeDiff = edgeDiff;
      bestCanvas = canvas;
    }
    if (edgeDiff <= MAX_PROFILE_EDGE_DIFF_PIXELS) {
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
