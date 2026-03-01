// compositor.js — source-profile overlay compositing
//
// ARCHITECTURE (v15 — per-cover auto-detect + content-aware zoom):
//   1) Auto-detect medallion geometry per cover from ring pixels.
//   2) Derive opening radius from detected outer ring.
//   3) Draw generated illustration first (clipped to medallion opening profile).
//   4) Draw source cover on top with that opening cut transparent.
//      This guarantees the ornamental frame remains above generated art.
//   5) If source art is already an RGBA overlay with transparent center,
//      draw it directly as the top layer.
//
// This applies the approach from Medallion-Centering-Fix-Report-latest:
// dynamic geometry instead of fixed center/radius plus sparse-output zoom.

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
const PROFILE_INDENT_STRENGTH = 0.55;

const PROFILE_SCALE_STEPS = [1.0];
const INNER_FEATHER_PX = 8;
const IMAGE_OVERDRAW_RATIO = 1.12;

const DETECTION_ANALYSIS_W = 420;
const DETECTION_COARSE_STEP = 4;
const DETECTION_FINE_STEP = 1;
const DETECTION_CANDIDATE_SAMPLES_COARSE = 96;
const DETECTION_CANDIDATE_SAMPLES_FINE = 180;
const DETECTION_OPENING_RATIO = 0.965;
const DETECTION_OPENING_MIN = 360;
const DETECTION_OPENING_MAX = 530;

const CONTENT_SCAN_MAX_DIM = 320;
const CONTENT_BG_BORDER = 8;
const CONTENT_DIFF_THRESHOLD = 54;
const CONTENT_SAT_THRESHOLD = 30;
const CONTENT_BOX_APPLY_MAX_AREA = 0.78;

const DETECTION_CACHE = new WeakMap();

// Exported for compatibility with debug/tools.
const CY_SHIFT_RATIO = 0.01;
const RX_RATIO = 1;
const RY_RATIO = 1;
const FILL_RATIO = PROFILE_MEAN_RATIO;
const RING_WIDTH = 0;

function _clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function _buildRingSamples(count) {
  const arr = new Array(count);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    arr[i] = { c: Math.cos(a), s: Math.sin(a) };
  }
  return arr;
}

const RING_SAMPLES_COARSE = _buildRingSamples(DETECTION_CANDIDATE_SAMPLES_COARSE);
const RING_SAMPLES_FINE = _buildRingSamples(DETECTION_CANDIDATE_SAMPLES_FINE);

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

function _detectForegroundBoxNormalized(imageElement) {
  const imgW = imageElement.width;
  const imgH = imageElement.height;
  if (!imgW || !imgH) return null;

  const scale = CONTENT_SCAN_MAX_DIM / Math.max(imgW, imgH);
  const w = Math.max(1, Math.round(imgW * scale));
  const h = Math.max(1, Math.round(imgH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(imageElement, 0, 0, w, h);

  const data = ctx.getImageData(0, 0, w, h).data;

  let bgR = 0;
  let bgG = 0;
  let bgB = 0;
  let bgN = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (
        x < CONTENT_BG_BORDER ||
        y < CONTENT_BG_BORDER ||
        x >= w - CONTENT_BG_BORDER ||
        y >= h - CONTENT_BG_BORDER
      ) {
        const idx = (y * w + x) * 4;
        if (data[idx + 3] < 10) continue;
        bgR += data[idx];
        bgG += data[idx + 1];
        bgB += data[idx + 2];
        bgN++;
      }
    }
  }

  if (!bgN) return null;
  bgR /= bgN;
  bgG /= bgN;
  bgB /= bgN;

  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  let fgCount = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const a = data[idx + 3];

      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const sat = maxC - minC;
      const diff = Math.abs(r - bgR) + Math.abs(g - bgG) + Math.abs(b - bgB);

      const isForeground =
        a < 245 ||
        diff > CONTENT_DIFF_THRESHOLD ||
        (sat > CONTENT_SAT_THRESHOLD && diff > CONTENT_DIFF_THRESHOLD * 0.6);

      if (!isForeground) continue;

      fgCount++;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (fgCount <= 0 || maxX < minX || maxY < minY) return null;

  const boxW = maxX - minX + 1;
  const boxH = maxY - minY + 1;
  const boxArea = (boxW * boxH) / (w * h);
  const fgCoverage = fgCount / (w * h);

  if (boxArea >= CONTENT_BOX_APPLY_MAX_AREA) return null;

  return {
    x: minX / w,
    y: minY / h,
    w: boxW / w,
    h: boxH / h,
    boxArea,
    fgCoverage,
  };
}

// ---------------------------------------------------------------------------
// compositeOnCover — backward compat wrapper
// ---------------------------------------------------------------------------
function compositeOnCover(coverImg, generatedImg, cx = 2850, cy = 1625, radius = 520) {
  return smartComposite(coverImg, generatedImg, cx, cy, radius);
}

function _fitSourceRectToDestAspect(imgW, imgH, destAspect, cropCenterX, cropCenterY, contentBox = null) {
  if (contentBox) {
    const boxCx = (contentBox.x + contentBox.w / 2) * imgW;
    const boxCy = (contentBox.y + contentBox.h / 2) * imgH;
    const boxW = Math.max(1, contentBox.w * imgW);
    const boxH = Math.max(1, contentBox.h * imgH);

    const margin = contentBox.boxArea < 0.18 ? 0.48 : contentBox.boxArea < 0.35 ? 0.36 : 0.28;
    let srcW = boxW * (1 + margin * 2);
    let srcH = boxH * (1 + margin * 2);

    if (srcW / srcH > destAspect) {
      srcH = srcW / destAspect;
    } else {
      srcW = srcH * destAspect;
    }

    srcW = Math.min(imgW, Math.max(1, Math.round(srcW)));
    srcH = Math.min(imgH, Math.max(1, Math.round(srcH)));

    let srcX = Math.round(boxCx - srcW / 2);
    let srcY = Math.round(boxCy - srcH / 2);

    srcX = Math.max(0, Math.min(imgW - srcW, srcX));
    srcY = Math.max(0, Math.min(imgH - srcH, srcY));

    return { srcX, srcY, srcW, srcH, usedContentBox: true };
  }

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

  return { srcX, srcY, srcW, srcH, usedContentBox: false };
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
    const raw = MEDALLION_PROFILE_RATIOS[i];
    const softened = 1 + (raw - 1) * PROFILE_INDENT_STRENGTH;
    const r = Math.max(1, effectiveBase * softened * scale);
    const x = cx + r * Math.cos(theta);
    const y = cy + r * Math.sin(theta);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function _scoreRingCandidate(channels, width, height, cx, cy, r, samples, includeContrast) {
  const { warm, sat, lum } = channels;

  let warmSum = 0;
  let satSum = 0;
  let innerLumSum = 0;
  let outerLumSum = 0;
  let ringCount = 0;
  let contrastCount = 0;

  for (let i = 0; i < samples.length; i++) {
    const u = samples[i];
    const x = Math.round(cx + r * u.c);
    const y = Math.round(cy + r * u.s);
    if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) continue;

    const idx = y * width + x;
    warmSum += warm[idx];
    satSum += sat[idx];
    ringCount++;

    if (includeContrast) {
      const innerR = r - 6;
      const outerR = r + 6;
      const ix = Math.round(cx + innerR * u.c);
      const iy = Math.round(cy + innerR * u.s);
      const ox = Math.round(cx + outerR * u.c);
      const oy = Math.round(cy + outerR * u.s);
      if (ix < 0 || iy < 0 || ix >= width || iy >= height || ox < 0 || oy < 0 || ox >= width || oy >= height) {
        continue;
      }
      innerLumSum += lum[iy * width + ix];
      outerLumSum += lum[oy * width + ox];
      contrastCount++;
    }
  }

  if (!ringCount) return -Infinity;

  const ringWarm = warmSum / ringCount;
  const ringSat = satSum / ringCount;

  if (!includeContrast || !contrastCount) {
    return ringWarm + 0.26 * ringSat;
  }

  const contrast = Math.abs(outerLumSum / contrastCount - innerLumSum / contrastCount);
  return ringWarm + 0.24 * ringSat + 0.60 * contrast;
}

function _detectMedallionGeometryFromCover(coverImg, fallbackCx, fallbackCy, fallbackOuterRadius) {
  if (!coverImg || !coverImg.width || !coverImg.height) {
    return {
      cx: fallbackCx,
      cy: fallbackCy,
      outerRadius: fallbackOuterRadius,
      openingRadius: fallbackOuterRadius,
      detected: false,
      score: 0,
    };
  }

  const cached = DETECTION_CACHE.get(coverImg);
  if (cached) return cached;

  const W = coverImg.width;
  const H = coverImg.height;

  try {
    const srcX = Math.round(W * 0.45);
    const srcW = W - srcX;
    const scale = DETECTION_ANALYSIS_W / srcW;
    const analysisW = DETECTION_ANALYSIS_W;
    const analysisH = Math.max(220, Math.round(H * scale));

    const canvas = document.createElement('canvas');
    canvas.width = analysisW;
    canvas.height = analysisH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(coverImg, srcX, 0, srcW, H, 0, 0, analysisW, analysisH);

    const data = ctx.getImageData(0, 0, analysisW, analysisH).data;

    const total = analysisW * analysisH;
    const warm = new Float32Array(total);
    const sat = new Float32Array(total);
    const lum = new Float32Array(total);

    for (let i = 0; i < total; i++) {
      const base = i * 4;
      const r = data[base];
      const g = data[base + 1];
      const b = data[base + 2];
      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      warm[i] = (r - b) + 0.45 * (g - b);
      sat[i] = maxC - minC;
      lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    }

    const channels = { warm, sat, lum };

    const fx = (fallbackCx - srcX) * scale;
    const fy = fallbackCy * scale;
    const fr = Math.max(28, fallbackOuterRadius * scale);

    const searchShift = Math.max(18, fr * 0.22);
    const cxMin = Math.round(_clamp(fx - searchShift, fr + 8, analysisW - fr - 8));
    const cxMax = Math.round(_clamp(fx + searchShift, fr + 8, analysisW - fr - 8));
    const cyMin = Math.round(_clamp(fy - searchShift, fr + 8, analysisH - fr - 8));
    const cyMax = Math.round(_clamp(fy + searchShift, fr + 8, analysisH - fr - 8));

    const rMin = Math.round(_clamp(fr * 0.82, 24, Math.min(analysisW, analysisH) * 0.66));
    const rMax = Math.round(_clamp(fr * 1.18, rMin + 8, Math.min(analysisW, analysisH) * 0.80));

    let coarseBest = { score: -Infinity, cx: Math.round(fx), cy: Math.round(fy), r: Math.round(fr) };

    for (let cy = cyMin; cy <= cyMax; cy += DETECTION_COARSE_STEP) {
      for (let cx = cxMin; cx <= cxMax; cx += DETECTION_COARSE_STEP) {
        for (let r = rMin; r <= rMax; r += DETECTION_COARSE_STEP) {
          if (cx - r < 2 || cy - r < 2 || cx + r >= analysisW - 2 || cy + r >= analysisH - 2) continue;
          const score = _scoreRingCandidate(channels, analysisW, analysisH, cx, cy, r, RING_SAMPLES_COARSE, true);
          if (score > coarseBest.score) coarseBest = { score, cx, cy, r };
        }
      }
    }

    let fineBest = { ...coarseBest };
    const fineCxMin = Math.max(8, coarseBest.cx - 8);
    const fineCxMax = Math.min(analysisW - 8, coarseBest.cx + 8);
    const fineCyMin = Math.max(8, coarseBest.cy - 8);
    const fineCyMax = Math.min(analysisH - 8, coarseBest.cy + 8);
    const fineRMin = Math.max(22, coarseBest.r - 10);
    const fineRMax = Math.min(Math.min(analysisW, analysisH) - 8, coarseBest.r + 10);

    for (let cy = fineCyMin; cy <= fineCyMax; cy += DETECTION_FINE_STEP) {
      for (let cx = fineCxMin; cx <= fineCxMax; cx += DETECTION_FINE_STEP) {
        for (let r = fineRMin; r <= fineRMax; r += DETECTION_FINE_STEP) {
          if (cx - r < 2 || cy - r < 2 || cx + r >= analysisW - 2 || cy + r >= analysisH - 2) continue;
          const score = _scoreRingCandidate(channels, analysisW, analysisH, cx, cy, r, RING_SAMPLES_FINE, false);
          if (score > fineBest.score) fineBest = { score, cx, cy, r };
        }
      }
    }

    const detCx = Math.round(srcX + fineBest.cx / scale);
    const detCy = Math.round(fineBest.cy / scale);
    const outerRadius = Math.round(fineBest.r / scale);

    const fallbackOpening = Math.round(_clamp(fallbackOuterRadius, DETECTION_OPENING_MIN, DETECTION_OPENING_MAX));
    const openingFromOuter = outerRadius * DETECTION_OPENING_RATIO;
    const openingRadius = Math.round(
      _clamp(
        Math.max(fallbackOpening, openingFromOuter),
        DETECTION_OPENING_MIN,
        DETECTION_OPENING_MAX
      )
    );

    const reasonable =
      detCx > Math.round(W * 0.45) &&
      detCx < W - 120 &&
      detCy > 320 &&
      detCy < H - 320 &&
      outerRadius >= 360 &&
      outerRadius <= 660 &&
      openingRadius >= DETECTION_OPENING_MIN &&
      openingRadius <= DETECTION_OPENING_MAX;

    const maxShiftX = Math.round(fallbackOuterRadius * 0.04);
    const maxShiftY = Math.round(fallbackOuterRadius * 0.04);
    const boundedCx = Math.round(_clamp(detCx, fallbackCx - maxShiftX, fallbackCx + maxShiftX));
    const boundedCy = Math.round(_clamp(detCy, fallbackCy - maxShiftY, fallbackCy + maxShiftY));
    const relaxedCx = Math.round(fallbackCx + (boundedCx - fallbackCx) * 0.45);
    const relaxedCy = Math.round(fallbackCy + (boundedCy - fallbackCy) * 0.45);

    const resolved = reasonable
      ? {
          cx: relaxedCx,
          cy: relaxedCy,
          outerRadius,
          openingRadius,
          detected: true,
          score: fineBest.score,
        }
      : {
          cx: fallbackCx,
          cy: fallbackCy,
          outerRadius: fallbackOuterRadius,
          openingRadius: Math.round(_clamp(fallbackOuterRadius, DETECTION_OPENING_MIN, DETECTION_OPENING_MAX)),
          detected: false,
          score: fineBest.score,
        };

    DETECTION_CACHE.set(coverImg, resolved);
    return resolved;
  } catch (e) {
    const fallback = {
      cx: fallbackCx,
      cy: fallbackCy,
      outerRadius: fallbackOuterRadius,
      openingRadius: Math.round(_clamp(fallbackOuterRadius, DETECTION_OPENING_MIN, DETECTION_OPENING_MAX)),
      detected: false,
      score: 0,
    };
    DETECTION_CACHE.set(coverImg, fallback);
    return fallback;
  }
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

  const nominalCy = cy + Math.round(radius * CY_SHIFT_RATIO);
  const detected = _detectMedallionGeometryFromCover(coverImg, cx, nominalCy, radius);

  const medCx = detected.cx;
  const medCy = detected.cy;
  const medRadius = detected.openingRadius;

  const detailCenter = findBestCropCenter(generatedImg);
  const cropCenterX = Math.max(0.15, Math.min(0.85, detailCenter.x));
  const cropCenterY = Math.max(0.15, Math.min(0.85, detailCenter.y));
  const fallbackFillColor = _estimateFallbackFillColor(generatedImg);

  const sparseBox = _detectForegroundBoxNormalized(generatedImg);

  const hasTransparentOpening = _coverHasTransparentOpening(
    coverImg,
    W,
    H,
    medCx,
    medCy,
    medRadius * 0.22
  );

  let fallbackCanvas = null;

  for (let attempt = 0; attempt < PROFILE_SCALE_STEPS.length; attempt++) {
    const scale = PROFILE_SCALE_STEPS[attempt];
    const maxProfileRadius = Math.max(1, (medRadius + INNER_FEATHER_PX) * PROFILE_MAX_RATIO * scale);

    const drawW = Math.round(maxProfileRadius * 2 * IMAGE_OVERDRAW_RATIO);
    const drawH = drawW;
    const drawX = Math.round(medCx - drawW / 2);
    const drawY = Math.round(medCy - drawH / 2);

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    const destAspect = drawW / drawH;
    const { srcX, srcY, srcW, srcH, usedContentBox } = _fitSourceRectToDestAspect(
      generatedImg.width,
      generatedImg.height,
      destAspect,
      cropCenterX,
      cropCenterY,
      sparseBox
    );

    // Layer 1: base fill + generated illustration.
    // Some providers return transparent edges; this prevents old cover pixels
    // from showing through inside the medallion opening.
    ctx.fillStyle = fallbackFillColor;
    _traceMedallionPath(ctx, medCx, medCy, medRadius, scale, INNER_FEATHER_PX);
    ctx.fill();

    ctx.save();
    _traceMedallionPath(ctx, medCx, medCy, medRadius, scale, 0);
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
        medCx,
        medCy,
        medRadius,
        scale,
        INNER_FEATHER_PX
      );
      ctx.drawImage(overlayCanvas, 0, 0);
    }

    console.log(
      `[Compositor v15 autodetect] attempt=${attempt + 1}/${PROFILE_SCALE_STEPS.length} ` +
      `detected=${detected.detected} score=${Number.isFinite(detected.score) ? detected.score.toFixed(2) : 'n/a'} ` +
      `center=(${medCx},${medCy}) outer=${detected.outerRadius} opening=${medRadius} ` +
      `autoZoom=${usedContentBox} draw=(${drawW}x${drawH}) alphaOverlay=${hasTransparentOpening}`
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
