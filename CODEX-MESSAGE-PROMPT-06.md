# Codex Message for PROMPT-06

Paste this into the Codex thread:

---

Please implement the complete UI/UX frontend for the Alexandria Cover Designer v2 as specified in `PROMPT-06-UIUX-REBUILD.md`.

The backend logic (OpenRouter API, compositor, quality scoring, Drive sync) is already in the repo. This prompt adds the full frontend: HTML shell with sidebar navigation (14 pages), complete CSS design system (~1060 lines, navy/gold brand palette), hash-based SPA router, in-memory database layer with CGI persistence, and all 14 page renderers (Iterate, Batch, Jobs, Review, Compare, Similarity, Mockups, Dashboard, History, Analytics, Catalogs, Prompts, Settings, API Docs).

Refer to `PROMPT-06-UIUX-REBUILD.md` for the complete specification including exact HTML structure, CSS class inventory, router implementation, page-by-page UI specs, and CGI endpoint details.

```bash
git add -A && git commit -m "feat: implement complete UI/UX frontend (PROMPT-06)" && git push
```

---
