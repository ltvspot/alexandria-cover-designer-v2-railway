# PROMPT-07 — Generation Quality, Compositor Fix & Enhanced Prompts

**Priority:** CRITICAL — All items in Part A must be completed and verified before moving to Parts B-C.

**Branch:** `main`  
**After every file save:** `git add -A && git commit && git push`

---

## ⚠️ DESIGN PRESERVATION — DO NOT CHANGE

The current UI/UX design MUST remain exactly as-is. This includes:
- Dark navy sidebar with gold "Alexandria" branding
- Section groups: GENERATE (Iterate, Batch, Jobs), REVIEW (Review, Compare, Similarity, Mockups), INSIGHTS (Dashboard, History, Analytics), CONFIGURE (Catalogs, Prompts, Settings, API Docs)
- Model cards with pricing, provider badges, description
- Quick/Advanced toggle on Iterate page
- Book dropdown with Sync button
- Cost tracker badge ($X.XX / $50.00) and book count badge (999 books)
- All page layouts, color schemes, typography, and navigation structure

**Only modify the specific files listed in this prompt. Do not touch `index.html`, `css/style.css`, `js/app.js` (routing/navigation), or any page file not explicitly listed below.**

---

## File Path Reference

All JS files are in the `js/` directory (NOT `src/static/js/`):
- `js/compositor.js` — canvas compositing
- `js/style-diversifier.js` — style pool + prompt builder
- `js/pages/dashboard.js` — dashboard page
- `js/pages/prompts.js` — prompts page
- `js/pages/iterate.js` — iterate page (reference only, minimal changes)
- `js/db.js` — IndexedDB layer (reference only)

---

## Context

The Alexandria Cover Designer v2 is a browser-based static site (HTML/CSS/JS) deployed on Railway with a Node.js server (`server.js`) and CGI-bin backend scripts. It generates AI illustrations for 999 classic book covers, compositing them into ornamental gold-framed medallion covers fetched from Google Drive.

**Current architecture:**
- Frontend: Vanilla JS, no framework. Key files in `js/` directory.
- Backend: Python CGI scripts in `cgi-bin/` (catalog.py, settings.py).
- Image generation: Via OpenRouter API (`js/openrouter.js`).
- Compositing: Canvas-based in browser (`js/compositor.js`), uses pre-computed alpha mask (`img/medallion_mask.png`).
- Style diversity: Fisher-Yates shuffle over 16 style definitions (`js/style-diversifier.js`).
- Prompt management: Dedicated prompts page (`js/pages/prompts.js`).
- Data storage: IndexedDB via `js/db.js`.

**What's working:** The UI/UX rebuild from PROMPT-06 is in place. Models are listed, generation runs, compositing produces output, and the dashboard shows analytics.

**What's broken / needs improvement (this prompt):**
1. Generated images display OVER ornaments (z-order bug in compositor).
2. Dashboard doesn't show generated covers in results.
3. Prompts need much more color, variation, and richness — specifically Sevastopol/Cossack-style prompts.
4. Prompt save functionality needs to work end-to-end.
5. Per-cover medallion auto-detection is needed (currently uses fixed geometry).

---

## PART A — Compositor Fix (CRITICAL — DO THIS FIRST)

### Problem
The compositor currently renders the generated illustration ON TOP of the ornamental frame, which destroys the gold scrollwork. The correct behavior is: generated art goes BEHIND the original cover, and the original cover (with a transparent medallion window) is overlaid ON TOP.

Looking at the current `js/compositor.js` (v6), the architecture description in the comments is correct but there's a critical issue: **the pre-computed alpha mask (`img/medallion_mask.png`) may not correctly match the varying medallion positions across the 999 different covers.** The compositor uses fixed constants:

```js
const MEDALLION_CX = 2850;
const MEDALLION_CY = 1350;
const MEDALLION_RADIUS = 520;
```

These fixed values don't account for the fact that each of the 999 covers has slightly different medallion center positions and opening sizes.

### Required Changes to `js/compositor.js`

#### A1. Per-Cover Medallion Auto-Detection

Implement a `detectMedallionGeometry(coverImage)` function that analyzes the actual cover image to find the medallion center and opening radius. This replaces the fixed constants.

**Algorithm (from the validated Compositor v9 spec):**

1. **Downsample** the cover image to ~400px wide for performance.
2. **Score ring candidates** in a constrained search window around the expected center area (x: 65%-85% of width, y: 35%-60% of height for the right-side medallion on these covers).
3. **Ring scoring formula:**
   ```
   warm = (R - B) + 0.45 * (G - B)
   sat = max(R,G,B) - min(R,G,B)
   score = ring_warm + 0.24 * ring_sat + 0.60 * local_contrast  (coarse scan)
   score = ring_warm + 0.26 * ring_sat  (fine scan)
   ```
   This detects the warm-gold ornamental ring that surrounds the medallion opening.
4. **Derive opening radius** from detected outer ring radius:
   ```
   opening = clamp(round(outer * 0.965), 360, 530)
   ```
5. **Fallback** to the current fixed defaults (`cx=2850, cy=1350, radius=520`) if detection confidence is low, with a console warning.

**Implementation approach:**
```js
async function detectMedallionGeometry(coverImg) {
  // Downsample to ~400px for performance
  const scale = 400 / coverImg.width;
  const sw = Math.round(coverImg.width * scale);
  const sh = Math.round(coverImg.height * scale);
  
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(coverImg, 0, 0, sw, sh);
  const data = ctx.getImageData(0, 0, sw, sh).data;
  
  // Search window: right side of cover where medallion lives
  const searchMinX = Math.round(sw * 0.65);
  const searchMaxX = Math.round(sw * 0.85);
  const searchMinY = Math.round(sh * 0.35);
  const searchMaxY = Math.round(sh * 0.60);
  
  let bestScore = 0;
  let bestCx = 0, bestCy = 0, bestR = 0;
  
  // Coarse scan: test candidate centers and radii
  for (let cy = searchMinY; cy <= searchMaxY; cy += 3) {
    for (let cx = searchMinX; cx <= searchMaxX; cx += 3) {
      for (let r = Math.round(sh * 0.15); r <= Math.round(sh * 0.30); r += 3) {
        const score = scoreRing(data, sw, sh, cx, cy, r);
        if (score > bestScore) {
          bestScore = score;
          bestCx = cx; bestCy = cy; bestR = r;
        }
      }
    }
  }
  
  // Fine scan around best candidate
  // ... refine ±5px in 1px steps
  
  if (bestScore < CONFIDENCE_THRESHOLD) {
    console.warn('[Compositor] Low detection confidence, using defaults');
    return { cx: 2850, cy: 1350, outerRadius: 540, openingRadius: 520 };
  }
  
  // Scale back to full resolution
  const fullCx = Math.round(bestCx / scale);
  const fullCy = Math.round(bestCy / scale);
  const fullOuter = Math.round(bestR / scale);
  const fullOpening = Math.max(360, Math.min(530, Math.round(fullOuter * 0.965)));
  
  console.log(`[Compositor] Detected medallion: cx=${fullCx}, cy=${fullCy}, outer=${fullOuter}, opening=${fullOpening}`);
  return { cx: fullCx, cy: fullCy, outerRadius: fullOuter, openingRadius: fullOpening };
}

function scoreRing(data, w, h, cx, cy, r) {
  // Sample pixels along the ring circumference
  const samples = 36;
  let warmSum = 0, satSum = 0, contrastSum = 0;
  let validSamples = 0;
  
  for (let i = 0; i < samples; i++) {
    const angle = (2 * Math.PI * i) / samples;
    const px = Math.round(cx + r * Math.cos(angle));
    const py = Math.round(cy + r * Math.sin(angle));
    
    if (px < 0 || px >= w || py < 0 || py >= h) continue;
    
    const idx = (py * w + px) * 4;
    const R = data[idx], G = data[idx+1], B = data[idx+2];
    
    const warm = (R - B) + 0.45 * (G - B);
    const sat = Math.max(R, G, B) - Math.min(R, G, B);
    
    warmSum += warm;
    satSum += sat;
    validSamples++;
    
    // Local contrast: compare with inner pixel
    const innerPx = Math.round(cx + (r - 5) * Math.cos(angle));
    const innerPy = Math.round(cy + (r - 5) * Math.sin(angle));
    if (innerPx >= 0 && innerPx < w && innerPy >= 0 && innerPy < h) {
      const iIdx = (innerPy * w + innerPx) * 4;
      contrastSum += Math.abs(data[idx] - data[iIdx]) + 
                     Math.abs(data[idx+1] - data[iIdx+1]) + 
                     Math.abs(data[idx+2] - data[iIdx+2]);
    }
  }
  
  if (validSamples < samples * 0.5) return 0;
  
  const avgWarm = warmSum / validSamples;
  const avgSat = satSum / validSamples;
  const avgContrast = contrastSum / validSamples;
  
  return avgWarm + 0.24 * avgSat + 0.60 * avgContrast;
}
```

#### A2. Transparent-Center Template (Frame Preservation)

Instead of relying solely on the pre-computed mask PNG, also build a per-cover template at compositing time. This creates an additional safety layer:

```js
async function buildCoverTemplate(coverImg, geometry) {
  // Create a copy of the cover with the medallion opening made transparent
  const W = coverImg.width;
  const H = coverImg.height;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  
  // Draw full original cover
  ctx.drawImage(coverImg, 0, 0, W, H);
  
  // Cut out the medallion opening (make it transparent)
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.arc(geometry.cx, geometry.cy, geometry.openingRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  
  return canvas;
}
```

#### A3. Updated Compositing Pipeline

Update `smartComposite` to:
1. Auto-detect geometry from the cover image (A1).
2. Build the cover template (A2).
3. Composite in the correct order: generated art as BASE layer, cover template ON TOP.

```js
async function smartComposite(coverImg, generatedImg) {
  // Step 1: Auto-detect medallion geometry for THIS specific cover
  const geo = await detectMedallionGeometry(coverImg);
  
  console.log(`[Compositor v9] Per-cover geometry — cx=${geo.cx}, cy=${geo.cy}, opening=${geo.openingRadius}`);
  
  const W = coverImg.width || 3784;
  const H = coverImg.height || 2777;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  
  // === LAYER 0 (BOTTOM): AI illustration filling the medallion area ===
  const fillRadius = Math.round(geo.openingRadius * 1.05); // slight oversize for coverage
  const fillSize = fillRadius * 2;
  
  // Content-aware crop center
  const detailCenter = findBestCropCenter(generatedImg);
  const cropX = Math.max(0.2, Math.min(0.8, detailCenter.x));
  const cropY = Math.max(0.2, Math.min(0.8, detailCenter.y));
  
  const imgW = generatedImg.width;
  const imgH = generatedImg.height;
  let srcW, srcH;
  if (imgW > imgH) { srcH = imgH; srcW = imgH; }
  else { srcW = imgW; srcH = imgW; }
  let srcX = Math.round(cropX * imgW - srcW / 2);
  let srcY = Math.round(cropY * imgH - srcH / 2);
  srcX = Math.max(0, Math.min(imgW - srcW, srcX));
  srcY = Math.max(0, Math.min(imgH - srcH, srcY));
  
  // Content-aware zoom for sparse outputs
  const sparseBbox = detectSparseContent(generatedImg);
  if (sparseBbox) {
    srcX = sparseBbox.x;
    srcY = sparseBbox.y;
    srcW = sparseBbox.w;
    srcH = sparseBbox.h;
  }
  
  // Draw illustration clipped to circle
  ctx.save();
  ctx.beginPath();
  ctx.arc(geo.cx, geo.cy, fillRadius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(generatedImg,
    srcX, srcY, srcW, srcH,
    geo.cx - fillRadius, geo.cy - fillRadius, fillSize, fillSize
  );
  ctx.restore();
  
  // === LAYER 1 (TOP): Original cover with medallion cut out ===
  const coverTemplate = await buildCoverTemplate(coverImg, geo);
  ctx.drawImage(coverTemplate, 0, 0);
  
  console.log(`[Compositor v9] Composite complete — ${W}×${H}`);
  return canvas;
}
```

#### A4. Content-Aware Zoom for Sparse Outputs

Some AI models produce sparse "sticker-like" output — a small subject on a large empty background. Detect this and zoom in:

```js
function detectSparseContent(img) {
  const size = 200;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;
  
  // Find bounding box of non-background content
  // Detect background color from corners
  const corners = [
    [0, 0], [size-1, 0], [0, size-1], [size-1, size-1]
  ];
  let bgR = 0, bgG = 0, bgB = 0;
  for (const [x, y] of corners) {
    const idx = (y * size + x) * 4;
    bgR += data[idx]; bgG += data[idx+1]; bgB += data[idx+2];
  }
  bgR /= 4; bgG /= 4; bgB /= 4;
  
  const threshold = 40; // color distance threshold
  let minX = size, minY = size, maxX = 0, maxY = 0;
  let contentPixels = 0;
  
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dist = Math.abs(data[idx] - bgR) + Math.abs(data[idx+1] - bgG) + Math.abs(data[idx+2] - bgB);
      if (dist > threshold) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        contentPixels++;
      }
    }
  }
  
  const totalPixels = size * size;
  const contentRatio = contentPixels / totalPixels;
  const bboxArea = (maxX - minX) * (maxY - minY);
  const bboxRatio = bboxArea / totalPixels;
  
  // Only zoom if content occupies less than 40% of the image
  if (bboxRatio > 0.4 || contentRatio > 0.5) return null;
  
  // Scale bbox back to original image coords with 10% padding
  const scale = img.width / size;
  const pad = Math.round((maxX - minX) * 0.1);
  return {
    x: Math.max(0, Math.round((minX - pad) * scale)),
    y: Math.max(0, Math.round((minY - pad) * scale)),
    w: Math.min(img.width, Math.round((maxX - minX + 2 * pad) * scale)),
    h: Math.min(img.height, Math.round((maxY - minY + 2 * pad) * scale))
  };
}
```

#### A5. Update Exports

```js
window.Compositor = {
  compositeOnCover, smartComposite, findBestCropCenter,
  detectMedallionGeometry, buildCoverTemplate, detectSparseContent,
  createThumbnail, canvasToBlob, canvasToDataUrl,
  loadMask
};
```

Remove the exported constants `MEDALLION_CX`, `MEDALLION_CY`, `MEDALLION_RADIUS` from the export — they should only be fallback defaults inside the detector function.

### Acceptance Criteria (Part A)

- [ ] Generated illustration is NEVER visible outside the medallion opening.
- [ ] Gold ornamental frame, scrollwork, title text, and background remain pixel-identical to the original cover.
- [ ] Auto-detection works across at least 5 different covers (test with books at various positions in the 999-book catalog — try books #1, #100, #500, #800, #999).
- [ ] Sparse/sticker outputs are automatically zoomed to fill the medallion.
- [ ] Fallback to defaults works when detection confidence is low.
- [ ] Console logs show detected geometry per cover.
- [ ] Run the app, generate covers, and visually confirm the ornaments are intact. DO THIS FOR AT LEAST 3 DIFFERENT BOOKS.

---

## PART B — Improved Prompts with Color & Variation

### Problem
Current prompts produce illustrations that lack color variety and richness. Tim specifically wants Sevastopol/Cossack-style prompts (dramatic, colorful, military/epic) plus diverse classical styles. The 10 built-in seed prompts need to be replaced with much richer, more colorful versions.

### Required Changes to `js/style-diversifier.js`

#### B1. Replace the STYLE_POOL

Replace the entire `STYLE_POOL` array with 20 enhanced styles (the system randomly picks 10 for each batch). Every style modifier must explicitly describe vivid colors, specific color palettes, and strong visual character. The prompt template structure remains the same.

**New 20-style pool:**

```js
const STYLE_POOL = [
  // --- SEVASTOPOL / COSSACK STYLES (2) ---
  {
    id: 'sevastopol-conflict',
    label: 'Sevastopol / Dramatic Conflict',
    modifier: 'Render as a sweeping military oil painting inspired by Vasily Vereshchagin and the Crimean War panoramas. Towering smoke columns against a blood-orange sky, shattered stone walls catching the last golden light. Palette: deep crimson, burnt sienna, cannon-smoke grey, flashes of imperial gold on epaulettes and bayonets. Thick impasto brushwork on uniforms and rubble, softer glazes for distant fires. Dramatic diagonal composition — figures surge from lower-left toward an explosive upper-right horizon. Every surface glistens with rain or sweat; the atmosphere is heavy, humid, and heroic.'
  },
  {
    id: 'cossack-epic',
    label: 'Cossack / Epic Journey',
    modifier: 'Paint as a kinetic oil painting in the tradition of Ilya Repin\'s "Reply of the Zaporozhian Cossacks" and Franz Roubaud\'s battle panoramas. Galloping horses kicking up ochre dust against an endless steppe under a violet-streaked twilight. Palette: sunburnt ochre, Cossack-red sashes, tarnished silver sabres, deep indigo sky fading to amber at the horizon. Thick, energetic brushstrokes convey speed and fury — manes flying, cloaks billowing. Warm firelight illuminates weathered faces. The composition spirals outward from the center like a cavalry charge, filling every inch with movement and color.'
  },
  // --- CLASSICAL MASTER STYLES (3) ---
  {
    id: 'golden-atmosphere',
    label: 'Golden Atmosphere',
    modifier: 'Paint in the pastoral tradition of the Barbizon school — Corot, Millet, Théodore Rousseau. A scene bathed in honeyed afternoon light filtering through ancient oaks. Palette: liquid gold, warm amber, deep forest green, touches of dusty rose in the sky. Soft, feathered brushwork with visible canvas texture. Figures are small against the vast, luminous landscape. Every leaf and blade of grass catches light differently — the entire scene glows from within as if lit by a divine lamp behind the clouds.'
  },
  {
    id: 'venetian-renaissance',
    label: 'Venetian Renaissance',
    modifier: 'Render in the sumptuous Venetian style of Titian, Giorgione, and Veronese. Rich sfumato modeling with warm flesh tones against deep emerald and ultramarine drapery. Palette: venetian red, lapis lazuli blue, cloth-of-gold yellow, alabaster white, deep bronze shadow. Luminous glazed layers that give skin an inner glow. Classical architecture frames the scene — marble columns, brocade curtains, distant lagoon views. Every textile shimmers with painted thread detail. Compositions feel grand, balanced, and sensually alive.'
  },
  {
    id: 'dutch-golden-age',
    label: 'Dutch Golden Age',
    modifier: 'Paint in the intimate tradition of Vermeer, de Hooch, and Jan Steen. A single window casts a shaft of pearl-white light across the scene, illuminating every surface with photographic precision. Palette: warm candlelight amber, cool slate blue-grey, polished mahogany brown, cream linen, touches of lemon yellow and Delft blue in ceramics. Thick impasto on metallic highlights — pewter, brass, glass. Deep velvety shadows. The composition draws the eye through a doorway or window into layered depth. Every object tells a story.'
  },
  // --- COLORFUL DIVERSE STYLES (15) ---
  {
    id: 'dark-romantic-v2',
    label: 'Dark Romantic',
    modifier: 'Depict in the Dark Romantic tradition of Caspar David Friedrich and Gustave Doré. A moonlit or twilight scene with dramatic silvered edges. Palette: midnight indigo, icy blue-white, charcoal black, with sudden accents of blood-red berries or a single warm candle flame. Haunting, melancholic beauty. Mist curls around ancient trees and ruins. A solitary figure silhouetted against a vast, brooding sky with torn clouds revealing cold starlight. Deep atmosphere — you can almost feel the chill.'
  },
  {
    id: 'pre-raphaelite-v2',
    label: 'Pre-Raphaelite',
    modifier: 'Render in the lush, hyper-detailed Pre-Raphaelite style of Waterhouse, Rossetti, and Millais. Jewel-toned colors that sing: deep ruby garments, emerald moss-covered banks, sapphire water, and golden autumn leaves. Meticulous botanical detail — individual petals, veins on leaves, embroidery threads. Ethereal figures with flowing copper or raven hair, draped in medieval fabrics of damask and velvet. Rich symbolism: lilies for purity, roses for passion, willow for sorrow. Light enters from the upper left creating an otherworldly radiance.'
  },
  {
    id: 'art-nouveau-v2',
    label: 'Art Nouveau',
    modifier: 'Create in the decorative brilliance of Alphonse Mucha and Eugène Grasset. Flowing organic lines — sinuous vines, lily stems, hair that becomes botanical ornament. Palette: sage green, dusty rose, antique gold, deep teal, warm ivory. Flat color areas with fine black linework. The subject is framed by ornamental arches of flowers and peacock feathers. Muted metallic accents throughout — gold leaf, bronze patina, copper highlights. Typography-inspired composition where figure and frame merge into one harmonious design.'
  },
  {
    id: 'ukiyo-e-v2',
    label: 'Ukiyo-e Woodblock',
    modifier: 'Reimagine as a Japanese ukiyo-e woodblock print in the tradition of Hokusai and Hiroshige. Bold black outlines with flat areas of saturated color. Palette: deep indigo, vermillion red, pale ochre, celadon green, white rice-paper negative space. Fine parallel hatching for sky, waves, and rain. Dramatic spatial tension with exaggerated perspective. Stylized waves, windblown cherry blossoms, or towering mountains create dynamic movement. A striking interplay of pattern and void — every empty space is as deliberate as every filled one.'
  },
  {
    id: 'noir-v2',
    label: 'Film Noir',
    modifier: 'Depict as a high-contrast film noir composition straight from 1940s Hollywood. Palette: pure black, brilliant white, with ONE dramatic accent — a deep amber streetlight, a crimson lipstick, or a neon sign reflected in wet pavement. Hard-edged silhouettes, slashing Venetian blind shadows, extreme chiaroscuro. Figures caught in dramatic angles — shot from below or above. Rain-slicked streets reflect fragmented light. Cigarette smoke curls into geometric patterns. Moral ambiguity made visual.'
  },
  {
    id: 'botanical-v2',
    label: 'Botanical Engraving',
    modifier: 'Render as a vintage scientific illustration in the tradition of Maria Sibylla Merian and Pierre-Joseph Redouté. Exquisitely detailed: fine intaglio linework with hairline cross-hatching and stipple shading creating three-dimensional form. Hand-applied watercolor washes: soft leaf green, petal pink, butterfly-wing orange, lichen yellow. The subject is centered on a cream parchment ground with pencil construction lines faintly visible. Latin labels in copperplate script. Precision meets artistic beauty — every stamen, every wing scale rendered with love.'
  },
  {
    id: 'stained-glass-v2',
    label: 'Gothic Stained Glass',
    modifier: 'Create as a luminous Gothic cathedral window. Rich jewel-toned panels that seem to glow with inner light: ruby red, cobalt blue, emerald green, amber gold, amethyst purple. Thick dark leading lines separate each piece of glass. Light streams through creating prismatic color pools on stone surfaces. Intricate tracery frames the scene in pointed arches. Figures are stylized, iconic, with upraised hands and flowing robes. The overall effect is transcendent — sacred and awe-inspiring, like standing in Chartres Cathedral at sunrise.'
  },
  {
    id: 'impressionist-v2',
    label: 'Impressionist',
    modifier: 'Paint in the sun-drenched Impressionist style of Monet, Renoir, and Pissarro. Visible dappled brushstrokes that dissolve form into pure light and color. Palette: lavender shadow, rose-pink skin, sky blue reflected in water, warm peach sunlight, chartreuse new leaves. No hard edges — everything shimmers and vibrates. Emphasis on the play of natural light on water, foliage, or figures. A sense of a perfect afternoon frozen in time — warm, joyful, alive with color. Paint applied thickly so individual strokes catch their own light.'
  },
  {
    id: 'expressionist-v2',
    label: 'Expressionist',
    modifier: 'Render in the raw, emotionally charged style of Munch, Kirchner, and Emil Nolde. Colors are weapons: acid yellow, blood orange, electric blue, toxic green — applied in thick, agitated brushstrokes that seem to vibrate with anxiety. Warped perspectives and exaggerated proportions. Faces are masks of emotion. The sky may swirl, buildings may lean, shadows may reach like grasping hands. Everything is psychologically charged. The palette should feel almost violent in its intensity — beauty through discomfort.'
  },
  {
    id: 'baroque-v2',
    label: 'Baroque Drama',
    modifier: 'Depict as a grand Baroque composition worthy of Rubens, Velázquez, or Artemisia Gentileschi. A single dramatic light source (upper left) carves figures from deep velvet darkness. Palette: crimson silk, liquid gold, ivory flesh, deep shadow approaching black. Dynamic diagonal composition — bodies twist, arms reach, fabric billows in invisible wind. Extreme physicality and emotion. Thick impasto on highlights, transparent glazes in shadows. Figures caught at the peak of action — the most dramatic possible moment.'
  },
  {
    id: 'watercolour-v2',
    label: 'Delicate Watercolour',
    modifier: 'Paint as a refined watercolour illustration evoking beloved vintage book editions. Translucent washes where colors bloom and bleed softly into one another. The white paper ground glows through every stroke. Palette: muted cerulean blue, sage green, warm grey, burnt sienna, with accents of violet and rose. Soft, fluid edges with no hard lines — everything dissolves at the margins. Fine pen linework adds delicate structure. The mood is intimate, gentle, and nostalgic — like discovering a treasured illustration in a grandmother\'s bookshelf.'
  },
  {
    id: 'symbolist-v2',
    label: 'Symbolist Dream',
    modifier: 'Create in the mystical Symbolist tradition of Gustave Moreau, Odilon Redon, and Fernand Khnopff. A dreamlike, otherworldly scene shimmering between reality and vision. Palette: deep purple, tarnished gold, midnight blue, absinthe green, with iridescent highlights that shift like oil on water. Soft, hazy edges where forms dissolve into mist. Figures and elements feel archetypal — the Sphinx, the Angel, the Tower, the Rose. Eyes that see beyond the visible world. Rich mystical symbolism layered into every element.'
  },
  {
    id: 'renaissance-fresco',
    label: 'Renaissance Fresco',
    modifier: 'Render as an Italian Renaissance fresco in the tradition of Botticelli, Raphael, and Piero della Francesca. Idealised figures with classical proportions, serene expressions, and beautifully draped robes. Palette: warm terracotta, muted fresco blue (slightly chalky), soft gold leaf accents, ivory flesh, sage olive. Balanced, harmonious composition with architectural elements — arches, columns, tiled floors creating perfect perspective. Celestial light enters from above. The surface has the subtle texture of lime plaster — smooth yet granular.'
  },
  {
    id: 'russian-realist-v2',
    label: 'Russian Realist',
    modifier: 'Paint in the tradition of the Peredvizhniki — Ilya Repin, Ivan Kramskoi, Vasily Surikov, Isaac Levitan. Dense atmospheric detail with muted earth tones that suddenly catch fire with patches of vivid color. Palette: ochre, raw umber, slate grey, with flashes of birch-white, blood-red, and the golden glow of icon lamps. Thick expressive brushwork that captures raw human emotion and the vastness of the Russian landscape. Faces are unflinchingly honest — every wrinkle, every tear, every defiant glance tells a story. Deep, humane, and monumental.'
  },
  {
    id: 'persian-miniature',
    label: 'Persian Miniature',
    modifier: 'Render in the exquisite tradition of Persian miniature painting — Reza Abbasi, Kamal ud-Din Behzad. Bird\'s-eye perspective with no single vanishing point; the scene unfolds across multiple spatial planes simultaneously. Palette: lapis lazuli blue, vermillion, leaf gold, turquoise, saffron yellow, rose pink. Ultra-fine brushwork: individual leaves on trees, patterns on textiles, tiles on architecture. Figures are elegant with almond eyes and flowing garments. Borders of illuminated floral arabesques frame the central scene. Rich as a jeweled carpet.'
  },
  {
    id: 'romantic-sublime',
    label: 'Romantic Sublime',
    modifier: 'Paint in the awe-inspiring style of Turner, John Martin, and Frederic Edwin Church. VAST landscapes that dwarf human figures — towering mountains, raging seas, volcanic skies. Palette: molten gold and amber sunsets, storm-purple clouds, electric white lightning, deep ocean teal, misty lavender distances. The sky takes up two-thirds of the composition and is the real subject. Light breaks through clouds in god-rays. The feeling is of standing at the edge of creation — sublime terror and beauty combined. Thick, energetic brushwork in the sky, finer detail in the landscape below.'
  }
];
```

#### B2. Update the Prompt Template in `buildDiversifiedPrompt`

The base prompt also needs enhancement. Replace the current template with a richer version that explicitly asks for colorful, detailed output:

```js
function buildDiversifiedPrompt(basePrompt, book, style) {
  const bookPrompt = `Create a breathtaking, richly colored illustration for the classic book "${book.title}"${book.author ? ` by ${book.author}` : ''}. 

Identify the single most iconic, dramatic, and visually striking scene from this specific story — the moment readers remember most vividly. Depict that scene as a luminous circular medallion illustration for a luxury leather-bound edition. Fill the entire circular composition with rich detail and vivid color — no empty space, no plain backgrounds. The artwork must feel like a museum-quality painting that captures the emotional heart of the story.

${style.modifier}

CRITICAL COMPOSITION RULES:
- The image must be a perfect circular vignette, subject centered, filling the entire circle edge-to-edge.
- Edges fade softly into transparency or empty space OUTSIDE the circle.
- NO text, NO letters, NO words anywhere in the image.
- The scene must be COLORFUL and DETAILED — avoid monochrome, avoid sparse compositions.`;
  
  return bookPrompt;
}
```

#### B3. Update Built-in Seed Prompts

In `js/pages/prompts.js`, update the `seedBuiltInPrompts()` function to use 10 enhanced templates that match the new style pool. The seed prompts should be the first 10 from the STYLE_POOL:

1. Sevastopol / Dramatic Conflict
2. Cossack / Epic Journey
3. Golden Atmosphere
4. Venetian Renaissance
5. Dutch Golden Age
6. Dark Romantic
7. Pre-Raphaelite
8. Art Nouveau
9. Ukiyo-e Woodblock
10. Film Noir

Each seed prompt should use the full enhanced prompt template from B2 with `{title}` and `{author}` placeholders and the corresponding style modifier baked in.

### Acceptance Criteria (Part B)

- [ ] `STYLE_POOL` has 20 rich, colorful styles with explicit color palettes.
- [ ] Every style modifier mentions at least 5 specific colors by name.
- [ ] Prompt template explicitly asks for "colorful", "richly colored", "no empty space".
- [ ] The "Seed Built-in Prompts" button creates 10 prompt templates with the enhanced text.
- [ ] Generated outputs (test with Nano Banana at minimum) show visibly more color and detail than before.

---

## PART C — Dashboard & Prompt Save Fixes

### C1. Dashboard Generated Covers Display

The dashboard (`js/pages/dashboard.js`) should show recent generated covers. Check that:

1. After generation completes and results are saved to IndexedDB, the dashboard's "Recent Results" section queries and displays them.
2. Each result card shows: thumbnail of the composited cover, book title, model used, quality score, and timestamp.
3. If no results exist, show a helpful empty state ("No covers generated yet. Go to Iterate to create your first cover.").

Verify that the IndexedDB store used by the iterate page to save results (`generations` or `results` store) is the same store queried by the dashboard. This is the most common cause of "dashboard doesn't show results" — mismatched store names or key structures.

### C2. Prompt Save End-to-End

Ensure the full prompt save flow works:

1. **Star button on results:** After generation, each result card's star/save button should:
   - Extract the exact prompt text used for that generation.
   - Save it to the `prompts` IndexedDB store with auto-generated name: `"{Book Title} — {Model Label}"`.
   - Show a success toast/notification.
   - The saved prompt should appear in the Prompts page and in the template dropdown on Iterate.

2. **Prompts page CRUD:** Verify that Create, Read, Update, Delete all work on the prompts page. Test by:
   - Creating a new prompt manually.
   - Editing its text.
   - Deleting it.
   - Checking it appears/disappears from the Iterate dropdown.

3. **Prompt template selection on Iterate:** When a user selects a saved prompt template from the dropdown, its text should load into the custom prompt textarea. Verify `{title}` and `{author}` placeholders are replaced at generation time.

### Acceptance Criteria (Part C)

- [ ] Dashboard shows generated covers after running a generation job.
- [ ] Star/save button on result cards saves the prompt to IndexedDB.
- [ ] Saved prompts appear in the Prompts page listing.
- [ ] Saved prompts appear in the Iterate page template dropdown.
- [ ] Selecting a template loads its text into the custom prompt field.
- [ ] Full CRUD on Prompts page works (create, edit, delete).

---

## Testing Protocol

After implementing all parts, run this verification sequence:

1. **Start the app** and navigate to Settings. Enter/verify the OpenRouter API key is saved.
2. **Go to Iterate.** Select a book (try book #50 or so). 
3. **Select Nano Banana 2** (or any available model). Set variants to 2. Generate.
4. **Verify:** Images appear, are composited correctly with ornaments intact, show colorful detailed art.
5. **Click the star button** on one result to save the prompt.
6. **Go to Dashboard.** Verify the generated covers appear.
7. **Go to Prompts page.** Verify the saved prompt appears.
8. **Go back to Iterate.** Select a different book. Choose the saved prompt from the template dropdown. Generate with a different model (e.g., FLUX.2 Klein). Verify it works.
9. **Repeat steps 2-4 with 3 more books** to verify compositor auto-detection works across different covers.
10. **Check console logs** for `[Compositor v9]` messages showing detected geometry per cover.

---

## File Change Summary

| File | Action | Description |
|------|--------|-------------|
| `js/compositor.js` | **REWRITE** | v9: per-cover auto-detection, transparent-center template, content-aware zoom |
| `js/style-diversifier.js` | **REWRITE** | 20 enhanced colorful styles, improved prompt template |
| `js/pages/dashboard.js` | **VERIFY/FIX** | Ensure generated covers display correctly |
| `js/pages/prompts.js` | **MODIFY** | Update seed prompts, verify CRUD and star-save |

---

## Final Commit

After all changes are verified:
```bash
git add -A && git commit -m "feat: compositor v9, enhanced prompts, dashboard fixes" && git push
```
