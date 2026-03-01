// compositor.js — Stable source-overlay compositing
//
// ARCHITECTURE (v12 — fixed template opening):
//   1) Draw generated illustration first (clipped to an inner medallion circle).
//   2) Draw source cover on top with that inner circle cut transparent.
//      This guarantees the ornamental frame remains above generated art.
//   3) If source art is already an RGBA overlay with transparent center,
//      draw it directly as the top layer.
//
// This aligns with the "adjust source files / transparent template" approach
// from the MEDALLION-FIX report and avoids fragile runtime boundary detection.

const INNER_RX_BASE_RATIO = 0.88;
const INNER_RY_BASE_RATIO = 0.96;
const INNER_RX_MIN_RATIO = 0.78;
const INNER_RX_MAX_RATIO = 0.94;
const INNER_RY_MIN_RATIO = 0.84;
const INNER_RY_MAX_RATIO = 0.99;
const INNER_RADIUS_SCALE_STEPS = [1.0, 0.985, 0.97, 0.955];
const INNER_FEATHER_PX = 8;

const MAX_OUTER_EDGE_DIFF_PIXELS = 36;
const RING_SAMPLE_COUNT = 180;
const IMAGE_OVERDRAW_RATIO = 1.12;

// Exported for compatibility with debug/tools.
const CY_SHIFT_RATIO = 0.01;
const RX_RATIO = INNER_RX_BASE_RATIO;
const RY_RATIO = INNER_RY_BASE_RATIO;
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
function compositeOnCover(coverImg, generatedImg, cx = 2850, cy = 1625, radius = 520) {
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

function _getRegionBounds(W, H, cx, cy, rx, ry, pad) {
  const x0 = Math.max(0, Math.floor(cx - rx - pad));
  const y0 = Math.max(0, Math.floor(cy - ry - pad));
  const x1 = Math.min(W, Math.ceil(cx + rx + pad));
  const y1 = Math.min(H, Math.ceil(cy + ry + pad));
  return { x0, y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

function _getInnerRadii(outerRadius, scale = 1) {
  const rxBase = outerRadius * INNER_RX_BASE_RATIO * scale;
  const ryBase = outerRadius * INNER_RY_BASE_RATIO * scale;
  const rx = Math.max(
    outerRadius * INNER_RX_MIN_RATIO,
    Math.min(outerRadius * INNER_RX_MAX_RATIO, rxBase)
  );
  const ry = Math.max(
    outerRadius * INNER_RY_MIN_RATIO,
    Math.min(outerRadius * INNER_RY_MAX_RATIO, ryBase)
  );
  return { rx, ry };
}

function _coverHasTransparentOpening(coverImg, W, H, cx, cy, rx, ry) {
  const probe = document.createElement('canvas');
  probe.width = W;
  probe.height = H;
  const pctx = probe.getContext('2d', { willReadFrequently: true });
  pctx.drawImage(coverImg, 0, 0, W, H);

  const sx = rx * 0.14;
  const sy = ry * 0.14;
  const samplePoints = [
    [cx, cy],
    [cx + sx, cy],
    [cx - sx, cy],
    [cx, cy + sy],
    [cx, cy - sy],
  ];

  for (const [x, y] of samplePoints) {
    const ix = Math.max(0, Math.min(W - 1, Math.round(x)));
    const iy = Math.max(0, Math.min(H - 1, Math.round(y)));
    const alpha = pctx.getImageData(ix, iy, 1, 1).data[3];
    if (alpha < 245) return true;
  }
  return false;
}

function _buildOverlayCanvas(coverImg, W, H, cx, cy, innerRx, innerRy, featherPx = INNER_FEATHER_PX) {
  const overlay = document.createElement('canvas');
  overlay.width = W;
  overlay.height = H;
  const octx = overlay.getContext('2d');
  octx.drawImage(coverImg, 0, 0, W, H);

  octx.globalCompositeOperation = 'destination-out';
  const hardRx = Math.max(0, innerRx - featherPx);
  const hardRy = Math.max(0, innerRy - featherPx);
  if (hardRx > 0 && hardRy > 0) {
    octx.fillStyle = 'rgba(0,0,0,1)';
    octx.beginPath();
    octx.ellipse(cx, cy, hardRx, hardRy, 0, 0, Math.PI * 2);
    octx.closePath();
    octx.fill();
  }

  if (featherPx > 0) {
    const start = Math.max(0, -featherPx);
    const end = featherPx;
    const span = Math.max(1, end - start);
    octx.lineWidth = 2;

    for (let d = start; d <= end; d += 1) {
      const t = (d - start) / span; // 0..1
      const alpha = Math.max(0, 1 - t);
      octx.strokeStyle = `rgba(0,0,0,${alpha.toFixed(3)})`;
      octx.beginPath();
      octx.ellipse(
        cx,
        cy,
        Math.max(1, innerRx + d),
        Math.max(1, innerRy + d),
        0,
        0,
        Math.PI * 2
      );
      octx.closePath();
      octx.stroke();
    }
  }

  octx.globalCompositeOperation = 'source-over';
  return overlay;
}

function _measureOuterEdgeDiffPixels(ctx, coverCtx, cx, cy, maskRx, maskRy, W, H) {
  const pad = Math.round(Math.max(maskRx, maskRy) * 0.25);
  const { x0, y0, w, h } = _getRegionBounds(W, H, cx, cy, maskRx, maskRy, pad);
  if (!w || !h) return 0;

  const comp = ctx.getImageData(x0, y0, w, h).data;
  const cov = coverCtx.getImageData(x0, y0, w, h).data;
  let diff = 0;

  for (let i = 0; i < RING_SAMPLE_COUNT; i++) {
    const theta = (i / RING_SAMPLE_COUNT) * Math.PI * 2;
    const c = Math.cos(theta);
    const s = Math.sin(theta);

    for (const offset of [8, 12, 16]) {
      const x = Math.round(cx + (maskRx + offset) * c);
      const y = Math.round(cy + (maskRy + offset) * s);
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
function smartComposite(coverImg, generatedImg, cx = 2850, cy = 1625, radius = 520) {
  const W = coverImg.width || 3784;
  const H = coverImg.height || 2777;
  const innerCy = cy + Math.round(radius * CY_SHIFT_RATIO);

  const detailCenter = findBestCropCenter(generatedImg);
  const cropCenterX = Math.max(0.15, Math.min(0.85, detailCenter.x));
  const cropCenterY = Math.max(0.15, Math.min(0.85, detailCenter.y));
  const fallbackFillColor = _estimateFallbackFillColor(generatedImg);

  const { coverCtx } = _drawCoverToCanvas(coverImg, W, H);
  const hasTransparentOpening = _coverHasTransparentOpening(
    coverImg,
    W,
    H,
    cx,
    innerCy,
    radius * 0.25,
    radius * 0.25
  );

  let fallbackCanvas = null;
  let bestCanvas = null;
  let bestEdgeDiff = Infinity;

  for (let attempt = 0; attempt < INNER_RADIUS_SCALE_STEPS.length; attempt++) {
    const scale = INNER_RADIUS_SCALE_STEPS[attempt];
    const { rx: innerRx, ry: innerRy } = _getInnerRadii(radius, scale);
    const drawW = Math.round((innerRx + INNER_FEATHER_PX) * 2 * IMAGE_OVERDRAW_RATIO);
    const drawH = Math.round((innerRy + INNER_FEATHER_PX) * 2 * IMAGE_OVERDRAW_RATIO);
    const drawX = Math.round(cx - drawW / 2);
    const drawY = Math.round(innerCy - drawH / 2);

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
    ctx.ellipse(cx, innerCy, innerRx + INNER_FEATHER_PX, innerRy + INNER_FEATHER_PX, 0, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, innerCy, innerRx, innerRy, 0, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(generatedImg, srcX, srcY, srcW, srcH, drawX, drawY, drawW, drawH);
    ctx.restore();

    // Layer 2: original cover overlay with transparent opening.
    if (hasTransparentOpening) {
      ctx.drawImage(coverImg, 0, 0, W, H);
    } else {
      const overlayCanvas = _buildOverlayCanvas(
        coverImg,
        W,
        H,
        cx,
        innerCy,
        innerRx,
        innerRy,
        INNER_FEATHER_PX
      );
      ctx.drawImage(overlayCanvas, 0, 0);
    }

    const edgeDiff = _measureOuterEdgeDiffPixels(ctx, coverCtx, cx, innerCy, innerRx, innerRy, W, H);

    console.log(
      `[Compositor v13 ellipse-template] attempt=${attempt + 1}/${INNER_RADIUS_SCALE_STEPS.length} ` +
      `scale=${scale.toFixed(3)} inner=(${Math.round(innerRx)}x${Math.round(innerRy)}) draw=(${drawW}x${drawH}) edgeDiff=${edgeDiff} alphaOverlay=${hasTransparentOpening}`
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
