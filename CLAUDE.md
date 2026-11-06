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
  New engine outputs a partner would ask about should be exposed through these tools. Vehicle inputs (`warehouse.*`,
  incl. LTEC's own terms) are inputs like any other: list_inputs lists them, run_what_if / propose_scenario return each
  person's results when they change, sweep / solve_for measure a person (person_profit / person_irr /
  person_from_manager + `person`), and the Compare view and both exports show each vehicle person by case.
- LTEC's own terms between its partners (schema 5, issue #9): `warehouse.manager_waterfall` (all manager cash pooled;
  capital + pref back first, then capital/promote splits by IRR step), `manager_loans` (a partner funds another's manager
  capital, capped at it; repaid from the borrower's manager cash first; recourse or forgiven) and `manager_vesting`
  (promote share vests; on `leaves` the unvested part goes to the others). All off by default = results unchanged.
  Siena's variants "LTEC A–E" are the worked examples; `tests/test_manager_split.py` holds the hand calculations.
- Structure (#12): how LTEC holds a deal comes from `engine/structures.json` templates (direct / spv / spv_warehouse),
  built by `apply_structure` (core.py) = `applyStructure` (core.js); `warehouse.structure` records it (schema 6). Set it
  with `python scripts/apply_structure.py <slug> <template> [--variant NAME]`. House terms for SPVs live in that file.
  The dashboard's flow diagram is drawn from the same inputs and results (never hand-placed numbers).
- Ids (#14, schema 7): each `warehouse.people` entry has a stable `id`; names are labels. Loans, vesting, buy-ins and
  person sales refer to people by id (engines resolve id first, then name for older files). Paths address list items
  by id: `warehouse.people[levi].manager_capital` (`get_path`/`set_path` = `getPath`/`setPath`). Variants
  (`meta.alternatives`) are patches: `structure` (template), `set` (paths), older `changes` (merged); titles and notes
  use `{manager}`, `{vehicle}`, `{buyers}`, `{<person id>}`. `reference_issues` must stay empty for deal files and every
  variant (tests/test_ids.py, incl. after renames). Never write a person's name where an id belongs.
- Side panel (#18): fixed stages in the order of the flow diagram (Which version · The deal · Our position · Our vehicle
  · LTEC and its partners · Tools). A new input goes in the card for its stage and gets a home in `railHome` (badges,
  "show only what's changed") and a summary in `railSummaries`; "Find an input" and diagram links work from the
  rendered fields. No drag-to-rearrange.
- New deal: `python scripts/add_standard_cases.py <slug>` adds LTEC's Adjusted Base / Downside / Stress (derived from
  the sponsor case; defaults in `engine/standard_cases.json`), then tune them to the deal's diligence and source them.
- Tests: `python -m pytest` runs engine, deal-file, tie-out AND page tests (`tests/web/*.test.js` in headless Chromium,
  via `tests/test_web.py`; needs `npm install` once for the export libraries; `-m "not web"` skips them). Page fixtures
  are generated from the deal files by `tests/web/fixtures.py`. Every UI bug gets a page test that fails before the fix
  (e.g. `rail_layout.test.js`). Run the full suite before republishing.
- Releases and previews: work happens on a branch (`feature/<issue>-<name>`) with a pull request; GitHub Actions runs
  the full suite on every push. Try a branch on the preview dashboard: `python scripts/build_web.py --preview` and publish
  `dist/preview/index.html` to https://claude.ai/artifact/QrvazH63jz8LgVT9ujoCSk ("LTEC Deal Engine (preview)"; omit
  `capabilities` on republish; its saved scenarios are separate from the live ones).
  Only merged, tagged releases go to the live dashboard: bump `engine/version.json`, add a CHANGELOG.md entry
  (tests/test_release.py checks they match), merge, tag `vX.Y.Z`, then rebuild from main and republish the live page.
  Claude Code sessions can't push tags or create releases (the GitHub proxy refuses): Levi creates the release on
  GitHub (Releases > Draft a new release > tag vX.Y.Z on the merge commit).
  The page footer, both exports and each saved scenario (`engine_version`) carry the release and build commit.
  Never publish a branch to the live dashboard.
- Backlog: bugs, ideas and deferred work are GitHub Issues on leviison/ltec-deal-engine (labels: bug, enhancement,
  diligence, deferred, structure). Entity-structure work follows the roadmap in issue #11
  (options on top of today's deal → vehicle → LTEC shape; off = unchanged results). Reference the issue in the commit (`Fixes #n`). The project doc keeps deal context, not a to-do list.
- Context and diligence: claude.ai Project "deal engine" (doc `claude/deal-engine-context.md`); Siena's own context is
  in the "Siena Villas" project.
