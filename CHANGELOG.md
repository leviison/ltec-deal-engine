# Changelog

Releases of the LTEC Deal Engine (engine + dashboard). The version is in `engine/version.json`, shown at the foot of
the dashboard and on every export, and recorded on each saved scenario (`engine_version`). Each release is a git tag
`vX.Y.Z`. Major = results change on purpose or the schema breaks; minor = new inputs/features, results unchanged when
they are off; patch = fixes.

## 2.1.0 — unreleased (feature/12-structure-templates)

- Structure templates (#12): how LTEC holds a deal is now a choice: "Direct: LTEC invests", "SPV, fully subscribed" or
  "SPV with warehouse & sell-down (SV26-style)" (`engine/structures.json`, house terms in one place). Applied from the
  deal's check and close date, keeping LTEC's partners and LTEC's own terms; identical in Python and JS.
  `warehouse.structure` records the choice (schema 6); `scripts/apply_structure.py` sets it on a deal or adds a variant.
- Dashboard: a "How LTEC holds this deal" picker (marked "edited" once you change the vehicle) and a flow diagram
  (deal → vehicle → members / LTEC → partners) with the main case's cash in each box.
- The Bend: the deal file now holds it directly through LTEC with Levi and Thaxter as LTEC's partners (50/50, an
  assumption to confirm) instead of "LTEC" as a single member; two SPV variants. Deal results are unchanged; the
  vehicle now shows each partner.

## 2.0.0 — 2026-11-06

First tagged release of the multi-deal engine (Siena Villas v1 lives on in leviison/siena-villas-model, `siena-v1.0`).

- One engine (Python reference + JS port, kept identical by parity tests) and one deal file per deal; Siena Villas
  migrated identical to v1; The Bend added and tied to the sponsor model to the cent.
- LTEC's own cases on every deal (Adjusted Base / Downside / Stress, derived from the sponsor case).
- One dashboard for every deal: deal picker, Compare view (deal × version columns, all five cases), saved scenarios
  per deal (stored as changes from the deal file, editable, with undo), PDF and styled Excel exports.
- Ask panel: Claude with the engine as tools (what-ifs, solve-for, sweeps, proposed scenarios, saved scenarios).
- The Bend: TIF cut/delay inputs, side-letter terms, both sponsor waterfalls.
- LTEC's own terms between its partners (#9): capital-first waterfall, partner loans, vesting; Siena variants LTEC A–E.
- Vehicle results everywhere: Compare, exports and Ask show each vehicle person.
- Tests: engine, deal files, tie-outs, parity (randomized), hand calculations and dashboard page tests (`python -m pytest`).
