// compositor.js — Canvas-based compositing with hard inner-oval clipping
//
// ARCHITECTURE (v6 — ornament-safe inner oval):
//   1) Draw original cover unchanged.
//   2) Draw generated illustration ONLY inside a conservative inner oval clip.
//   3) Repaint cover outside that oval to guarantee no bleed into ornament/frame zones.
//
// This intentionally prioritizes frame integrity over maximal fill. The decorative
// ring and scrollwork stay intact even when generation/crop varies.

// Ratios are relative to detected OUTER medallion radius.
// Tuned conservatively from sampled source covers to avoid ornament overlap.
const CY_SHIFT_RATIO = 0.20;
const RX_RATIO = 0.46;
const RY_RATIO = 0.69;
const SAFE_MIN_SHRINK = 0.82;
const SHRINK_STEP = 0.05;
const MAX_COMPOSE_ATTEMPTS = 5;
const MAX_RING_DIFF_PIXELS = 160;

// Kept for backward compatibility with existing debug/tools exports.
const FILL_RATIO = 1.0;
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

function _restoreCoverOutsideEllipse(ctx, coverImg, W, H, cx, cy, rx, ry) {
  const outsideCanvas = document.createElement('canvas');
  outsideCanvas.width = W;
  outsideCanvas.height = H;
  const octx = outsideCanvas.getContext('2d');

  octx.drawImage(coverImg, 0, 0, W, H);
  octx.globalCompositeOperation = 'destination-out';
  octx.beginPath();
  octx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  octx.closePath();
  octx.fill();
  octx.globalCompositeOperation = 'source-over';

  ctx.drawImage(outsideCanvas, 0, 0);
}

function _isOrnamentPixel(r, g, b) {
  const strongGold = r > 145 && g > 105 && b < 135 && r > g && g > b;
  const warmIvory = r > 170 && g > 145 && b > 100 && (r - g) < 65 && (g - b) < 60;
  return strongGold || warmIvory;
}

function _getRegionBounds(W, H, cx, cy, rx, ry, padX, padY) {
  const x0 = Math.max(0, Math.floor(cx - rx - padX));
  const y0 = Math.max(0, Math.floor(cy - ry - padY));
  const x1 = Math.min(W, Math.ceil(cx + rx + padX));
  const y1 = Math.min(H, Math.ceil(cy + ry + padY));
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

function _protectOrnamentPixels(ctx, coverCtx, cx, cy, rx, ry, W, H) {
  const padX = Math.round(rx * 0.7);
  const padY = Math.round(ry * 0.7);
  const { x0, y0, w, h } = _getRegionBounds(W, H, cx, cy, rx, ry, padX, padY);
  if (!w || !h) return 0;

  const comp = ctx.getImageData(x0, y0, w, h);
  const cov = coverCtx.getImageData(x0, y0, w, h);
  const cd = comp.data;
  const od = cov.data;
  let restored = 0;

  for (let py = 0; py < h; py++) {
    const y = y0 + py;
    for (let px = 0; px < w; px++) {
      const x = x0 + px;
      const idx = (py * w + px) * 4;
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      const d2 = nx * nx + ny * ny;

      // Only guard ring/ornament zones near the oval edge.
      if (d2 < 0.72 || d2 > 2.0) continue;

      const r = od[idx];
      const g = od[idx + 1];
      const b = od[idx + 2];
      if (!_isOrnamentPixel(r, g, b)) continue;

      if (cd[idx] !== r || cd[idx + 1] !== g || cd[idx + 2] !== b || cd[idx + 3] !== od[idx + 3]) {
        cd[idx] = r;
        cd[idx + 1] = g;
        cd[idx + 2] = b;
        cd[idx + 3] = od[idx + 3];
        restored++;
      }
    }
  }

  ctx.putImageData(comp, x0, y0);
  return restored;
}

function _measureRingDiffPixels(ctx, coverCtx, cx, cy, rx, ry, W, H) {
  const padX = Math.round(rx * 0.7);
  const padY = Math.round(ry * 0.7);
  const { x0, y0, w, h } = _getRegionBounds(W, H, cx, cy, rx, ry, padX, padY);
  if (!w || !h) return 0;

  const comp = ctx.getImageData(x0, y0, w, h).data;
  const cov = coverCtx.getImageData(x0, y0, w, h).data;
  let diffPixels = 0;

  for (let py = 0; py < h; py++) {
    const y = y0 + py;
    for (let px = 0; px < w; px++) {
      const x = x0 + px;
      const idx = (py * w + px) * 4;
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      const d2 = nx * nx + ny * ny;

      if (d2 < 0.72 || d2 > 2.0) continue;

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

// ---------------------------------------------------------------------------
// smartComposite — hard inner-oval replacement with ornament protection
// ---------------------------------------------------------------------------
function smartComposite(coverImg, generatedImg, cx = 2850, cy = 1350, radius = 520) {
  const W = coverImg.width || 3784;
  const H = coverImg.height || 2777;

  const innerCy = cy + Math.round(radius * CY_SHIFT_RATIO);
  const baseRx = Math.round(radius * RX_RATIO);
  const baseRy = Math.round(radius * RY_RATIO);

  const detailCenter = findBestCropCenter(generatedImg);
  const cropCenterX = Math.max(0.15, Math.min(0.85, detailCenter.x));
  const cropCenterY = Math.max(0.15, Math.min(0.85, detailCenter.y));

  const { coverCtx } = _drawCoverToCanvas(coverImg, W, H);
  let fallbackCanvas = null;

  for (let attempt = 0; attempt < MAX_COMPOSE_ATTEMPTS; attempt++) {
    const scale = Math.max(SAFE_MIN_SHRINK, 1 - attempt * SHRINK_STEP);
    const rx = Math.max(120, Math.round(baseRx * scale));
    const ry = Math.max(180, Math.round(baseRy * scale));

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // Layer 1: original cover untouched.
    ctx.drawImage(coverImg, 0, 0, W, H);

    // Layer 2: generated art clipped to inner oval only.
    const destAspect = rx / ry;
    const { srcX, srcY, srcW, srcH } = _fitSourceRectToDestAspect(
      generatedImg.width,
      generatedImg.height,
      destAspect,
      cropCenterX,
      cropCenterY
    );

    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, innerCy, rx, ry, 0, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(
      generatedImg,
      srcX,
      srcY,
      srcW,
      srcH,
      cx - rx,
      innerCy - ry,
      rx * 2,
      ry * 2
    );
    ctx.restore();

    // Layer 3: hard safety pass — restore everything outside oval from cover.
    _restoreCoverOutsideEllipse(ctx, coverImg, W, H, cx, innerCy, rx, ry);

    // Layer 4: restore ornament/ring pixels from the original cover.
    const restored = _protectOrnamentPixels(ctx, coverCtx, cx, innerCy, rx, ry, W, H);
    const ringDiff = _measureRingDiffPixels(ctx, coverCtx, cx, innerCy, rx, ry, W, H);

    console.log(
      `[Compositor v7] attempt=${attempt + 1}/${MAX_COMPOSE_ATTEMPTS} scale=${scale.toFixed(2)} ` +
      `inner=(${cx},${innerCy}) rx=${rx} ry=${ry} restored=${restored} ringDiff=${ringDiff}`
    );

    fallbackCanvas = canvas;
    if (ringDiff <= MAX_RING_DIFF_PIXELS) {
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
