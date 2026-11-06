# Changelog

Releases of the LTEC Deal Engine (engine + dashboard). The version is in `engine/version.json`, shown at the foot of
the dashboard and on every export, and recorded on each saved scenario (`engine_version`). Each release is a git tag
`vX.Y.Z`. Major = results change on purpose or the schema breaks; minor = new inputs/features, results unchanged when
they are off; patch = fixes.

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
