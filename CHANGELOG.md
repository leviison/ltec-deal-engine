# Changelog

Releases of the LTEC Deal Engine (engine + dashboard). The version is in `engine/version.json`, shown at the foot of
the dashboard and on every export, and recorded on each saved scenario (`engine_version`). Each release is a git tag
`vX.Y.Z`. Major = results change on purpose or the schema breaks; minor = new inputs/features, results unchanged when
they are off; patch = fixes.

## 2.6.0 — 2026-11-07

- Loan terms (#24, schema 8): a partner loan says how it's repaid. Parts: repayment (a share of the borrower's
  LTEC cash, interest only, equal principal over N years, at exit, or nothing along the way), the share swept, the
  years, whether the borrower covers a shortfall, a maturity date, recourse, and what happens if the borrower leaves
  (vesting). A library of known methods (`engine/loan_terms.json`: cash sweep, half sweep, interest only with a
  balloon, interest paid current, amortizing, accrue to exit, forgivable if the borrower stays) fills the parts;
  any part can then be edited ("edited" shows on the loan). Loans without terms keep the original rule, so all
  results are unchanged.
- Both engines, identical (randomized terms in the parity test); every term writes ledger entries and schedule
  rows (paid at maturity, paid on leaving, forgiven). Hand calculations in `tests/test_loan_terms.py`.
- Siena variants **LTEC F** (interest only, balloon at exit) and **LTEC G** (forgiven if Thaxter stays 3 years).
- Dashboard: Terms on each loan card with a plain-English "In short"; the same words on the statement's loan
  schedule, Compare and both exports. Ask: `list_inputs` lists the presets and parts; `get_vehicle` and
  `get_statement` return each loan's terms and due date.
- Exports show people's names (not ids) for partner loans and vesting.

## 2.5.0 — 2026-11-07

- Ledger (#21): `warehouse_case` returns each person's dated entries by account (the vehicle's units, the manager,
  each partner loan, buy-ins): contributions, distributions, unit sales and purchases, loan advances, repayments and
  settlement at the end, buy-in payments; and a schedule per partner loan (interest, payment, balance by date). Both
  engines, identical; on every date a person's entries add up exactly to their cash flows (tested on every deal,
  variant and case, and 120 random set-ups).
- Cash by person: a **Statement** view (every payment in words, by period or each date, with a running total and
  each partner loan's schedule) and **Balances as of** a date (put in, received, who owes whom on the loans).
- Ask: `get_statement` (a person's ledger, loan schedules and balances as of a date).
- Warning when someone warehouses units with no sale set.

## 2.4.0 — 2026-11-06

- Click to edit (#20): what one input drives links to that input, with a pencil on hover. Vehicle warnings (in a box
  at the top of the vehicle card and on saved scenarios) go to the field to fix; the "N changes" chip shows only what's
  changed; case cards open that case's assumptions; exit figures (exit cap, hold, loan payoff, sponsor promote,
  refinance) open their inputs. Results (IRR, profit) stay plain.
- Ask links inputs it names (`[exit cap](input:cases.downside.exit_cap)`, or `input:<deal>/<path>` for another deal),
  and each what-if lists the inputs it changes as links.
- LP equity (Sponsor terms) and units (Costs & sale) are now editable in the panel.
- Coverage test: every input in every deal file opens a field in the panel, or is listed with the reason it doesn't
  (bookkeeping, document context the engine doesn't use, fields behind a switch, empty lists). A new deal or input
  with nowhere to go fails the tests.

## 2.3.0 — 2026-11-06

- Side panel follows the flow (#18), in fixed, labelled stages in the order of the flow diagram: **Which version**
  (variants, saved scenarios) · **The deal** (operating cases, sponsor terms, loan, hold, distribution timing, costs &
  sale) · **Our position** (your investment incl. the side letter, other investors) · **Our vehicle** (structure,
  names, raise, fees, sell-down, people) · **LTEC and its partners** (its own terms, buy-ins) · **Tools**.
  "Side letter & sale" is split: the side letter sits with our check, selling costs / CapEx reserves / TIF with the deal.
- Clicking a box in the flow diagram opens and scrolls to the cards that control it.
- "Show only what's changed" hides every card, group, person and field still at the deal file's value.
- "Find an input": type a label ("exit cap", "carry") and jump to the field.
- No drag-to-rearrange, on purpose: position carries meaning in a shared model.

## 2.2.1 — 2026-11-06

- Structure picker (#16): the description is filled from the template's own numbers (it said "6% carry" as fixed
  text, so an edited carry looked ignored; the engine always used the edited rate). Once the vehicle is edited, the
  picker lists what changed from the template ("sale carry 8.0% (template 6.0%)") and says that picking a structure
  again resets to LTEC's house terms (`engine/structures.json`).
- `scripts/apply_structure.py --variant` writes a patch-style variant (`structure` key) instead of a frozen copy.

## 2.2.0 — 2026-11-06

- Stable ids (#14): every person in a vehicle has an `id` (schema 7); names are labels only. Partner loans, vesting,
  buy-ins and person sales refer to people by id, so renaming Levi → Bob or LTEC → another entity changes labels and
  nothing else. Older files and saves that use names still work (the engines resolve ids first, then names).
- Variants state only what they change: `set` paths address people by id (`warehouse.people[levi].manager_capital`)
  and `structure` names a template built for the current check and partners. Titles and notes fill in current names
  (`{manager} C · {levi} lends {thaxter}…`). Siena's LTEC A–E and The Bend's SPV variants give identical results.
- Saved scenarios store people changes by id; older saves get ids and id references when they load.
- `reference_issues` / `referenceIssues`: a check that every reference resolves, run by the tests (deal files and every
  variant, after a rename too) and shown on the page.

## 2.1.0 — 2026-11-06

- Structure templates (#12): how LTEC holds a deal is now a choice: "Direct: LTEC invests", "SPV, fully subscribed" or
  "SPV with warehouse & sell-down (SV26-style)" (`engine/structures.json`, house terms in one place). Applied from the
  deal's check and close date, keeping LTEC's partners and LTEC's own terms; identical in Python and JS.
  `warehouse.structure` records the choice (schema 6); `scripts/apply_structure.py` sets it on a deal or adds a variant.
- Dashboard: a "How LTEC holds this deal" picker (marked "edited" once you change the vehicle) and a flow diagram
  (deal → vehicle → members / LTEC → partners) with the main case's cash in each box.
- The Bend: the deal file now holds it directly through LTEC with Levi and Thaxter as LTEC's partners (50/50, an
  assumption to confirm) instead of "LTEC" as a single member; two SPV variants. Deal results are unchanged; the
  vehicle now shows each partner.
- The flow diagram follows "Case to show" with its own case buttons; tables with every case mark that column, and the
  vehicle callout describes that case.

## 2.0.0 — 2026-11-06

Tagged `v.2.0.0` on GitHub (commit f729dbd; later releases use `vX.Y.Z`). First tagged release of the multi-deal engine (Siena Villas v1 lives on in leviison/siena-villas-model, `siena-v1.0`).

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
