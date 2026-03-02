# Codex Message for PROMPT-07 (Fresh Thread)

## What to paste in the Codex chat:

---

**CRITICAL: Preserve the current design/UI/UX exactly as it is.** The app at https://web-production-900a7.up.railway.app has the correct design — dark navy sidebar, gold accent colors, model cards with pricing, Quick/Advanced toggle, etc. Do NOT change any visual design, layout, color scheme, navigation structure, or page organization. Only change the specific files listed in PROMPT-07.

Read `PROMPT-07-GENERATION-QUALITY.md` in the repo root. This prompt has 3 parts — do them in order (A → B → C). Commit and push after EACH part separately.

**IMPORTANT CONTEXT:**
- The repo structure uses `js/` paths (NOT `src/static/js/`). Files are at `js/compositor.js`, `js/style-diversifier.js`, `js/pages/dashboard.js`, etc.
- The `js/compositor.js` already has a v9 auto-detection implementation from a prior commit. Read it first — if it already implements per-cover detection, transparent-center template, and correct z-order (generated art BEHIND ornamental frame), verify it works correctly with 3+ books. If it's broken or incomplete, fix it per the spec.
- OpenRouter currently has limited credits. For testing, use Nano Banana Pro (`openrouter/google/gemini-3-pro-image-preview` at $0.010) which is the cheapest model. If that fails with 402/insufficient credits, note it but don't try to debug billing — that's not a code issue.
- Reference `CODEBASE-ANALYSIS.md` for the full file structure and architecture.

**PART A is CRITICAL and must be done first.** It fixes the compositor so generated illustrations go BEHIND the ornamental frame (not on top of it). The current compositor uses fixed medallion geometry that doesn't match all 999 covers. Implement per-cover auto-detection of the medallion center and radius using the warm-gold ring scoring algorithm described in the prompt. Build a transparent-center template from the original cover and composite it as the TOP layer. Add content-aware zoom for sparse AI outputs. Test with at least 3 different books and visually confirm ornaments remain intact.

After Part A: `git add -A && git commit -m "feat: compositor v9 per-cover auto-detection" && git push`

**PART B** replaces the 16 style modifiers in `js/style-diversifier.js` with 20 richly colored styles — including 2 Sevastopol/Cossack military styles Tim specifically wants. Every style must name 5+ specific colors. Update the prompt template to explicitly ask for colorful, detailed, edge-to-edge compositions with no empty space.

After Part B: `git add -A && git commit -m "feat: 20 enhanced color-rich style modifiers" && git push`

**PART C** fixes the dashboard to show generated covers and ensures prompt save works end-to-end (star button → IndexedDB → Prompts page → Iterate dropdown).

After Part C: `git add -A && git commit -m "feat: dashboard covers display + prompt save flow" && git push`

After ALL parts are done, send the deployed webapp link and confirm what was changed.

---
