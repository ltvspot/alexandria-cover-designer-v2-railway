// compositor.js — source-profile overlay compositing
//
// ARCHITECTURE (v14 — source-derived medallion profile):
//   1) Draw generated illustration first (clipped to medallion opening profile).
//   2) Draw source cover on top with that opening cut transparent.
//      This guarantees the ornamental frame remains above generated art.
//   3) If source art is already an RGBA overlay with transparent center,
//      draw it directly as the top layer.
//
// The opening profile is derived from real source covers to avoid the
// "too small ellipse" and "ornament bleed" failure modes.

const MEDALLION_PROFILE_RATIOS = [
  0.96586, 0.97110, 0.97910, 0.98807, 0.99559, 1.00094, 1.00465, 1.00589,
  1.00258, 0.99508, 0.98731, 0.98252, 0.97960, 0.97542, 0.96941, 0.96432,
  0.96273, 0.96424, 0.96571, 0.96391, 0.95853, 0.95301, 0.95145, 0.95450,
  0.95977, 0.96600, 0.97459, 0.98635, 0.99854, 1.00659, 1.00770, 1.00192,
  0.99110, 0.97808, 0.96627, 0.95833, 0.95477, 0.95459, 0.95712, 0.96202,
  0.96753, 0.97045, 0.96908, 0.96506, 0.96117, 0.95815, 0.95470, 0.94965,
  0.94320, 0.93665, 0.93162, 0.92935, 0.93007, 0.93267, 0.93530, 0.93672,
  0.93758, 0.93999, 0.94552, 0.95319, 0.95964, 0.96157, 0.95843, 0.95293,
  0.94859, 0.94697, 0.94757, 0.94964, 0.95297, 0.95693, 0.96036, 0.96291,
];

const PROFILE_MAX_RATIO = Math.max(...MEDALLION_PROFILE_RATIOS);
const PROFILE_MEAN_RATIO = MEDALLION_PROFILE_RATIOS.reduce((s, v) => s + v, 0) / MEDALLION_PROFILE_RATIOS.length;

const PROFILE_SCALE_STEPS = [1.0];
const INNER_FEATHER_PX = 8;
const IMAGE_OVERDRAW_RATIO = 1.12;

// Exported for compatibility with debug/tools.
const CY_SHIFT_RATIO = 0.01;
const RX_RATIO = 1;
const RY_RATIO = 1;
const FILL_RATIO = PROFILE_MEAN_RATIO;
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

function _coverHasTransparentOpening(coverImg, W, H, cx, cy, probeRadius) {
  const probe = document.createElement('canvas');
  probe.width = W;
  probe.height = H;
  const pctx = probe.getContext('2d', { willReadFrequently: true });
  pctx.drawImage(coverImg, 0, 0, W, H);

  const samplePoints = [
    [cx, cy],
    [cx + probeRadius, cy],
    [cx - probeRadius, cy],
    [cx, cy + probeRadius],
    [cx, cy - probeRadius],
  ];

  for (const [x, y] of samplePoints) {
    const ix = Math.max(0, Math.min(W - 1, Math.round(x)));
    const iy = Math.max(0, Math.min(H - 1, Math.round(y)));
    const alpha = pctx.getImageData(ix, iy, 1, 1).data[3];
    if (alpha < 245) return true;
  }
  return false;
}

function _traceMedallionPath(ctx, cx, cy, baseRadius, scale = 1, deltaPx = 0) {
  const n = MEDALLION_PROFILE_RATIOS.length;
  const effectiveBase = Math.max(1, baseRadius + deltaPx);

  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const theta = (i / n) * Math.PI * 2;
    const r = Math.max(1, effectiveBase * MEDALLION_PROFILE_RATIOS[i] * scale);
    const x = cx + r * Math.cos(theta);
    const y = cy + r * Math.sin(theta);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function _buildOverlayCanvas(coverImg, W, H, cx, cy, baseRadius, scale = 1, featherPx = INNER_FEATHER_PX) {
  const overlay = document.createElement('canvas');
  overlay.width = W;
  overlay.height = H;
  const octx = overlay.getContext('2d');
  octx.drawImage(coverImg, 0, 0, W, H);

  octx.globalCompositeOperation = 'destination-out';

  const hardDelta = Math.max(-baseRadius + 2, -featherPx);
  _traceMedallionPath(octx, cx, cy, baseRadius, scale, hardDelta);
  octx.fillStyle = 'rgba(0,0,0,1)';
  octx.fill();

  if (featherPx > 0) {
    const start = -featherPx;
    const end = featherPx;
    const span = Math.max(1, end - start);
    octx.lineWidth = 2;

    for (let d = start; d <= end; d += 1) {
      const t = (d - start) / span; // 0..1
      const alpha = Math.max(0, 1 - t);
      octx.strokeStyle = `rgba(0,0,0,${alpha.toFixed(3)})`;
      _traceMedallionPath(octx, cx, cy, baseRadius, scale, d);
      octx.stroke();
    }
  }

  octx.globalCompositeOperation = 'source-over';
  return overlay;
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

  const hasTransparentOpening = _coverHasTransparentOpening(
    coverImg,
    W,
    H,
    cx,
    innerCy,
    radius * 0.22
  );

  let fallbackCanvas = null;

  for (let attempt = 0; attempt < PROFILE_SCALE_STEPS.length; attempt++) {
    const scale = PROFILE_SCALE_STEPS[attempt];
    const maxProfileRadius = Math.max(1, (radius + INNER_FEATHER_PX) * PROFILE_MAX_RATIO * scale);

    const drawW = Math.round(maxProfileRadius * 2 * IMAGE_OVERDRAW_RATIO);
    const drawH = drawW;
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
    _traceMedallionPath(ctx, cx, innerCy, radius, scale, INNER_FEATHER_PX);
    ctx.fill();

    ctx.save();
    _traceMedallionPath(ctx, cx, innerCy, radius, scale, 0);
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
        radius,
        scale,
        INNER_FEATHER_PX
      );
      ctx.drawImage(overlayCanvas, 0, 0);
    }

    console.log(
      `[Compositor v14 profile-template] attempt=${attempt + 1}/${PROFILE_SCALE_STEPS.length} ` +
      `scale=${scale.toFixed(3)} profile=${MEDALLION_PROFILE_RATIOS.length} ` +
      `draw=(${drawW}x${drawH}) alphaOverlay=${hasTransparentOpening}`
    );

    fallbackCanvas = canvas;
    return canvas;
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
