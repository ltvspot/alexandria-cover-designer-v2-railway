# Codex Message for PROMPT-07

## What to paste in the Codex chat:

---

Read `PROMPT-07-GENERATION-QUALITY.md` in the repo root. This prompt has 4 parts — do them in order (A → B → C → D).

**PART A is CRITICAL and must be done first.** It fixes the compositor so generated illustrations go BEHIND the ornamental frame (not on top of it). The current compositor uses fixed medallion geometry that doesn't match all 999 covers. Implement per-cover auto-detection of the medallion center and radius using the warm-gold ring scoring algorithm described in the prompt. Build a transparent-center template from the original cover and composite it as the TOP layer. Add content-aware zoom for sparse AI outputs.

**PART B** adds Google Gemini Direct API support alongside OpenRouter. Create `js/gemini.js` with the three Nano Banana models. Add a Google API key field to Settings. Route generation calls based on model type.

**PART C** replaces the 16 style modifiers in `js/style-diversifier.js` with 20 richly colored styles — including 2 Sevastopol/Cossack military styles Tim specifically wants. Every style must name 5+ specific colors. Update the prompt template to explicitly ask for colorful, detailed, edge-to-edge compositions with no empty space.

**PART D** fixes the dashboard to show generated covers and ensures prompt save works end-to-end (star button → IndexedDB → Prompts page → Iterate dropdown).

After EACH part, test by running the app, generating covers, and visually confirming the results. For Part A specifically, test with at least 3 different books to verify the auto-detection works across varying medallion positions.

Reference `CODEBASE-ANALYSIS.md` for the full file structure and architecture.

`git add -A && git commit && git push`

---
