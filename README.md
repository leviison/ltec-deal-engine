# LTEC Deal Engine

One engine and one dashboard for the real-estate syndications LTEC evaluates and invests in (usually through its own
SPV). Each deal is a data file; the engines, tests and dashboard are shared.

## Deals

| Deal | Sponsor | Status | Ties to |
|---|---|---|---|
| `siena-villas` | Redstone | active (SV26) | v10 + SV26 workbooks, to the cent |
| `the-bend` | Focused Capital / Elkstone Capital | screening | sponsor model 9-23-26, to the cent (both of its waterfalls) |

**Deal #1:** Siena Villas, migrated from `leviison/siena-villas-model` @ `siena-v1.0` (`2ee8ccd`). Its results are
bit-identical to that version (Python and JS, defaults + 200 randomized set-ups) and it still ties to its v10 and SV26
workbooks to the cent. The live Siena dashboard (https://claude.ai/artifact/XXaQnEbg8T1by6PYY17osj) stays on the old
repo until this one has a dashboard of its own.

**Deal #2:** The Bend (312 units, Clarksville IN). Ties to the sponsor's model at default inputs: operations, debt,
TIF rebate, fees, sale (incl. reserves returned and the TIF NPV), the default waterfall ('Partnership Returns' tab,
LP IRR 17.0861%, 2.0611x), the 'UW Model' tab waterfall as an alternative (17.0639%) with its exit-cap sensitivity
table, and the deck's $100k sample. `meta.alternatives` holds named variants (UW-tab waterfall, the Oct 14
side-letter offer, no TIF value at sale); `meta.diligence` the open questions.

## Dashboard

One page, every deal: **LTEC Deal Engine** (https://claude.ai/artifact/DLhZKbmvQwLC1NFoYySKvZ). Pick a deal at the top
(or open `#the-bend`, `#siena-villas`); each deal shows its own cases, terms, variants, diligence and saved scenarios.
`python scripts/build_web.py` builds it (`dist/index.html`); `python scripts/build_web.py <slug>` builds one deal alone.
Adding a deal folder adds it to the picker on the next build.

**Cases shown** in the comparison: Sponsor, Adjusted Base, Downside by default; Stress and Custom one click away.

**Comparison columns** are a deal plus a version: current (with your edits), as underwritten, or any saved scenario
for that deal. "+ Add column" puts versions side by side (e.g. The Bend as-is vs The Bend "Aggressive ask" vs Siena);
"Open" loads that version on its deal. Columns are remembered per viewer.

**Export** (top right, both views): a PDF summary to share (cases, cash chart, side letter, terms, what each case
assumes, open diligence) and an Excel workbook to check the math (summary, every case year by year with its
waterfall, inputs with sources and what you changed, diligence; the comparison exports its table plus a summary per
column). ExcelJS (styled workbook) and jsPDF load from jsDelivr only when exporting; files go out through the `downloads` capability.

**Ask** (below the case cards, or under the comparison): questions about the deals in plain English, answered by
Claude using the engine on the page. The first question asks the viewer to allow Claude for the page; questions use
that viewer's Claude usage.

**Compare deals** (the view switch at the top, or `#compare`) puts every deal side by side: LP IRR, multiple, Years 1-4
cash yield and profit per $1M for the sponsor's case, our Adjusted Base and our Downside; the sponsor-vs-us IRR gap;
cumulative cash per $1M by deal for a chosen case; and deal context (price per unit, going-in cap, loan / total capital,
Year-1 debt coverage, waterfall, open diligence). Each deal keeps your edits for the session as you switch between deals; the
comparison and the Ask panel use them (flagged "your edits", and "edited" in the picker). Edits last until the page
is closed; Save keeps a scenario for good. Click a deal to open it.

## Our cases on every deal

Each deal shows the sponsor's case next to ours. Our cases are `derived`: they take the sponsor case's rows and adjust
them, so any deal can carry them whatever shape the sponsor's model has.

| Setting | What it does |
|---|---|
| `rent_factor`, `other_income_factor`, `opex_factor` | scale the source's line every year (0.99 = 1% lower) |
| `rent_path` / `other_income_path` / `opex_path` | `source` follows the sponsor's year-by-year path; `growth` grows from Year 1 at `*_growth` |
| `rent_adjust` | $ by year, e.g. concessions above the sponsor's (negative) |
| `opex_add`, `opex_add_start_year`, `opex_add_growth` | an added expense, e.g. a tax reassessment |
| `exit_cap` | the case's exit cap |
| `deal_overrides` | deal inputs this case changes, e.g. `{"below_noi_income": {"sale_value": "none"}}` |

`python scripts/add_standard_cases.py <slug>` adds LTEC's standard Adjusted Base / Downside / Stress to a new deal from
`engine/standard_cases.json` (exit caps as spreads over the sponsor's), marked `TODO` until tuned to the deal.
On The Bend, defaults give 13.4% / 8.2% / loss; the tuned cases (concessions at the T-12 level, taxes at Indiana's 2%
cap, no TIF value at sale in the downside) give 11.8% / 3.4% / loss against the sponsor's 17.1%.
Siena keeps its v10 cases (growth kind), which tie to the workbook.

## Layout

```
engine/core.py              Python reference engine (operations, debt, refinance, sponsor waterfall, timing, vehicle)
engine/core.js              line-for-line JS port, runs in the dashboard
engine/schema/deal.schema.json   what a deal file must contain (schema_version 3)
deals/<slug>/deal.json      the deal: meta, per-input sources, and every assumption
deals/<slug>/reference/     sponsor / our workbooks and the extracted tie-out targets
deals/<slug>/tests/         the deal's acceptance tests (tie-outs) and its randomizer for parity tests
web/index.template.html     dashboard UI
scripts/build_web.py        engine + deal files -> dist/index.html (all deals, the published page)
scripts/add_standard_cases.py   adds LTEC's standard cases to a deal
scripts/export_excel.py     results -> dist/<slug>/<slug>_model_export.xlsx
tests/test_parity.py        JS = Python on every deal's defaults and randomized set-ups; every set-up reconciles
tests/test_deal_files.py    schema, meta, sources point at real inputs; reports unsourced / TODO inputs
tests/test_cases.py         derived cases reproduce their source when neutral; overrides stay in their case
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
  `direct_investors`. Keys starting with `_` are notes.
  - v1 = Siena v1's input set plus `deal.underwritten_hold_years` and `deal.refi.crystallize_cost_pct` (both were
    constants in the Siena engines).
  - v2 (The Bend) adds `deal.exit_noi_basis` (`forward` = next year's NOI, `trailing` = final hold year's),
    `deal.reserves_returned_at_sale`, `deal.below_noi_income` (cash below NOI by hold year, e.g. a TIF rebate, with
    optional NPV of the remainder at a sale), `waterfall.return_of_capital` (`all_cash`, or `capital_events` =
    operating cash above the pref goes to the splits and capital comes back only from a sale / refinance), and
    `investor.side_letter` (our pro-rata share of partnership cash runs through overridden terms; everyone else
    unchanged, so the difference comes out of the promote). Siena's values reproduce v1 exactly.

Rules carried over from Siena: the engines never hold deal numbers; defaults reproduce the documents and every
alternative is a switch that's off by default; every dollar reconciles; Python and JS change together.

The input reference for every field (vehicle, people, sales, buy-ins, hurdle switches, refinance, crystallization,
timing) is the Siena README at `siena-v1.0`; it still applies; the v2 additions are described above.

## Roadmap (from the project brief, Nov 4, 2026)

1. ~~Freeze Siena v1~~ · 2. ~~Scaffold engine + deals/ + schema~~ · 3. ~~Migrate Siena, tie-outs and parity unchanged~~
4. ~~Deal #2 (The Bend)~~: tied out with the waterfall still parameters (it fit: IRR tiers or simple pref, plus a
   return-of-capital switch and side-letter terms). Still to generalize when a deal needs it: waterfall as an ordered
   list of steps (multiple hurdles, catch-ups, share classes); debt as a list of loans (The Bend's loan matures in
   Year 5); capex / lease-up schedules; Siena names in data (`timing.siena_frequency`) and Redstone/Siena wording in
   the page.
5. ~~Deal picker, per-deal saved scenarios, our cases on every deal, side-by-side comparison~~.
   ~~Ask panel~~: Claude, on each viewer's own account, with the engine as tools (read a deal or a case by year, run a
   what-if, solve for a target, compare deals, look up sources). Every number it states is computed by the engine; each
   what-if it runs gets an "Open on dashboard" button. Shown in both views.
6. Intake as a reusable skill (deck + OA + sponsor model -> draft deal file with citations -> tie-out -> publish).

Not legal, tax or investment advice.
