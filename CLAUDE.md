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
- The dashboard is one page with every deal and a deal picker (`#<slug>` opens a deal):
  https://claude.ai/artifact/DLhZKbmvQwLC1NFoYySKvZ ("LTEC Deal Engine"). Rebuild with `python scripts/build_web.py`
  (no args) and republish `dist/index.html` there. Capabilities: `db` (rule: `scenarios` read view / write interact),
  `user`, `downloads`, `sample` (the Ask panel); omit `capabilities` on republish to keep them. Saved scenarios carry a `deal` slug and store only what differs from the
  deal file (`diff_json`, dotted path -> value, plus `base_version` / `base_as_of`), so deal-file corrections flow into them;
  older ones store full `inputs` and still load. Update keeps up to 5 earlier versions in `history` (Undo). Read them
  through `scenarioInputs()` in the page, never by parsing `inputs` directly.
  The single-deal Bend page (https://claude.ai/artifact/2j1bHRKCAy91vXT4LZGPiG) is superseded.
  Do not republish over the Siena v1 dashboard (https://claude.ai/artifact/XXaQnEbg8T1by6PYY17osj); it stays on
  leviison/siena-villas-model until replaced.
- Ask panel: Claude via `sample` with the engine as page tools (get_deal, get_case_years, list_inputs, run_what_if
  with custom_from, solve_for, sweep, propose_scenario, compare_deals, get_sources, list_scenarios, get_vehicle); every
  deal tool takes `scenario` (a saved scenario's name) to work from it in `web/index.template.html`. Rules given to Claude: every number from a tool result;
  Claude proposes scenarios, the viewer saves them (Save as scenario button); run_what_if warns on no-op or overridden changes.
  New engine outputs a partner would ask about should be exposed through these tools.
- New deal: `python scripts/add_standard_cases.py <slug>` adds LTEC's Adjusted Base / Downside / Stress (derived from
  the sponsor case; defaults in `engine/standard_cases.json`), then tune them to the deal's diligence and source them.
- Context and diligence: claude.ai Project "deal engine" (doc `claude/deal-engine-context.md`); Siena's own context is
  in the "Siena Villas" project.
