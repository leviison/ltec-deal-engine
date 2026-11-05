# LTEC Deal Engine

One engine and one dashboard for the real-estate syndications LTEC evaluates and invests in (usually through its own
SPV). Each deal is a data file; the engines, tests and dashboard are shared.

**Deal #1:** Siena Villas, migrated from `leviison/siena-villas-model` @ `siena-v1.0` (`2ee8ccd`). Its results are
bit-identical to that version (Python and JS, defaults + 200 randomized set-ups) and it still ties to its v10 and SV26
workbooks to the cent. The live Siena dashboard (https://claude.ai/artifact/XXaQnEbg8T1by6PYY17osj) stays on the old
repo until this one has a dashboard of its own.

## Layout

```
engine/core.py              Python reference engine (operations, debt, refinance, sponsor waterfall, timing, vehicle)
engine/core.js              line-for-line JS port, runs in the dashboard
engine/schema/deal.schema.json   what a deal file must contain (schema_version 1)
deals/<slug>/deal.json      the deal: meta, per-input sources, and every assumption
deals/<slug>/reference/     sponsor / our workbooks and the extracted tie-out targets
deals/<slug>/tests/         the deal's acceptance tests (tie-outs) and its randomizer for parity tests
web/index.template.html     dashboard UI
scripts/build_web.py        engine + deal file -> dist/<slug>/index.html (the published page)
scripts/export_excel.py     results -> dist/<slug>/<slug>_model_export.xlsx
tests/test_parity.py        JS = Python on every deal's defaults and randomized set-ups; every set-up reconciles
tests/test_deal_files.py    schema, meta, sources point at real inputs; reports unsourced / TODO inputs
```

## Everyday use

```bash
python -m pytest                              # everything (needs node, jsonschema, openpyxl)
python -m engine.core siena-villas            # print returns for a deal
python scripts/build_web.py siena-villas      # rebuild that deal's page
python scripts/export_excel.py siena-villas   # Excel export
```

## Deal files

`deal.json` has three parts:

- `meta` — name, sponsor, vehicle, status, documents (with paths into `reference/`), diligence list. Not read by the engines.
- `sources` — dotted input path -> where it came from (`"waterfall": "OA §8.1: ..."`). A source on a parent covers its
  children. `TODO: ...` marks a source still to be itemized; `test_deal_files.py` prints how many remain.
- the inputs — `deal`, `timing`, `waterfall`, `investor`, `cases`, `sensitivity`, `warehouse` (our vehicle),
  `direct_investors`. Schema version 1 is exactly Siena v1's input set plus `deal.underwritten_hold_years` and
  `deal.refi.crystallize_cost_pct` (both were constants in the Siena engines). Keys starting with `_` are notes.

Rules carried over from Siena: the engines never hold deal numbers; defaults reproduce the documents and every
alternative is a switch that's off by default; every dollar reconciles; Python and JS change together.

The input reference for every field (vehicle, people, sales, buy-ins, hurdle switches, refinance, crystallization,
timing) is the Siena README at `siena-v1.0`; it applies unchanged to schema version 1.

## Roadmap (from the project brief, Nov 4, 2026)

1. ~~Freeze Siena v1~~ · 2. ~~Scaffold engine + deals/ + schema~~ · 3. ~~Migrate Siena, tie-outs and parity unchanged~~
4. Deal #2 (The Bend, Focused / Elkstone) drives the generalization: waterfall as an ordered list of steps (pref type,
   return of capital, IRR or multiple hurdles, catch-ups, splits, classes) with crystallization and side letters as
   optional modules; debt as a list of loans; capex / lease-up schedules; Siena-specific names (`siena_frequency`,
   Redstone wording in the page) made generic, with a schema version bump and an upgrade step for saved scenarios.
5. Deal picker, per-deal saved scenarios, side-by-side comparison.
6. Intake as a reusable skill (deck + OA + sponsor model -> draft deal file with citations -> tie-out -> publish).

Not legal, tax or investment advice.
