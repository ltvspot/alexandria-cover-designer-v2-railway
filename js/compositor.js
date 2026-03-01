// compositor.js — Canvas-based compositing with frame-preserving approach
//
// ARCHITECTURE (v5 — Frame-preserving elliptical punch):
//   The medallion ornamental frame (scrollwork, beaded ring) must REMAIN INTACT.
//   Only the artwork INSIDE the frame opening is replaced.
//
//   The frame opening is NOT a perfect circle — it extends further at the bottom
//   (pendant scrollwork) than at the top (floral crown dips inward). An elliptical
//   punch with a downward-shifted center matches the opening shape.
//
//   Layers (bottom to top):
//   1. AI illustration clipped to a large circle (covers entire medallion zone)
//   2. Gold beveled ring at the ellipse edge (smooth transition)
//   3. Original cover with elliptical hole punched out
//      → Frame, scrollwork, background, text all preserved from original
//      → Only the elliptical opening shows the illustration
//
//   The illustration fills BEYOND the punch (hidden by cover overlay), ensuring
//   no old artwork bleeds through. The cover overlay guarantees all frame elements
//   are pixel-perfect from the original.

// --- Configuration ratios (relative to detected outer radius) ---

// Shift the ellipse center downward from the detected medallion center.
// The frame opening extends much further below than above.
const CY_SHIFT_RATIO = 0.327;   // 170px for r=520

// Ellipse horizontal radius (limited by side scrollwork)
const RX_RATIO = 0.904;         // 470px for r=520

// Ellipse vertical radius (must reach the bottom pendant opening)
const RY_RATIO = 1.144;         // 595px for r=520

// Illustration fill radius — large enough to cover everything
const FILL_RATIO = 1.35;        // ~700px for r=520

// Gold ring width at illustration edge
const RING_WIDTH = 18;

// ---------------------------------------------------------------------------
// findBestCropCenter — energy-based detail center detection
// Returns {x, y} in 0-1 normalised coords
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
      const idx   = (y * size + x) * 4;
      const right = (y * size + x + 1) * 4;
      const down  = ((y + 1) * size + x) * 4;
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
      let v = 0, ki = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          v += energy[(y + dy) * size + (x + dx)] * kernel[ki++];
        }
      }
      blurred[y * size + x] = v / kSum;
    }
  }

  let totalW = 0, wx = 0, wy = 0;
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
function compositeOnCover(coverImg, generatedImg, cx = 2850, cy = 1350, radius = 520, feather = 15) {
  return smartComposite(coverImg, generatedImg, cx, cy, radius);
}

// ---------------------------------------------------------------------------
// smartComposite — frame-preserving compositing pipeline
// ---------------------------------------------------------------------------
function smartComposite(coverImg, generatedImg, cx = 2850, cy = 1350, radius = 520) {
  // Compute ellipse parameters from detected medallion
  const cyShift = Math.round(radius * CY_SHIFT_RATIO);
  const ellCy = cy + cyShift;
  const rx = Math.round(radius * RX_RATIO);
  const ry = Math.round(radius * RY_RATIO);
  const fillRadius = Math.round(radius * FILL_RATIO);

  console.log(`[Compositor v5] detected=(${cx},${cy},r=${radius}), ellipse_center=(${cx},${ellCy}), rx=${rx}, ry=${ry}, fill_r=${fillRadius}`);

  const detailCenter = findBestCropCenter(generatedImg);
  const clampedX = Math.max(0.2, Math.min(0.8, detailCenter.x));
  const clampedY = Math.max(0.2, Math.min(0.8, detailCenter.y));

  return _framePreservingComposite(coverImg, generatedImg, cx, ellCy,
    rx, ry, fillRadius, clampedX, clampedY);
}

// ---------------------------------------------------------------------------
// _framePreservingComposite — guaranteed frame preservation
//
//   Layer 0: Illustration clipped to fillRadius circle (covers everything)
//   Layer 1: Gold elliptical ring border at punch edge
//   Layer 2: Original cover with elliptical punch removed
// ---------------------------------------------------------------------------
function _framePreservingComposite(coverImg, generatedImg, cx, cy,
  rx, ry, fillRadius, cropCenterX, cropCenterY) {

  const W = coverImg.width || 3784;
  const H = coverImg.height || 2777;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // === LAYER 0: Illustration clipped to large fill circle ===
  // This covers the entire medallion zone including frame ring area
  const fillSize = fillRadius * 2;
  const imgW = generatedImg.width;
  const imgH = generatedImg.height;

  // Aspect-fill square crop from generated image
  let srcW, srcH;
  if (imgW > imgH) { srcH = imgH; srcW = imgH; }
  else { srcW = imgW; srcH = imgW; }

  let srcX = Math.round(cropCenterX * imgW - srcW / 2);
  let srcY = Math.round(cropCenterY * imgH - srcH / 2);
  srcX = Math.max(0, Math.min(imgW - srcW, srcX));
  srcY = Math.max(0, Math.min(imgH - srcH, srcY));

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, fillRadius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(generatedImg,
    srcX, srcY, srcW, srcH,
    cx - fillRadius, cy - fillRadius, fillSize, fillSize
  );
  ctx.restore();

  // === LAYER 1: Beveled gold ring border along ellipse edge ===
  _drawGoldEllipseRing(ctx, cx, cy, rx, ry, RING_WIDTH);

  // === LAYER 2: Cover with elliptical punch ===
  const coverCanvas = document.createElement('canvas');
  coverCanvas.width = W;
  coverCanvas.height = H;
  const cctx = coverCanvas.getContext('2d');
  cctx.drawImage(coverImg, 0, 0, W, H);

  // Punch out the elliptical opening
  cctx.globalCompositeOperation = 'destination-out';
  cctx.beginPath();
  cctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  cctx.closePath();
  cctx.fill();
  cctx.globalCompositeOperation = 'source-over';

  // Composite punched cover on top
  ctx.drawImage(coverCanvas, 0, 0);

  return canvas;
}

// ---------------------------------------------------------------------------
// _drawGoldEllipseRing — draw beveled gold ring along an ellipse
// ---------------------------------------------------------------------------
function _drawGoldEllipseRing(ctx, cx, cy, rx, ry, width) {
  const halfW = width / 2;

  for (let i = 0; i <= width; i++) {
    const offset = i - halfW;
    const t = i / width;

    // Bevel profile
    let brightness;
    if (t < 0.15) {
      brightness = 0.3 + t * 2.5;
    } else if (t < 0.45) {
      brightness = 0.7 + (t - 0.15) * 1.0;
    } else if (t < 0.55) {
      brightness = 1.0;
    } else if (t < 0.85) {
      brightness = 1.0 - (t - 0.55) * 1.0;
    } else {
      brightness = 0.7 - (t - 0.85) * 2.5;
    }

    const gr = Math.round(Math.min(255, 210 * brightness));
    const gg = Math.round(Math.min(255, 170 * brightness));
    const gb = Math.round(Math.min(255, 70 * brightness));

    ctx.beginPath();
    ctx.ellipse(cx, cy, rx + offset, ry + offset, 0, 0, Math.PI * 2);
    ctx.strokeStyle = `rgb(${gr},${gg},${gb})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Add bead-like highlights along the ellipse perimeter
  const numBeads = 72;
  const beadRadius = Math.max(2, width * 0.25);
  for (let i = 0; i < numBeads; i++) {
    const angle = (2 * Math.PI * i) / numBeads;
    const bx = cx + rx * Math.cos(angle);
    const by = cy + ry * Math.sin(angle);

    const grad = ctx.createRadialGradient(bx - 1, by - 1, 0, bx, by, beadRadius);
    grad.addColorStop(0, 'rgba(255, 235, 160, 0.8)');
    grad.addColorStop(0.5, 'rgba(210, 170, 70, 0.6)');
    grad.addColorStop(1, 'rgba(150, 120, 40, 0)');

    ctx.beginPath();
    ctx.arc(bx, by, beadRadius, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
  }
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
  compositeOnCover, smartComposite, findBestCropCenter,
  createThumbnail, canvasToBlob, canvasToDataUrl,
  RX_RATIO, RY_RATIO, CY_SHIFT_RATIO, FILL_RATIO, RING_WIDTH
};
