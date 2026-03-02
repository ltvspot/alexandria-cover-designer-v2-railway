# PROMPT-06: Rebuild UI/UX for Alexandria Cover Designer v2

**Goal**: Implement the complete UI/UX frontend for the Alexandria Cover Designer v2 application. The backend logic (OpenRouter API calls, canvas compositing, quality scoring, Google Drive sync) is already implemented. This prompt specifies the frontend shell, navigation, pages, styles, and data flow that the backend hooks into.

**Repository**: https://github.com/ltvspot/alexandria-cover-designer-v2-railway
**Branch**: main

---

## Overview

Alexandria Cover Designer v2 is a single-page application (SPA) that generates AI-illustrated book covers for a classical fiction library. The backend modules already in the repo are:

- `js/openrouter.js` — OpenRouter API (15 models, image generation, response parsing)
- `js/drive.js` — Google Drive API (catalog sync, cover download, medallion detection)
- `js/compositor.js` — Canvas compositing engine (medallion illustration placement with alpha mask)
- `js/quality.js` — 7-factor client-side image quality scorer
- `js/style-diversifier.js` — 16-style pool for prompt diversification

Your task: implement every frontend file listed below so the app runs end-to-end.

---

## Section 1: Application Shell (`index.html`)

Create `index.html` as a ~150-line file. This is the single HTML page for the entire SPA.

### `<head>` block

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Alexandria Cover Designer v2</title>
  <link rel="stylesheet" href="css/style.css" />
  <!-- Inter font -->
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <!-- Chart.js -->
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
  <!-- JSZip -->
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
</head>
```

### `<body>` structure

The body contains a single `.app-shell` root element:

```
body
└── .app-shell                          (CSS Grid: 240px sidebar + 1fr)
    ├── aside.sidebar#sidebar           (left nav column)
    │   ├── .sidebar-header
    │   │   ├── .sidebar-logo           ("Alexandria")
    │   │   └── button#sidebarToggle    (collapse toggle, desktop only)
    │   └── nav.sidebar-nav
    │       ├── .nav-section            ("Generate")
    │       │   ├── a[data-page="iterate"]   Iterate
    │       │   ├── a[data-page="batch"]     Batch
    │       │   └── a[data-page="jobs"]      Jobs
    │       ├── .nav-section            ("Review")
    │       │   ├── a[data-page="review"]    Review
    │       │   ├── a[data-page="compare"]   Compare
    │       │   ├── a[data-page="similarity"] Similarity
    │       │   └── a[data-page="mockups"]   Mockups
    │       ├── .nav-section            ("Insights")
    │       │   ├── a[data-page="dashboard"] Dashboard
    │       │   ├── a[data-page="history"]   History
    │       │   └── a[data-page="analytics"] Analytics
    │       └── .nav-section            ("Configure")
    │           ├── a[data-page="catalogs"]  Catalogs
    │           ├── a[data-page="prompts"]   Prompts
    │           ├── a[data-page="settings"]  Settings
    │           └── a[data-page="api-docs"]  API Docs
    ├── .sidebar-overlay#sidebarOverlay (mobile overlay, hidden by default)
    └── .main-area
        ├── header.top-header#topHeader
        │   ├── button.mobile-menu-btn#mobileMenuBtn  (hamburger, mobile only)
        │   ├── h1.page-title#pageTitle               (current page name)
        │   ├── .budget-badge#budgetBadge             ("$0.00 / $50.00")
        │   └── .sync-status#syncStatus               ("0 books")
        ├── main.content#content                      (page content injected here)
        └── .toast-container#toastContainer           (fixed toast area)
```

Each nav link must:
- Have class `nav-link`
- Have `data-page="pagename"` attribute
- Have `href="#pagename"`
- Include a small SVG icon inline (use any simple geometric SVG — lines, circles, rects, paths)

Each `.nav-section` must have a `.nav-section-title` span above the links (e.g., "GENERATE", "REVIEW", "INSIGHTS", "CONFIGURE" in uppercase).

### Script loading order

All scripts use `type="module"`. Load in this exact order at the bottom of `<body>`:

```html
<script type="module" src="js/db.js"></script>
<script type="module" src="js/drive.js"></script>
<script type="module" src="js/openrouter.js"></script>
<script type="module" src="js/compositor.js"></script>
<script type="module" src="js/quality.js"></script>
<script type="module" src="js/style-diversifier.js"></script>
<script type="module" src="js/pages/iterate.js"></script>
<script type="module" src="js/pages/batch.js"></script>
<script type="module" src="js/pages/jobs.js"></script>
<script type="module" src="js/pages/review.js"></script>
<script type="module" src="js/pages/compare.js"></script>
<script type="module" src="js/pages/similarity.js"></script>
<script type="module" src="js/pages/mockups.js"></script>
<script type="module" src="js/pages/dashboard.js"></script>
<script type="module" src="js/pages/history.js"></script>
<script type="module" src="js/pages/analytics.js"></script>
<script type="module" src="js/pages/catalogs.js"></script>
<script type="module" src="js/pages/prompts.js"></script>
<script type="module" src="js/pages/settings.js"></script>
<script type="module" src="js/pages/api-docs.js"></script>
<script type="module" src="js/app.js"></script>
```

`app.js` must always be last — it owns the router and `init()` sequence.

---

## Section 2: CSS Design System (`css/style.css`, ~1060 lines)

Create `css/style.css` with no external CSS framework. All styles are custom. Target ~1060 lines.

### Brand palette (CSS custom properties on `:root`)

```css
:root {
  --navy:   #1a2744;   /* sidebar bg, modal bg, titles */
  --gold:   #c5a55a;   /* active nav, primary buttons, quality bar, accents */
  --bg:     #f1f5f9;   /* page background */
  --border: #e2e8f0;   /* dividers, card borders */
  --muted:  #64748b;   /* secondary text */
  --muted2: #94a3b8;   /* lighter muted text */
  --white:  #ffffff;
  --danger: #ef4444;
  --success:#22c55e;
  --warning:#f97316;
  --info:   #3b82f6;
}
```

Font: `font-family: 'Inter', sans-serif` on `body`. `font-size: 14px`, `background: var(--bg)`, `color: #1e293b`.

### CSS class inventory by group

Implement all classes listed below. The visual intent follows a clean, professional SaaS design with a dark navy sidebar and light content area.

#### Layout
- `.app-shell` — `display: grid; grid-template-columns: 240px 1fr; height: 100vh; overflow: hidden`
- `.main-area` — `display: flex; flex-direction: column; overflow: hidden`
- `.content` — `flex: 1; overflow-y: auto; padding: 24px; background: var(--bg)`

#### Sidebar
- `.sidebar` — `background: var(--navy); color: white; display: flex; flex-direction: column; overflow-y: auto; transition: width 0.2s`
- `.sidebar.collapsed` — `width: 56px` (icons-only mode on desktop)
- `.sidebar.mobile-open` — shown as fixed overlay on mobile
- `.sidebar-overlay` — `display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 40` — `.sidebar-overlay.visible` sets `display: block`
- `.sidebar-header` — `display: flex; align-items: center; justify-content: space-between; padding: 16px; border-bottom: 1px solid rgba(255,255,255,0.1)`
- `.sidebar-logo` — gold text, `font-weight: 700; font-size: 16px; color: var(--gold)`
- `.sidebar-nav` — `padding: 8px 0; flex: 1`
- `.nav-section` — `margin-bottom: 8px`
- `.nav-section-title` — `font-size: 10px; font-weight: 600; letter-spacing: 0.08em; color: rgba(255,255,255,0.4); padding: 8px 16px 4px; text-transform: uppercase`
- `.nav-link` — `display: flex; align-items: center; gap: 10px; padding: 8px 16px; color: rgba(255,255,255,0.7); text-decoration: none; border-radius: 6px; margin: 1px 8px; font-size: 13px; font-weight: 500; transition: background 0.15s, color 0.15s`
- `.nav-link:hover` — `background: rgba(255,255,255,0.08); color: white`
- `.nav-link.active` — `background: rgba(197,165,90,0.2); color: var(--gold); font-weight: 600`

#### Header
- `.top-header` — `display: flex; align-items: center; gap: 12px; padding: 12px 24px; background: white; border-bottom: 1px solid var(--border); min-height: 56px`
- `.page-title` — `font-size: 18px; font-weight: 700; color: var(--navy); flex: 1`
- `.budget-badge` — `background: var(--navy); color: var(--gold); padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600`
- `.sync-status` — `color: var(--muted); font-size: 12px`
- `.mobile-menu-btn` — `display: none; background: none; border: none; cursor: pointer; padding: 4px`

#### Cards
- `.card` — `background: white; border: 1px solid var(--border); border-radius: 10px; padding: 20px; margin-bottom: 16px`
- `.card-header` — `display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px`
- `.card-title` — `font-size: 15px; font-weight: 600; color: var(--navy)`
- `.kpi-grid` — `display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px; margin-bottom: 20px`
- `.kpi-card` — `background: white; border: 1px solid var(--border); border-radius: 10px; padding: 20px`
- `.kpi-label` — `font-size: 12px; color: var(--muted); font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px`
- `.kpi-value` — `font-size: 28px; font-weight: 700; color: var(--navy)`
- `.kpi-sub` — `font-size: 12px; color: var(--muted); margin-top: 4px`

#### Buttons
- `.btn` — `display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 6px; font-size: 13px; font-weight: 500; cursor: pointer; border: 1px solid transparent; transition: all 0.15s; text-decoration: none`
- `.btn-primary` — `background: var(--gold); color: white; border-color: var(--gold)` — hover: slightly darker gold
- `.btn-secondary` — `background: white; color: var(--navy); border-color: var(--border)` — hover: bg `#f8fafc`
- `.btn-danger` — `background: var(--danger); color: white`
- `.btn-sm` — `padding: 5px 10px; font-size: 12px`
- `.btn-icon` — `padding: 6px; background: none; border: none; cursor: pointer; color: var(--muted); border-radius: 4px` — hover: color navy
- `.btn-cancel-job` — small red X button for cancelling individual jobs in the pipeline

#### Forms
- `.form-group` — `margin-bottom: 16px`
- `.form-label` — `display: block; font-size: 13px; font-weight: 500; color: var(--navy); margin-bottom: 6px`
- `.form-input`, `.form-select`, `.form-textarea` — `width: 100%; padding: 8px 12px; border: 1px solid var(--border); border-radius: 6px; font-size: 13px; font-family: inherit; background: white; color: #1e293b` — focus: `outline: none; border-color: var(--gold); box-shadow: 0 0 0 3px rgba(197,165,90,0.15)`
- `.form-hint` — `font-size: 11px; color: var(--muted); margin-top: 4px`
- `.form-row` — `display: grid; grid-template-columns: 1fr 1fr; gap: 16px`
- `.checkbox-group` — `display: flex; flex-wrap: wrap; gap: 8px`
- `.checkbox-item` — `display: flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer`
- `.radio-group` — `display: flex; gap: 12px; flex-wrap: wrap`

#### Tables
- `.table-wrap` — `overflow-x: auto; border-radius: 8px; border: 1px solid var(--border)`
- `table` — `width: 100%; border-collapse: collapse; font-size: 13px`
- `thead` — `background: #f8fafc`
- `th` — `padding: 10px 14px; text-align: left; font-weight: 600; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid var(--border); cursor: pointer; user-select: none`
- `td` — `padding: 10px 14px; border-bottom: 1px solid var(--border); vertical-align: middle`
- `tr:last-child td` — `border-bottom: none`
- `tr:hover td` — `background: #fafafa`
- `.sort-icon` — `margin-left: 4px; color: var(--muted2); font-size: 10px`

#### Tags / Badges
- `.tag` — `display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; white-space: nowrap`
- `.tag-model` — `background: #eff6ff; color: #2563eb`
- `.tag-status` — `background: #f1f5f9; color: var(--muted)`
- `.tag-pending` — `background: #fef3c7; color: #92400e`
- `.tag-failed` — `background: #fee2e2; color: #991b1b`
- `.tag-queued` — `background: #e0f2fe; color: #075985`
- `.tag-gold` — `background: rgba(197,165,90,0.15); color: #92631a`
- `.tag-style` — `background: #f3e8ff; color: #6b21a8`

#### Progress
- `.progress-bar` — `background: var(--border); border-radius: 4px; height: 6px; overflow: hidden`
- `.progress-fill` — `height: 100%; background: var(--gold); border-radius: 4px; transition: width 0.3s`
- `.progress-fill.danger` — `background: var(--danger)` (used when >90% budget spent)

#### Grids (for results and content layout)
- `.grid-2` — `display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px`
- `.grid-3` — `display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px`
- `.grid-4` — `display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px`
- `.grid-auto` — `display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px`
- `.compare-grid` — `display: grid; gap: 16px` (column count set dynamically via inline style)

#### Result Cards (generated image thumbnails)
- `.result-card` — `background: white; border: 2px solid var(--border); border-radius: 10px; overflow: hidden; cursor: pointer; transition: border-color 0.15s, box-shadow 0.15s`
- `.result-card:hover` — `border-color: var(--gold); box-shadow: 0 4px 12px rgba(0,0,0,0.08)`
- `.result-card.selected` — `border-color: var(--gold); box-shadow: 0 0 0 3px rgba(197,165,90,0.2)`
- `.thumb` — `width: 100%; aspect-ratio: 3/4; object-fit: cover; display: block; background: #f8fafc`
- `.card-body` — `padding: 10px`
- `.card-meta` — `font-size: 11px; color: var(--muted); margin-top: 4px`

#### Quality Meter
- `.quality-meter` — `margin-top: 6px`
- `.quality-bar` — `height: 4px; background: var(--border); border-radius: 2px; overflow: hidden`
- `.quality-fill` — `height: 100%; border-radius: 2px; transition: width 0.3s`
- `.quality-fill.high` — `background: var(--success)`
- `.quality-fill.medium` — `background: var(--warning)`
- `.quality-fill.low` — `background: var(--danger)`

#### Pipeline (live job progress)
- `.pipeline` — `display: flex; flex-direction: column; gap: 8px`
- `.pipeline-row` — `background: white; border: 1px solid var(--border); border-radius: 8px; padding: 12px 16px; display: flex; align-items: center; gap: 12px`
- `.pipeline-step` — `display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted2); padding: 4px 8px; border-radius: 4px`
- `.pipeline-step.active` — `color: var(--gold); background: rgba(197,165,90,0.1); font-weight: 600`
- `.pipeline-step.done` — `color: var(--success); text-decoration: line-through`
- `.pipeline-step.error` — `color: var(--danger)`
- `.pipeline-arrow` — `color: var(--muted2); font-size: 10px`
- `.heartbeat-pulse` — pulsing animation (CSS `@keyframes pulse`) applied to the active step indicator; `animation: pulse 1s ease-in-out infinite`

#### Toasts
- `.toast-container` — `position: fixed; bottom: 24px; right: 24px; display: flex; flex-direction: column; gap: 8px; z-index: 9999`
- `.toast` — `background: var(--navy); color: white; padding: 12px 16px; border-radius: 8px; font-size: 13px; max-width: 320px; box-shadow: 0 8px 24px rgba(0,0,0,0.2); display: flex; align-items: center; gap: 10px; animation: slideIn 0.2s ease`
- `.toast.success` — left border `4px solid var(--success)`
- `.toast.error` — left border `4px solid var(--danger)`
- `.toast.warning` — left border `4px solid var(--warning)`
- `.toast.info` — left border `4px solid var(--info)`
- `.toast.removing` — `animation: slideOut 0.2s ease forwards`
- Define `@keyframes slideIn` (translate from right + fade in) and `@keyframes slideOut` (translate right + fade out)

#### Modals
- `.modal-overlay` — `position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 20px`
- `.modal` — `background: white; border-radius: 12px; padding: 24px; max-width: 560px; width: 100%; max-height: 90vh; overflow-y: auto; box-shadow: 0 20px 60px rgba(0,0,0,0.3)`
- `.modal-title` — `font-size: 18px; font-weight: 700; color: var(--navy); margin-bottom: 20px`
- `.modal-actions` — `display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--border)`
- `.view-modal` — full-screen lightbox style modal for viewing generated images at full size
- `.view-modal-header` — `display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--border)`
- `.view-modal-body` — `padding: 20px; overflow-y: auto; text-align: center`

#### Navigation / Tabs / Filters
- `.tabs` — `display: flex; gap: 4px; border-bottom: 2px solid var(--border); margin-bottom: 20px`
- `.tab` — `padding: 8px 16px; font-size: 13px; font-weight: 500; color: var(--muted); cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -2px; transition: all 0.15s`
- `.tab.active` — `color: var(--gold); border-bottom-color: var(--gold)`
- `.filters-bar` — `display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; align-items: center`
- `.filter-chip` — `padding: 5px 12px; border-radius: 20px; font-size: 12px; font-weight: 500; cursor: pointer; background: white; border: 1px solid var(--border); color: var(--muted); transition: all 0.15s`
- `.filter-chip.active` — `background: var(--navy); color: white; border-color: var(--navy)`
- `.pagination` — `display: flex; gap: 4px; align-items: center; justify-content: center; margin-top: 20px`
- `.page-btn` — `padding: 6px 10px; border-radius: 4px; border: 1px solid var(--border); background: white; cursor: pointer; font-size: 12px; color: var(--muted)`
- `.page-btn.active` — `background: var(--navy); color: white; border-color: var(--navy)`

#### Settings page
- `.settings-grid` — `display: grid; grid-template-columns: 1fr 1fr; gap: 24px` (collapses to 1 col at ≤1024px)
- `.settings-section` — `background: white; border: 1px solid var(--border); border-radius: 10px; padding: 20px`
- `.medallion-preview` — `width: 300px; height: 220px; background: var(--navy); border-radius: 8px; position: relative; margin: 12px 0`
- `.medallion-circle` — `position: absolute; border: 3px solid var(--gold); border-radius: 50%; pointer-events: none; box-shadow: 0 0 0 1px rgba(197,165,90,0.3)` (position and size set via inline style)

#### Prompt cards
- `.prompt-card` — `background: white; border: 2px solid var(--border); border-radius: 10px; padding: 16px; cursor: pointer; transition: border-color 0.15s`
- `.prompt-card:hover` — `border-color: var(--gold)`
- `.prompt-card.selected` — `border-color: var(--gold); box-shadow: 0 0 0 3px rgba(197,165,90,0.15)`

#### Book cards (catalog)
- `.book-card` — `background: white; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; cursor: pointer; transition: box-shadow 0.15s`
- `.book-card:hover` — `box-shadow: 0 4px 16px rgba(0,0,0,0.1)`
- `.book-thumb` — `width: 100%; aspect-ratio: 3/4; object-fit: cover; background: var(--bg); display: block`
- `.book-info` — `padding: 10px`
- `.book-title` — `font-size: 13px; font-weight: 600; color: var(--navy); margin-bottom: 2px; line-height: 1.3`
- `.book-author` — `font-size: 11px; color: var(--muted)`

#### Activity feed
- `.activity-item` — `display: flex; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border)`
- `.activity-dot` — `width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; margin-top: 4px`
- `.activity-text` — `font-size: 13px; color: #1e293b; line-height: 1.4`
- `.activity-time` — `font-size: 11px; color: var(--muted); margin-top: 2px`

#### Misc / Utilities
- `.spinner` — `width: 32px; height: 32px; border: 3px solid var(--border); border-top-color: var(--gold); border-radius: 50%; animation: spin 0.7s linear infinite` with `@keyframes spin`
- `.spinner-sm` — same but `width: 16px; height: 16px; border-width: 2px`
- `.skeleton` — `background: linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite`
- `.empty-state` — `text-align: center; padding: 48px 24px; color: var(--muted)` — child `.empty-state-icon` at 48px, `.empty-state-text` at 16px bold navy
- `.toggle` — visual toggle switch: 40×22px pill container, `background: var(--border)`, rounded, with inner white circle — `.toggle.on` has `background: var(--gold)` and circle slides right
- `.toggle-wrap` — `display: flex; align-items: center; gap: 10px; cursor: pointer`
- `.code-block` — `background: #0f172a; color: #e2e8f0; padding: 16px; border-radius: 8px; font-family: monospace; font-size: 12px; overflow-x: auto; line-height: 1.6`
- `.code-inline` — `background: #f1f5f9; color: var(--navy); padding: 1px 6px; border-radius: 3px; font-family: monospace; font-size: 12px`
- `.batch-controls` — `display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 16px`
- `.chart-container` — `position: relative; height: 260px`
- `.flex` — `display: flex`
- `.flex-col` — `display: flex; flex-direction: column`
- `.items-center` — `align-items: center`
- `.justify-between` — `justify-content: space-between`
- `.gap-8` — `gap: 8px` (also `.gap-4`, `.gap-12`, `.gap-16`)
- `.mt-8` through `.mt-24` — margin-top utilities
- `.mb-8` through `.mb-24` — margin-bottom utilities
- `.text-muted` — `color: var(--muted)`
- `.text-sm` — `font-size: 12px`
- `.text-xs` — `font-size: 11px`
- `.fw-600` — `font-weight: 600`
- `.w-full` — `width: 100%`

### Responsive breakpoints

#### ≤1024px
```css
@media (max-width: 1024px) {
  .settings-grid { grid-template-columns: 1fr; }
  .grid-4 { grid-template-columns: repeat(2, 1fr); }
}
```

#### ≤768px (mobile)
```css
@media (max-width: 768px) {
  .app-shell { grid-template-columns: 1fr; }
  .sidebar {
    position: fixed; left: 0; top: 0; bottom: 0;
    z-index: 50; transform: translateX(-100%);
    transition: transform 0.25s;
    width: 240px !important;
  }
  .sidebar.mobile-open { transform: translateX(0); }
  .mobile-menu-btn { display: flex; }
  .sidebar-header button#sidebarToggle { display: none; }
  .grid-2, .grid-3, .grid-4, .form-row { grid-template-columns: 1fr; }
  .content { padding: 16px; }
}
```

---

## Section 3: Router & Global Utilities (`js/app.js`, ~736 lines)

`app.js` is the root orchestrator. Create it with these components:

### PAGES map

```javascript
const PAGES = {
  iterate:    { title: 'Iterate',    render: () => window.Pages.iterate.render() },
  batch:      { title: 'Batch',      render: () => window.Pages.batch.render() },
  jobs:       { title: 'Jobs',       render: () => window.Pages.jobs.render() },
  review:     { title: 'Review',     render: () => window.Pages.review.render() },
  compare:    { title: 'Compare',    render: () => window.Pages.compare.render() },
  similarity: { title: 'Similarity', render: () => window.Pages.similarity.render() },
  mockups:    { title: 'Mockups',    render: () => window.Pages.mockups.render() },
  dashboard:  { title: 'Dashboard',  render: () => window.Pages.dashboard.render() },
  history:    { title: 'History',    render: () => window.Pages.history.render() },
  analytics:  { title: 'Analytics',  render: () => window.Pages.analytics.render() },
  catalogs:   { title: 'Catalogs',   render: () => window.Pages.catalogs.render() },
  prompts:    { title: 'Prompts',    render: () => window.Pages.prompts.render() },
  settings:   { title: 'Settings',   render: () => window.Pages.settings.render() },
  'api-docs': { title: 'API Docs',   render: () => window.Pages['api-docs'].render() },
};
```

### `window.Pages` namespace
Declare `window.Pages = window.Pages || {};` early in `app.js` so page files that load before `app.js` can safely set their own keys without error.

### `renderPage()` function

```javascript
function getPageFromHash() {
  return (location.hash.slice(1).split('?')[0]) || 'iterate';
}

async function renderPage() {
  const page = getPageFromHash();
  const config = PAGES[page];
  if (!config) { location.hash = '#iterate'; return; }

  // Update page title in header
  const titleEl = document.getElementById('pageTitle');
  if (titleEl) titleEl.textContent = config.title;

  // Update active nav link
  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.toggle('active', link.dataset.page === page);
  });

  // Show loading spinner while page renders
  const content = document.getElementById('content');
  content.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:200px">
    <div class="spinner"></div>
  </div>`;

  try {
    await config.render();
  } catch (err) {
    console.error('Page render error:', err);
    content.innerHTML = `<div class="card"><p class="text-muted">Failed to render page: ${err.message}</p></div>`;
  }
}
```

### `window.Toast`

```javascript
window.Toast = {
  show(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('removing');
      setTimeout(() => toast.remove(), 200);
    }, duration);
  },
  success(msg, dur) { this.show(msg, 'success', dur); },
  error(msg, dur)   { this.show(msg, 'error', dur || 6000); },
  warning(msg, dur) { this.show(msg, 'warning', dur); },
  info(msg, dur)    { this.show(msg, 'info', dur); },
};
```

### `window.CoverCache`

LRU cache for downloaded cover images. Max 20 entries. Deduplicates concurrent requests for the same `book_id` by sharing a single in-flight Promise.

```javascript
window.CoverCache = {
  _cache: new Map(),    // book_id → { img, cx, cy, radius, timestamp }
  _pending: new Map(),  // book_id → Promise
  MAX_SIZE: 20,

  async load(bookId) {
    if (this._cache.has(bookId)) {
      // LRU: touch entry (delete and re-insert)
      const entry = this._cache.get(bookId);
      this._cache.delete(bookId);
      this._cache.set(bookId, entry);
      return entry;
    }
    if (this._pending.has(bookId)) {
      return this._pending.get(bookId);
    }
    const promise = this._fetch(bookId).finally(() => this._pending.delete(bookId));
    this._pending.set(bookId, promise);
    return promise;
  },

  async _fetch(bookId) {
    const book = await DB.dbGet('books', bookId);
    if (!book || !book.cover_jpg_id) throw new Error('No cover found for book');
    const apiKey = await DB.getSetting('google_api_key');
    const img = await Drive.downloadCoverWithRetry(book.cover_jpg_id, apiKey);
    const detected = Drive.validateCoverTemplate(img);
    const cx     = detected?.valid ? detected.medallion.cx     : await DB.getSetting('medallion_cx');
    const cy     = detected?.valid ? detected.medallion.cy     : await DB.getSetting('medallion_cy');
    const radius = detected?.valid ? detected.medallion.radius : await DB.getSetting('medallion_radius');
    const entry = { img, cx: Number(cx), cy: Number(cy), radius: Number(radius) };
    // LRU eviction
    if (this._cache.size >= this.MAX_SIZE) {
      this._cache.delete(this._cache.keys().next().value);
    }
    this._cache.set(bookId, entry);
    return entry;
  }
};
```

### `window.JobQueue`

Full parallel job processor. Key constants:
- `MAX_CONCURRENT = 5`
- `GENERATION_TIMEOUT = 120_000` (2 min)
- `COVER_TIMEOUT = 20_000` (20s)
- `COMPOSITE_TIMEOUT = 15_000` (15s)
- `RETRY_THRESHOLD = 0.35`
- `MAX_RETRIES = 2`
- `DEAD_JOB_TIMEOUT = 180_000` (3 min)

**State:**
- `queue` — Array of pending job objects
- `running` — Map of `jobId → { job, abortController, startTime }`
- `paused` — Boolean
- `_listeners` — Array of onChange callbacks
- `_heartbeatInterval` — setInterval reference

**Methods to implement:**

`add(job)` — push to queue, `_fillSlots()`

`addBatch(jobs)` — push all to queue, `_fillSlots()`

`pause()` / `resume()` — set `paused`, call `notify()` and `_fillSlots()` on resume

`abortJob(jobId, reason)`:
1. If running: call `entry.abortController.abort()`, mark job `failed`, `error = reason || 'Cancelled'`, write to DB, remove from running, call `notify()` and `_fillSlots()`
2. If queued: remove from queue array, mark `failed`, write to DB, call `notify()`

`cancelAll()` — abort all running, clear queue array, mark all `failed`

`onChange(fn)` — push fn to `_listeners`

`notify()` — call all listeners with current state snapshot

`resumeStuckJobs()` — on startup, get all jobs from DB, find any with status not in `['completed', 'failed', 'queued']`, mark them `failed` with error `'Interrupted by page reload'`

`_fillSlots()` — while `!paused && running.size < MAX_CONCURRENT && queue.length > 0`, shift from queue, start `_executeJob(job)`

`_heartbeat()` — every 1 second:
1. Update `_elapsed` on all running jobs (seconds since start)
2. Check for dead jobs (`elapsed * 1000 > DEAD_JOB_TIMEOUT`) → force-fail with `'Job timed out'`
3. Call `notify()`
4. Call `updateHeader()` (to refresh live cost in header)

Start the heartbeat in `init()` via `setInterval`.

**`_executeJob(job)` — 5-step pipeline:**

```
Step 1: downloading_cover
  - Set job.status = 'downloading_cover', dbPut, notify
  - const coverEntry = await CoverCache.load(job.book_id)
    - On failure: set job._coverFailed = true, continue (no throw)

Step 2: generating
  - Set job.status = 'generating', dbPut, notify
  - Loop up to MAX_RETRIES + 1 attempts:
    - Build prompt (on retry, append "IMPORTANT: This must be a circular vignette illustration...")
    - const signal from AbortController
    - const result = await OpenRouter.generateImage(prompt, job.model, apiKey, signal, GENERATION_TIMEOUT)
    - Track cost: job.cost_usd += OpenRouter.MODEL_COSTS[job.model]
    - On 429: backoff (min(attempt * 5000, 30000)), decrement attempt counter (doesn't consume retry), continue
    - Score attempt: const score = await Quality.scoreGeneratedImage(imageElement)
    - If score > bestScore: save as best result
    - If score >= RETRY_THRESHOLD or no more retries: break
    - Set job.status = 'retrying', job._subStatus = `Retry ${attempt}/${MAX_RETRIES}`, notify, continue

Step 3: scoring
  - Set job.status = 'scoring', notify
  - const detailed = await Quality.getDetailedScores(bestImageElement)
  - job.quality_score = detailed.overall
  - job.results_json = JSON.stringify({ scores: detailed, ... })

Step 4: compositing
  - Set job.status = 'compositing', notify
  - Use Promise.race([Compositor.smartComposite(...), timeout(COMPOSITE_TIMEOUT)])
  - Validate composite differs from cover (pixel sampling: check 5 random pixels differ)
  - On success: job.composited_image_blob = compositeCanvas (or blob)
  - On failure: job._compositeFailed = true, job._compositeError = err.message

Step 5: completed
  - Set job.status = 'completed', job.completed_at = ISO
  - dbPut('jobs', job)
  - Write cost_ledger entry: { model, cost_usd: job.cost_usd, job_id: job.id, book_id: job.book_id, recorded_at: ISO }
  - notify, _fillSlots
```

On any uncaught error: set `job.status = 'failed'`, `job.error = err.message`, dbPut, notify, `_fillSlots()`.

### Global utility functions

```javascript
window.uuid = () => {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
};

window.formatDate = iso => new Date(iso).toLocaleString('en-US', {
  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
});

window.timeAgo = iso => {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

window.blobUrls = new Map();
window.getBlobUrl = (data, key) => {
  if (typeof data === 'string') return data; // already a data URL
  if (key && window.blobUrls.has(key)) return window.blobUrls.get(key);
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data]));
  if (key) window.blobUrls.set(key, url);
  return url;
};
```

### `init()` sequence

Called from `DOMContentLoaded` listener via `setTimeout(init, 100)`:

```javascript
async function init() {
  await DB.openDB();
  await DB.initDefaults();
  JobQueue.resumeStuckJobs();
  initSidebar();
  updateHeader();
  window.addEventListener('hashchange', renderPage);
  renderPage();
  autoSync();
  // Start heartbeat
  setInterval(() => JobQueue._heartbeat(), 1000);
}
```

### `updateHeader()`

Reads `cost_ledger` total + sum of in-flight `running` job costs. Reads `budget_limit` from settings. Updates `#budgetBadge` text: `"$X.XX / $Y.00"`. Updates `#syncStatus`: reads `books` store count, formats as `"N books"`.

### `autoSync()`

```javascript
async function autoSync() {
  try {
    const status = await Drive.catalogCacheStatus();
    if (status.cached) {
      await Drive.loadCachedCatalog();  // fast path
      updateHeader();
      if (status.stale) {
        Drive.refreshCatalogCache();    // background refresh, no await
      }
    } else {
      const apiKey = await DB.getSetting('google_api_key');
      const folderId = await DB.getSetting('drive_source_folder');
      await Drive.syncCatalog();
      updateHeader();
    }
  } catch (err) {
    console.warn('Auto-sync failed:', err.message);
  }
}
```

### `initSidebar()`

- Desktop toggle button (`#sidebarToggle`): clicks toggle `.sidebar.collapsed` class on `#sidebar`
- Mobile menu button (`#mobileMenuBtn`): clicks toggle `.sidebar.mobile-open` + `.sidebar-overlay.visible` on their respective elements
- Sidebar overlay (`#sidebarOverlay`): click closes mobile sidebar
- Nav link clicks on mobile: close sidebar after navigation

---

## Section 4: Data Layer (`js/db.js`, ~180 lines)

Create `js/db.js` — foundational module, no dependencies. Must load first.

### Internal storage

```javascript
const _stores = {
  books: {},
  jobs: {},
  winners: {},
  prompts: {},
  settings: {},
  cost_ledger: {},
  batches: {},
};

const _autoIncrements = { prompts: 1, cost_ledger: 1 };
const CGI_SETTINGS = '__CGI_BIN__/settings.py';
let _persistTimer = null;
```

### Store configs

| Store | Key path | Auto-increment |
|-------|----------|----------------|
| `books` | `id` | No (Drive folder ID) |
| `jobs` | `id` | No (UUID) |
| `winners` | `book_id` | No |
| `prompts` | `id` | Yes (integer) |
| `settings` | `key` | No (string key) |
| `cost_ledger` | `id` | Yes (integer) |
| `batches` | `id` | No (UUID) |

### `window.DB` public API

```javascript
window.DB = {
  openDB() { return true; }, // no-op, compatibility stub

  dbPut(storeName, item) {
    const cfg = STORE_CONFIGS[storeName];
    if (cfg.autoIncrement && !item[cfg.keyPath]) {
      item[cfg.keyPath] = _autoIncrements[storeName]++;
    }
    _stores[storeName][item[cfg.keyPath]] = item;
    return item;
  },

  dbGet(storeName, key) {
    return _stores[storeName][key] ?? null;
  },

  dbGetAll(storeName) {
    return Object.values(_stores[storeName]);
  },

  dbDelete(storeName, key) {
    delete _stores[storeName][key];
  },

  dbClear(storeName) {
    _stores[storeName] = {};
    if (_autoIncrements[storeName] !== undefined) _autoIncrements[storeName] = 1;
  },

  dbGetByIndex(storeName, indexName, value) {
    return Object.values(_stores[storeName]).filter(item => item[indexName] === value);
  },

  dbCount(storeName) {
    return Object.keys(_stores[storeName]).length;
  },

  getSetting(key, defaultValue = null) {
    return _stores.settings[key]?.value ?? defaultValue;
  },

  setSetting(key, value) {
    _stores.settings[key] = { key, value };
    clearTimeout(_persistTimer);
    _persistTimer = setTimeout(_persistSettings, 300);
  },

  async initDefaults() {
    await _loadServerSettings();
    const defaults = {
      openrouter_key: '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',
      google_api_key: 'AIzaSyAY6XvPxrdS_fMNMZEUkJd7UW9b9yuJDgI',
      drive_source_folder: '1ybFYDJk7Y3VlbsEjRAh1LOfdyVsHM_cS',
      drive_output_folder: '1Vr184ZsX3k38xpmZkd8g2vwB5y9LYMRC',
      drive_winner_folder: '1vOGdGjryzErrzB0kT3qmu3PJrRLOoqBg',
      budget_limit: 50,
      default_variant_count: 1,
      quality_threshold: 0.6,
      medallion_cx: 2850,
      medallion_cy: 1350,
      medallion_radius: 520,
    };
    for (const [key, val] of Object.entries(defaults)) {
      if (!_stores.settings[key]) {
        _stores.settings[key] = { key, value: val };
      }
    }
  }
};
```

### `_loadServerSettings()`

```javascript
async function _loadServerSettings() {
  try {
    const resp = await fetch(CGI_SETTINGS);
    if (!resp.ok) return;
    const data = await resp.json();
    for (const [key, value] of Object.entries(data)) {
      _stores.settings[key] = { key, value };
    }
  } catch (e) {
    console.warn('Could not load server settings:', e.message);
  }
}
```

### `_persistSettings()`

```javascript
async function _persistSettings() {
  const flat = {};
  for (const [key, obj] of Object.entries(_stores.settings)) flat[key] = obj.value;
  try {
    await fetch(CGI_SETTINGS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(flat),
    });
  } catch (e) {
    console.warn('Could not persist settings:', e.message);
  }
}
```

---

## Section 5: Page Specifications (14 pages)

Each page file must follow this pattern:

```javascript
window.Pages = window.Pages || {};
window.Pages.pageName = {
  async render() {
    const content = document.getElementById('content');
    content.innerHTML = `...`;
    // wire up event listeners
  },
  // helper methods
};
```

---

### Page 1: Iterate (`js/pages/iterate.js`, ~546 lines)

**Purpose:** Primary single-book generation page with live pipeline progress.

**State (module-level):**
- `_selectedBookId` — currently selected book ID
- `_unsubscribe` — cleanup fn for `JobQueue.onChange`

**`render()` layout:**

```
.card (Controls)
  form-group: Book selector <select id="iterBookSelect">
    - populated from DB.dbGetAll('books'), sorted by book.number
    - empty option "— Select a book —"
  .toggle-wrap: Quick/Advanced mode toggle (#iterModeToggle)
  #iterAdvanced (hidden in Quick mode):
    .checkbox-group: model checkboxes (one per OpenRouter.MODELS entry)
      - first 3 models pre-checked
      - each shows: label, cost badge
    form-group: Variants <select id="iterVariants"> (options 1–10)
    form-group: Prompt template <select id="iterPromptSel"> (from DB.prompts, + "Default auto")
    form-group: Custom prompt <textarea id="iterPrompt" rows=4>
  .flex.justify-between:
    span#iterCostEst ("Est. cost: $0.00")
    .flex.gap-8:
      button.btn.btn-secondary#iterCancelBtn "Cancel All"
      button.btn.btn-primary#iterGenBtn "Generate"

.card#pipelineCard (Live Pipeline) — hidden when no active jobs
  h3 "Running Jobs"
  div#pipelineArea

.card (Results)
  .flex.justify-between:
    h3 "Recent Results"
    span.text-muted#iterResultCount
  div#resultsGrid.grid-auto
```

**`handleGenerate(books)`:**
1. Get selected `book_id`, selected model IDs, variant count, prompt template
2. Validate: book selected, at least 1 model checked
3. Call `StyleDiversifier.selectDiverseStyles(modelCount * variantCount)`
4. For each model × variant: create job object (see job schema below), call `JobQueue.addBatch(jobs)`
5. Subscribe: `_unsubscribe = JobQueue.onChange(jobs => { updatePipeline(jobs); loadExistingResults(); })`
6. Show pipeline card

**Job object created by iterate:**
```javascript
{
  id: uuid(),
  book_id,
  model,          // model ID string
  variant,        // variant index (1-based)
  status: 'queued',
  prompt,         // resolved prompt text
  style_id,       // from StyleDiversifier
  style_label,    // human-readable style name
  quality_score: null,
  cost_usd: 0,
  generated_image_blob: null,
  composited_image_blob: null,
  started_at: null,
  completed_at: null,
  error: null,
  results_json: null,
  retries: 0,
  _elapsed: 0,
  _subStatus: '',
  _compositeFailed: false,
  _compositeError: null,
  created_at: new Date().toISOString(),
}
```

**`updatePipeline(allJobs)`:**
- Filter to jobs for current `_selectedBookId` and status not in `['completed', 'failed']`
- For each active job render a `.pipeline-row`:
  ```
  .pipeline-row
    span.job-label  (book title + variant #)
    .pipeline-step[.active|.done|.error] for each step: ⬇ Cover → ⚡ Generate → ⭐ Score → 🎨 Composite
    span._elapsed  "42s"
    span._subStatus  (sub-status text e.g. "Retry 1/2")
    button.btn-cancel-job (calls JobQueue.abortJob)
    span.cost  "$0.04"
  ```
- Show `.heartbeat-pulse` class on the currently active step
- If all jobs complete/fail: hide pipeline card

**`loadExistingResults()`:**
- Get all jobs for `_selectedBookId`, filter completed/failed, sort by `created_at` desc, take first 20
- For each job render a `.result-card`:
  ```html
  <div class="result-card" onclick="Pages.iterate.viewFull('JOB_ID','composite')">
    <img class="thumb" src="[composited_image_blob or generated_image_blob]" />
    <div class="card-body">
      <div class="flex justify-between">
        <span class="tag tag-model">MODEL</span>
        <span class="tag tag-status STATUS_CLASS">STATUS</span>
      </div>
      <div class="quality-meter">
        <div class="quality-bar"><div class="quality-fill [high|medium|low]" style="width:XX%"></div></div>
      </div>
      <div class="card-meta">$COST · STYLE_LABEL</div>
      <div class="flex gap-4 mt-8">
        <button onclick="Pages.iterate.downloadComposite('ID')">⬇ Composite</button>
        <button onclick="Pages.iterate.downloadGenerated('ID')">⬇ Raw</button>
        <button onclick="Pages.iterate.savePromptFromJob('ID')">💾 Prompt</button>
      </div>
    </div>
  </div>
  ```

**`viewFull(jobId, mode)`:** Opens `.view-modal` with full-size image preview. Toggle between composite/raw with `.tab` buttons at top.

**`downloadComposite(jobId)` / `downloadGenerated(jobId)`:** Creates a temporary `<a>` with `download` attribute and clicks it.

**`savePromptFromJob(jobId)`:** Reads `job.prompt`, creates prompt object with `category: 'Saved'`, calls `DB.dbPut('prompts', ...)`, shows `Toast.success('Prompt saved')`.

---

### Page 2: Batch (`js/pages/batch.js`, ~237 lines)

**Purpose:** Queue generation for multiple books at once.

**State:** `_selectedBooks = new Set()`

**`render()` layout:**
```
.card (Batch Controls)
  .batch-controls
    <select id="batchModel"> (all OpenRouter.MODELS)
    <select id="batchVariants"> (1–5)
    <button id="batchSelectAll"> Select All </button>
    <button id="batchDeselectAll"> Deselect All </button>
    <button.btn-primary id="batchRunBtn"> Run Batch </button>
  #batchProgress (hidden initially):
    .progress-bar > .progress-fill#batchProgressFill
    span#batchProgressText "0 / N books"
    <button id="batchPauseBtn"> Pause </button>
    <button id="batchCancelBtn"> Cancel </button>

.card (Book Selection)
  .table-wrap
    table: columns Checkbox | # | Title | Author | Status
    Each row: <input type="checkbox" data-book-id="ID">
    Status shows: winner badge if winner exists, job count otherwise

.card (Recent Batches)
  .table-wrap
    table: columns Name | Books | Model | Variants | Status | Date
    Last 10 batches from DB.dbGetAll('batches')
```

**`handleBatch()`:**
1. Validate at least 1 book selected
2. Create batch record: `{ id: uuid(), name: "Batch " + locale datetime, book_ids: [..._selectedBooks], model, variant_count, status: 'running', completed_books: [], failed_books: [], created_at: ISO }`
3. `DB.dbPut('batches', batch)`
4. For each selected book, for each variant: create job object with a generic medallion prompt (no style diversification), call `JobQueue.addBatch(jobs)`
5. Subscribe to `JobQueue.onChange` to update progress bar

**Batch prompt (hardcoded template):**
```
Create a beautiful, highly detailed circular medallion illustration for "{title}" by {author}.
The illustration should depict a key scene or symbol from this story as a circular vignette,
with the subject centred and fully contained within the circle, edges fading softly into empty space.
Highly detailed, painterly, suitable for a luxury book cover.
```

---

### Page 3: Jobs (`js/pages/jobs.js`, ~175 lines)

**Purpose:** Live job queue monitor.

**State:** `_refreshInterval` — interval ID

**`render()` layout:**
```
.kpi-grid (4 cards)
  Queue: queue.length
  Running: running.size
  Completed: count of completed jobs in DB
  Failed: count of failed jobs in DB

.card (Queue Controls)
  .flex.gap-8:
    button#jobsPauseBtn "Pause Queue" / "Resume Queue"
    button.btn-danger#jobsClearBtn "Clear Queue"

.card (Currently Running) — hidden if nothing running
  For each running job: show book title, model, current status, elapsed, pipeline stage

.card (Queued Jobs)
  .table-wrap
    table: # | Book | Model | Variant | Queued At | Actions
    Per row: <button.btn-cancel-job> Cancel </button>

.card (Recent Jobs)
  .table-wrap
    table: Book | Model | Variant | Status | Quality | Cost | Completed | Actions
    Per row: <button.btn-sm> Retry </button> for failed jobs
    Last 20 completed/failed jobs sorted by completed_at desc
```

**Auto-refresh:** `setInterval(renderInner, 3000)` cleans up on `window.addEventListener('hashchange', cleanup, { once: true })`.

**Retry logic:** Reset `job.status = 'queued'`, clear `job.error`, `job.started_at`, `job.completed_at`, `DB.dbPut('jobs', job)`, `JobQueue.add(job)`.

---

### Page 4: Review (`js/pages/review.js`, ~354 lines)

**Purpose:** Review/approve winner illustrations per book, batch auto-approve, ZIP download.

**State:** `_filter = 'all'`

**`render()` layout:**
```
.card (Header)
  .flex.justify-between:
    .filters-bar:
      .filter-chip[.active data-filter="all"] "All"
      .filter-chip[data-filter="has-variants"] "Has Variants"
      .filter-chip[data-filter="needs-review"] "Needs Review"
      .filter-chip[data-filter="approved"] "Approved"
    .flex.gap-8:
      <a href="https://drive.google.com/drive/folders/WINNER_FOLDER" target="_blank" class="btn btn-secondary"> Winner Covers (Drive) </a>
      <button id="reviewDownloadZip" class="btn btn-secondary"> Download ZIP </button>
      <button id="reviewAutoApproveBtn" class="btn btn-secondary"> Batch Auto-Approve </button>

#autoApprovePanel (hidden initially):
  .card:
    .form-group:
      label "Quality Threshold"
      <input type="range" min=0 max=100 id="autoApproveThreshold" value=60>
      span#autoApproveThresholdVal "60%"
    span#autoApprovePreview "N books would be auto-approved"
    <button id="autoApproveConfirmBtn" class="btn btn-primary"> Apply Auto-Approve </button>

.grid-auto#reviewGrid (book cards)
```

**Book card in review grid:**
```html
<div class="book-card" onclick="Pages.review.showBookVariants('BOOK_ID')">
  <img class="book-thumb" src="[cover thumbnail or generated winner thumb]" />
  <div class="book-info">
    <div class="book-title">TITLE</div>
    <div class="book-author">AUTHOR</div>
    <div class="flex justify-between mt-8">
      <span class="text-sm text-muted">N variants</span>
      <span class="tag [tag-gold if winner]">[Winner | Needs Review | No Variants]</span>
    </div>
  </div>
</div>
```

**`showBookVariants(bookId)`:** Opens a `.modal-overlay` containing all completed variants as `.result-card` elements. Clicking a card:
1. `DB.dbPut('winners', { book_id, job_id, variant_index, quality_score, auto_approved: false, selected_at: ISO })`
2. Updates winner display, closes modal, re-renders grid

**ZIP download (`#reviewDownloadZip`):**
1. Get all approved winners
2. For each winner: get job, add to JSZip:
   - `book_N_title/illustration.jpg` (from `composited_image_blob` or `generated_image_blob`)
   - `book_N_title/metadata.json` (title, author, model, quality, cost, date)
3. `zip.generateAsync({type:'blob'})` → download

**Auto-approve:** For each book with variants, find highest quality_score job >= threshold, set as winner with `auto_approved: true`.

---

### Page 5: Compare (`js/pages/compare.js`, ~113 lines)

**Purpose:** Side-by-side comparison of up to 4 books' variants.

**State:** `_selectedBooks = []` (max 4)

**`render()` layout:**
```
.card (Book Picker)
  .filters-bar: chip button for each book that has ≥1 completed variant
    Each chip shows book title (truncated to 20 chars)
    Clicking toggles selection (max 4; if already selected, deselect)

.compare-grid#compareGrid (dynamic columns = _selectedBooks.length)
  For each selected book:
    Column:
      h4 book.title
      Variants sorted by quality desc:
        .result-card (thumbnail, model tag, quality meter, cost/time)
```

When `_selectedBooks.length` changes, update `compareGrid.style.gridTemplateColumns = `repeat(${n}, 1fr)`` and re-render columns.

---

### Page 6: Similarity (`js/pages/similarity.js`, ~149 lines)

**Purpose:** Detect visually similar/duplicate generated images using color histogram cosine similarity.

**`render()` layout:**
```
.card:
  p "Detect potentially duplicate illustrations using 48-bin color histograms."
  .flex.gap-8:
    button.btn-primary#simRunBtn "Run Similarity Check"
    span.text-muted#simStatus ""

div#simResults
```

**`runCheck()`:**
1. Get all completed jobs (up to 50)
2. For each job: load image from blob, render to 32×32 canvas
3. Build fingerprint: 48-bin normalized color histogram (16 bins each for R, G, B)
4. Compare all N×(N-1)/2 pairs: cosine similarity = dot product / (norm_a * norm_b)
5. Collect pairs with similarity > 0.85
6. Render results in `#simResults`:

```html
<!-- For each similar pair: -->
<div class="card">
  <div class="flex gap-16 items-center">
    <img style="width:160px;border:3px solid [red if >0.95, yellow if 0.85-0.95]" src="..." />
    <div class="text-muted" style="font-size:24px">↔</div>
    <img style="width:160px;border:3px solid [same color]" src="..." />
    <div>
      <div class="fw-600">SIMILARITY%</div>
      <div class="text-sm text-muted">Book A vs Book B</div>
    </div>
  </div>
</div>
```

---

### Page 7: Mockups (`js/pages/mockups.js`, ~127 lines)

**Purpose:** Preview composited covers at multiple sizes.

**`render()` layout:**
```
.card (Cover Selector)
  .form-group:
    label "Select Cover"
    <select id="mockupSelect">
      optgroup "Winners": winner covers (label: "TITLE (winner)")
      optgroup "Recent": last 10 completed jobs with composited_image_blob (label: "TITLE — MODEL")

.grid-3#mockupGrid (preview sizes) — only shown when a cover is selected:
  .card:
    h4 "Thumbnail (200px)"
    img style="max-width:200px"
  .card:
    h4 "Print Preview (400px)"
    img style="max-width:400px"
  .card:
    h4 "Full Size"
    div style="max-height:400px;overflow:auto"
      img style="max-width:100%"

.card#mockupDetails (only shown when cover selected):
  grid-2:
    Fields: Title, Author, Model, Quality, Cost, Generated
  button.btn-primary "⬇ Download Full Size"
```

---

### Page 8: Dashboard (`js/pages/dashboard.js`, ~121 lines)

**Purpose:** Overview KPIs and activity feed.

**`render()` layout:**
```
.kpi-grid (5 cards):
  "Total Spent": sum of cost_ledger (with budget progress bar below)
  "Books in Catalog": DB.dbCount('books')
  "Avg Quality": mean quality_score of completed jobs (0 if none)
  "Total Images": count of completed jobs
  "Approved": count of winners

Budget bar below "Total Spent" card:
  .progress-bar > .progress-fill[.danger if >90%] style="width: X%"
  span.text-sm.text-muted "$X.XX of $Y.00 budget used"

.grid-2:
  .card "Model Breakdown"
    .table-wrap
      table: Model | Jobs | Cost | Avg Quality
      One row per unique model used in cost_ledger

  .card "Recent Activity"
    div (last 10 completed/failed jobs, newest first):
      .activity-item for each:
        .activity-dot (green=completed, red=failed)
        div:
          .activity-text "BOOK_TITLE — MODEL (STATUS)"
          .activity-time (timeAgo)
```

---

### Page 9: History (`js/pages/history.js`, ~189 lines)

**Purpose:** Paginated, filterable, sortable job history table.

**State:**
- `_page = 1`, `_perPage = 20`
- `_sort = { col: 'created_at', dir: 'desc' }`
- `_filters = { status: '', model: '', minQuality: 0, maxQuality: 100 }`

**`render()` layout:**
```
.card:
  .flex.justify-between.mb-8:
    h3 "Job History"
    button.btn-secondary#histExportBtn "⬇ Export CSV"
  .filters-bar:
    <select id="histStatusFilter"> (All Status | queued | generating | completed | failed)
    <select id="histModelFilter"> (All Models | per model)
    <input type="number" id="histMinQuality" placeholder="Min %" style="width:70px">
    <span> – </span>
    <input type="number" id="histMaxQuality" placeholder="Max %" style="width:70px">
  .table-wrap:
    table:
      thead: Book ▲▼ | Model ▲▼ | Variant | Status | Quality ▲▼ | Cost ▲▼ | Date ▲▼
      Each th has data-col attribute; click triggers sort toggle
      tbody: paginated rows
        td: book title (lookup from books store)
        td: .tag.tag-model model label
        td: variant #
        td: .tag.tag-[status class] status
        td: quality % (with .quality-bar)
        td: $X.XXXX
        td: formatDate(created_at)
  .pagination:
    prev/next buttons, numbered page buttons, current page highlighted
```

**Sort:** Clicking a column header toggles `asc`/`desc` for that column. `title` column sorts by `bookMap.get(j.book_id)?.title` string.

**CSV Export:**
- Headers: Book,Model,Variant,Status,Quality%,Cost,Date
- One row per job in current filtered set (all pages, not just current page)
- Download as `alexandria-history.csv`

---

### Page 10: Analytics (`js/pages/analytics.js`, ~215 lines)

**Purpose:** 4 Chart.js charts + model comparison table.

**IMPORTANT:** Destroy existing Chart instances before re-creating. Store chart instances in module-level variables. Use `chartInstance?.destroy()` before `new Chart(...)`.

**`render()` layout:**
```
.grid-2 (top row charts):
  .card:
    h3 "Daily Cost (Last 30 Days)"
    .chart-container: <canvas id="costTimelineChart">
  .card:
    h3 "Cost by Model"
    .chart-container: <canvas id="costModelChart">

.grid-2 (bottom row charts):
  .card:
    h3 "Quality Distribution"
    .chart-container: <canvas id="qualityHistChart">
  .card:
    h3 "Generations Per Day (Last 30 Days)"
    .chart-container: <canvas id="genTimelineChart">

.card:
  h3 "Model Comparison"
  .table-wrap:
    table: Model | Total | Completed | Failed | Avg Quality | Avg Cost | Total Cost
```

**Chart configurations:**

`costTimelineChart` — Bar chart:
- Data: group `cost_ledger` by `recorded_at` date (last 30 days), sum `cost_usd` per day
- Color: `rgba(197,165,90,0.7)` bars

`costModelChart` — Doughnut:
- Data: group `cost_ledger` by `model`, sum total cost
- Colors: `['#c5a55a','#1a2744','#22c55e','#ef4444','#3b82f6','#8b5cf6','#f97316','#ec4899']`

`qualityHistChart` — Bar chart:
- Data: group completed jobs by quality score into 10% bins (0–10%, 10–20%, ..., 90–100%)
- Color: `rgba(34,197,94,0.7)`

`genTimelineChart` — Line chart:
- Data: group all jobs (completed + failed) by `created_at` date (last 30 days), count per day
- Color: `#3b82f6`, `fill: false`

All charts: `responsive: true`, `maintainAspectRatio: false`.

---

### Page 11: Catalogs (`js/pages/catalogs.js`, ~150 lines)

**Purpose:** Browsable catalog with Drive thumbnails and live search.

**State:** `_search = ''`, `_searchTimeout`

**`render()` layout:**
```
.card:
  .flex.justify-between.mb-8:
    .form-group style="flex:1;margin:0":
      <input.form-input id="catalogSearch" placeholder="Search books...">
    button.btn-secondary id="catalogSyncBtn" "🔄 Sync from Drive"
  span.text-muted#catalogCount "N books"

.grid-auto#catalogGrid (book cards)
```

**Book card rendering:**
```html
<div class="book-card" onclick="Pages.catalogs.showDetail('BOOK_ID')">
  <img class="book-thumb"
    src="[Drive.getDriveThumbnailUrl(book.cover_jpg_id, apiKey, 280)]"
    onerror="this.style.fontSize='48px';this.style.textAlign='center';this.textContent='📚'"
    loading="lazy" />
  <div class="book-info">
    <div class="book-title">TITLE</div>
    <div class="book-author">AUTHOR</div>
    <div class="book-author">#NUMBER</div>
  </div>
</div>
```

**Search:** Debounced 300ms on input event. Filters `books` by title, author, folder_name (case-insensitive). Re-renders grid.

**`showDetail(bookId)`:** Opens modal with:
- Cover image at 220px wide
- Fields: Author, Number, Folder, Cover File, Synced At
- Variant count + winner badge if winner exists
- Button: `<a href="#iterate?book=BOOK_ID">Generate Covers →</a>` (nav link to iterate page)

**Sync button:** Calls `Drive.syncCatalog(progress => { ... })`, shows `Toast.success('Catalog synced: N books')`.

---

### Page 12: Prompts (`js/pages/prompts.js`, ~243 lines)

**Purpose:** Prompt template library management.

**`render()` layout:**
```
.card:
  .flex.justify-between.mb-8:
    h3 "Prompt Templates"
    .flex.gap-8:
      button.btn-secondary id="promptSeedBtn" "Seed Built-in Prompts"
      button.btn-primary id="promptNewBtn" "+ New Prompt"

.grid-3#promptGrid (prompt cards)
  .prompt-card for each saved prompt:
    .flex.justify-between:
      span.fw-600 NAME
      span.tag.tag-style CATEGORY
    p.text-sm.text-muted.mt-8 (first 120 chars of template...)
    .flex.gap-4.mt-8:
      button.btn-sm.btn-secondary "Edit"
      button.btn-sm.btn-danger "Delete"
```

**Prompt modal (create/edit):**
```
.modal-overlay > .modal:
  h2.modal-title "New Prompt" / "Edit Prompt"
  .form-group: Name <input>
  .form-group: Category <select> (style | mood | subject | Cossacks/Military | Classical Library | Wildcard | Saved)
  .form-group: Template <textarea rows=6> (supports {title} and {author})
  .form-group: Negative Prompt <textarea rows=3>
  .form-group: Style Profile <input>
  .card (Preview):
    .form-row:
      <input id="previewTitle" placeholder="Book title">
      <input id="previewAuthor" placeholder="Author">
    p.text-sm#previewOutput (resolves {title}/{author} in real time)
  .modal-actions: Cancel | Save
```

**`_builtinPrompts` array (9 prompts)** — seed data, accessible as `window.Pages.prompts._builtinPrompts` for settings page:

```javascript
_builtinPrompts: [
  {
    name: 'Sevastopol / Dramatic Conflict',
    category: 'Cossacks/Military',
    template: `Create a powerful circular medallion illustration for "{title}" by {author}. Depict a dramatic battle or conflict scene with figures in dynamic motion, smoke, fire, and chaos. Rich dramatic lighting, deep shadows and highlights. Oil painting style with broad confident brushstrokes. Circular vignette composition, edges fading to black.`,
    negative_prompt: 'modern weapons, anachronistic elements',
    style_profile: 'Classical Oil'
  },
  {
    name: 'Cossack / Epic Journey',
    category: 'Cossacks/Military',
    template: `Create a sweeping circular medallion illustration for "{title}" by {author}. Show a lone Cossack rider on horseback crossing a vast steppe landscape under a dramatic sky. Epic scale, sense of adventure and freedom. Rich earth tones and golden light. Circular vignette, figure centred.`,
    negative_prompt: '',
    style_profile: 'Romantic Landscape'
  },
  {
    name: 'Golden Atmosphere',
    category: 'Classical Library',
    template: `Create a luminous circular medallion illustration for "{title}" by {author}. Suffuse the scene with warm golden-hour light filtering through trees or windows. Soft, nostalgic, painterly quality. The key scene or symbol from this story, rendered in a circular vignette with the subject centred.`,
    negative_prompt: 'harsh lighting, cold colors',
    style_profile: 'Romantic Landscape'
  },
  {
    name: 'Dark Romantic',
    category: 'Classical Library',
    template: `Create a moody, atmospheric circular medallion illustration for "{title}" by {author}. Deep shadows, mysterious midnight blues and greens, a single source of dramatic light. Gothic romanticism. The most emotionally resonant scene from this story as a circular vignette.`,
    negative_prompt: 'bright cheerful, pastel',
    style_profile: 'Dark Romantic'
  },
  {
    name: 'Gentle Nostalgia',
    category: 'Classical Library',
    template: `Create a tender, nostalgic circular medallion illustration for "{title}" by {author}. Soft watercolour washes, gentle morning light, a quiet pastoral or domestic scene from the story. Delicate, sentimental mood. Circular vignette, softly fading edges.`,
    negative_prompt: 'dramatic, violent, harsh',
    style_profile: 'Delicate Watercolour'
  },
  {
    name: 'Art Nouveau Symbolic',
    category: 'Wildcard',
    template: `Create a decorative Art Nouveau circular medallion illustration for "{title}" by {author}. Sinuous organic lines, stylised botanical motifs, symbolic figures. Flat areas of rich colour with fine linear detail. The central symbolic element of the story encircled by flowing ornamental borders.`,
    negative_prompt: 'photorealistic, 3D render',
    style_profile: 'Art Nouveau'
  },
  {
    name: 'Ukiyo-e Reimagining',
    category: 'Wildcard',
    template: `Reimagine the world of "{title}" by {author} as a Japanese ukiyo-e woodblock print circular medallion. Bold outlines, flat areas of colour, dynamic diagonal compositions, stylised natural elements. A key scene or iconic moment from the story.`,
    negative_prompt: 'western art style, photorealistic',
    style_profile: 'Ukiyo-e Woodblock'
  },
  {
    name: 'Noir Tension',
    category: 'Wildcard',
    template: `Create a film noir circular medallion illustration for "{title}" by {author}. Stark black and white with deep shadows, dramatic chiaroscuro lighting, a figure in silhouette or partial shadow. The moment of highest tension or mystery in the story.`,
    negative_prompt: 'colour, bright, cheerful',
    style_profile: 'Film Noir'
  },
  {
    name: 'Natural History Study',
    category: 'Wildcard',
    template: `Create a detailed botanical/natural history engraving style circular medallion for "{title}" by {author}. Fine crosshatching, precise scientific illustration aesthetic, sepia tones with delicate colour washes. The central natural or symbolic motif of the story.`,
    negative_prompt: 'painterly, loose, abstract',
    style_profile: 'Botanical Engraving'
  },
]
```

**Seed button:** Iterates `_builtinPrompts`, calls `DB.dbPut('prompts', { ...prompt, created_at: ISO })` for each. Shows `Toast.success('9 prompts seeded')`.

---

### Page 13: Settings (`js/pages/settings.js`, ~210 lines)

**Purpose:** App configuration form with server-side persistence.

**`render()` layout:**
```
.settings-grid (2 cols, collapses to 1 at ≤1024px):

  .settings-section "API Keys":
    .form-group: OpenRouter Key <input type="password" id="setOrKey">
    .form-group: Google API Key <input type="password" id="setGoogleKey">
    button.btn-secondary "Test OpenRouter" (fetches OpenRouter models endpoint)
    button.btn-secondary "Test Google Drive" (attempts listDriveSubfolders with current folder)

  .settings-section "Google Drive":
    .form-group: Source Folder ID <input id="setDriveSource">
    .form-group: Output Folder ID <input id="setDriveOutput">
    .form-group: Winner Folder ID <input id="setDriveWinner">
    button.btn-secondary "Open Drive Source" (opens Drive folder in new tab)

  .settings-section "Generation Defaults":
    .form-group: Budget Limit ($) <input type="number" id="setBudget">
    .form-group: Default Variant Count <select id="setVariants"> (1–10)
    .form-group: Quality Threshold
      <input type="range" min=0 max=1 step=0.05 id="setQualThresh">
      span#setQualVal (shows as %)

  .settings-section "Medallion Position":
    p.text-sm.text-muted "Cover dimensions: 3784×2777px. Medallion is on the front panel (right side)."
    .form-row:
      .form-group: Center X <input type="number" id="setMedCx">
      .form-group: Center Y <input type="number" id="setMedCy">
    .form-group: Radius <input type="number" id="setMedRadius">
    .medallion-preview:
      .medallion-circle (position computed by scaling to preview dimensions)

.card "Actions":
  .flex.gap-8:
    button.btn-danger "Reset to Defaults"
    button.btn-secondary "Seed Prompts" (calls Pages.prompts._builtinPrompts)
    button.btn-secondary "Sync Catalog Now"
```

**All inputs:** On `change` event → `DB.setSetting(key, value)` → debounced CGI persist. Show `Toast.success('Settings saved')` on each save.

**Medallion preview update:** When cx/cy/radius inputs change, recompute circle position:
```javascript
const previewW = 300, previewH = 220;
const coverW = 3784, coverH = 2777;
const px = (cx / coverW) * previewW;
const py = (cy / coverH) * previewH;
const pr = (radius / coverW) * previewW;
circleEl.style.left = `${px - pr}px`;
circleEl.style.top  = `${py - pr}px`;
circleEl.style.width = circleEl.style.height = `${pr * 2}px`;
```

**Reset:** `DB.dbClear('settings')` → `fetch('__CGI_BIN__/settings.py/reset', {method:'POST'})` → `DB.initDefaults()` → re-render page.

---

### Page 14: API Docs (`js/pages/api-docs.js`, ~260 lines)

**Purpose:** Static internal developer reference — tabbed documentation of all global window objects.

**`render()` layout:**
```
.card:
  .tabs:
    .tab[data-tab="db"] Database
    .tab[data-tab="drive"] Drive API
    .tab[data-tab="openrouter"] OpenRouter
    .tab[data-tab="compositor"] Compositor
    .tab[data-tab="quality"] Quality
    .tab[data-tab="jobs"] Job Queue
  div#apiDocContent (tab content)
```

**Tab content (static HTML for each tab):**

**Database tab:** Document all 7 stores (name, key path, auto-increment, fields). Document `window.DB` method signatures.

**Drive API tab:** Document `window.Drive` methods, catalog endpoint URLs, book object schema.

**OpenRouter tab:** Document `window.OpenRouter` exports, list all 15 models in a table (id, label, cost, modality), document `generateImage` signature.

**Compositor tab:** Document `window.Compositor` exports, cover dimensions (3784×2777), medallion defaults (cx=2850, cy=1350, radius=520), mask file path.

**Quality tab:** Document 7-factor scoring formula with weights table.

**Job Queue tab:** Document state machine, constants, `window.JobQueue` methods, pipeline steps.

Use `.code-block` and `.code-inline` for code snippets. Use standard HTML tables for method/schema documentation.

Tab switching: clicking a `.tab` sets active class and re-renders `#apiDocContent` with that tab's content.

---

## Section 6: CGI Backend

### `cgi-bin/settings.py` (~87 lines)

Python 3 CGI script for settings persistence.

```python
#!/usr/bin/env python3
import cgi, json, os, sys
from pathlib import Path

STORE = Path(__file__).parent.parent / 'settings_store.json'

def cors_headers():
    print('Content-Type: application/json')
    print('Access-Control-Allow-Origin: *')
    print('Access-Control-Allow-Methods: GET, POST, OPTIONS')
    print('Access-Control-Allow-Headers: Content-Type')
    print()
```

**Endpoints:**
- `GET` (no PATH_INFO): Read `settings_store.json`, return as JSON. If file missing, return `{}`.
- `POST` (no PATH_INFO): Read request body, parse as JSON, load existing store, merge with `current.update(incoming)`, write back, return merged JSON.
- `POST /reset`: Delete `settings_store.json`, return `{"status": "reset"}`.
- `OPTIONS`: Return 200 with CORS headers.

All responses wrapped in `try/except` to return `{"error": "..."}` on failure.

### `cgi-bin/catalog.py` (~209 lines)

Python 3 CGI script for server-side catalog cache.

**Configuration (hardcoded):**
```python
API_KEY = 'AIzaSyAY6XvPxrdS_fMNMZEUkJd7UW9b9yuJDgI'
SOURCE_FOLDER = '1ybFYDJk7Y3VlbsEjRAh1LOfdyVsHM_cS'
CACHE_FILE = Path(__file__).parent.parent / 'catalog_cache.json'
CACHE_MAX_AGE_SECONDS = 3600
```

**Endpoints:**
- `GET` (no PATH_INFO): If `catalog_cache.json` exists, return it. If not, call `sync_catalog()` first.
- `POST /refresh`: Force `sync_catalog()`, write cache, return new catalog.
- `GET /status`: Return `{ "cached": bool, "age_seconds": float, "count": int, "synced_at": str|null, "stale": bool }`.

**`sync_catalog()` process:**
1. Paginated Drive API `files.list` call: `q="'{SOURCE_FOLDER}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false"`, `pageSize=1000`, loop with `pageToken`
2. For each subfolder: parse name with regex `r'^(\d+)\.\s+(.+?)\s+[—\-]\s+(.+)$'` → number, title, author
3. List files in each subfolder, find first `.jpg`/`.jpeg` file
4. Build book object identical to JS schema
5. Write `catalog_cache.json` with `{ "books": [...], "synced_at": ISO, "count": N }`
6. Return the dict

Use only Python stdlib: `json`, `os`, `sys`, `time`, `urllib.request`, `urllib.parse`, `re`, `pathlib.Path`.

---

## Section 7: Assets

### `img/medallion_mask.png`

This file must exist at `img/medallion_mask.png`. It is a **23KB PNG alpha mask** used by the compositor:

- Dimensions: 3784×2777px (exact cover dimensions)
- White pixels (opaque) = the cover frame, spine, text, background — these pixels show through from the original cover
- Black pixels (transparent) = the medallion center circle — these pixels are made transparent so the AI illustration shows through underneath
- The circular transparent region is centered at approximately x=2850, y=1350 with radius ~520px

**If this file does not already exist in the repo**, create it programmatically:

```python
#!/usr/bin/env python3
# generate_mask.py — run once to create img/medallion_mask.png
from PIL import Image, ImageDraw
import os

W, H = 3784, 2777
CX, CY, R = 2850, 1350, 520

img = Image.new('L', (W, H), 255)  # white (opaque frame)
draw = ImageDraw.Draw(img)
draw.ellipse([CX-R, CY-R, CX+R, CY+R], fill=0)  # black (transparent medallion)

os.makedirs('img', exist_ok=True)
img.save('img/medallion_mask.png')
print('Mask created.')
```

Run `python generate_mask.py` once. Delete the script afterward.

Note: The compositor (`js/compositor.js`) loads this mask via `img/medallion_mask.png` relative to the page root.

---

## Section 8: File Structure Summary

After implementation, the repository should contain:

```
index.html
css/
  style.css
js/
  app.js
  db.js
  drive.js           (existing — do not modify)
  openrouter.js      (existing — do not modify)
  compositor.js      (existing — do not modify)
  quality.js         (existing — do not modify)
  style-diversifier.js (existing — do not modify)
  pages/
    iterate.js
    batch.js
    jobs.js
    review.js
    compare.js
    similarity.js
    mockups.js
    dashboard.js
    history.js
    analytics.js
    catalogs.js
    prompts.js
    settings.js
    api-docs.js
cgi-bin/
  settings.py
  catalog.py
img/
  medallion_mask.png
settings_store.json    (created on first settings save)
catalog_cache.json     (created on first catalog sync)
```

---

## Section 9: Implementation Notes

### CGI URL placeholder
Both `db.js` and `drive.js` use the string `'__CGI_BIN__/settings.py'` and `'__CGI_BIN__/catalog.py'` as CGI endpoint URLs. On Railway, the CGI path is typically `/cgi-bin/`. Ensure the placeholder string `__CGI_BIN__` is either:
1. Replaced with the actual path in both files at deploy time, OR
2. Resolved by a server-side rewrite rule

For the Railway deployment specifically, use `/cgi-bin` as the base path directly in `db.js` and `drive.js` if the placeholder approach is not already wired up.

### Module pattern
All page files use `window.Pages = window.Pages || {}` to safely attach to the global namespace regardless of load order. This is intentional — do not change page files to use ES module `export` syntax.

### No build step
The app runs directly from source — no webpack, vite, or bundler. All modules are loaded via `<script type="module">` in the browser. Do not add a build system.

### Canvas cross-origin
The compositor and quality scorer require `crossOrigin = 'anonymous'` on image elements loaded from Google Drive. The `drive.js` module already handles this. Do not change this behavior.

### Memory management
All generated image data is held in `_stores.jobs` as `composited_image_blob` and `generated_image_blob` properties. These may be `HTMLCanvasElement`, `Blob`, or data URL strings depending on which compositing path ran. The `getBlobUrl()` utility handles all three formats.

---

## Final Steps

After implementing all files:

```bash
git add -A && git commit -m "feat: implement complete UI/UX frontend (PROMPT-06)" && git push
```
