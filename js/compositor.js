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

// ---------------------------------------------------------------------------
// smartComposite — hard inner-oval replacement with ornament protection
// ---------------------------------------------------------------------------
function smartComposite(coverImg, generatedImg, cx = 2850, cy = 1350, radius = 520) {
  const W = coverImg.width || 3784;
  const H = coverImg.height || 2777;

  const innerCy = cy + Math.round(radius * CY_SHIFT_RATIO);
  const rx = Math.round(radius * RX_RATIO);
  const ry = Math.round(radius * RY_RATIO);

  const detailCenter = findBestCropCenter(generatedImg);
  const cropCenterX = Math.max(0.15, Math.min(0.85, detailCenter.x));
  const cropCenterY = Math.max(0.15, Math.min(0.85, detailCenter.y));

  console.log(
    `[Compositor v6] detected=(${cx},${cy},r=${radius}) inner=(${cx},${innerCy}) rx=${rx} ry=${ry}`
  );

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

  return canvas;
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
