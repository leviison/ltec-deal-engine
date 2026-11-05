# Notes for Claude Code

- Each deal is `deals/<slug>/deal.json` (schema `engine/schema/deal.schema.json`). It is the single source of truth;
  never hard-code deal numbers in `engine/core.py` or `engine/core.js`.
- `engine/core.py` (reference) and `engine/core.js` (dashboard) implement the same logic line for line. Change both,
  then run `python -m pytest` (parity, deal-file checks and every deal's tie-outs).
- A deal's tie-outs (`deals/<slug>/tests/`) must keep passing unless the user deliberately changes behavior; if so,
  regenerate its `reference/` targets and say why in the commit. Siena Villas must stay identical to `siena-v1.0`.
- New inputs get a source in the deal's `sources` (document + page/section, or "Assumption"); unknown = `TODO: ...`.
- Schema changes bump `schema_version`, update every deal file, and the page's `upgradeInputs` so saved scenarios load.
- Build a page with `python scripts/build_web.py <slug>`. Dashboard wording, hints, facts and diligence come from the
  deal's `meta` / `meta.ui`; never put deal-specific text in `web/index.template.html`.
- The Bend dashboard: https://claude.ai/artifact/2j1bHRKCAy91vXT4LZGPiG — republish `dist/the-bend/index.html` there
  (pass that URL from another session). Capabilities: `db` (rule: `scenarios` read view / write interact), `user`,
  `downloads`; omit `capabilities` on republish to keep them. Do not republish over the Siena v1 dashboard
  (https://claude.ai/artifact/XXaQnEbg8T1by6PYY17osj); it stays on leviison/siena-villas-model until replaced.
- Context and diligence: claude.ai Project "deal engine" (doc `claude/deal-engine-context.md`); Siena's own context is
  in the "Siena Villas" project.
