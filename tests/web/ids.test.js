// Page test (run by tests/test_web.py): stable ids (issue #14). Renaming a person or the manager in the deal file flows
// into variant titles and variants; saved scenarios store people changes by id; older saves (names, no ids, index
// paths) still load with ids and working references.
const __P = require('path');
const PAGE = 'file://' + __P.resolve(__dirname, '../../dist/index.html');
const { chromium } = require('playwright');
const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); };
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1400 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(PAGE + '#siena-villas'); await p.waitForTimeout(500);
  const r = await p.evaluate(() => {
    const out = {};
    // 1. a rename in the deal file: variant titles and the variant itself use the new names; references still work
    DEFAULTS.warehouse.people[0].name = 'Bob'; DEFAULTS.warehouse.names.manager = 'Acme';
    renderVariants();
    const btn = [...document.querySelectorAll('#sec-variants [data-v]')].find((x) => /lends/.test(x.textContent));
    out.title = btn && btn.querySelector('b').textContent;
    btn.click();
    out.lender = inputs.warehouse.manager_loans[0].lender; out.firstName = inputs.warehouse.people[0].name;
    out.loan = results.warehouse.base.manager_loans[0]; out.issues = vehicleIssues(inputs, results.warehouse.base.summary);
    out.menu = [...document.querySelectorAll('[data-path="warehouse.manager_loans.0.lender"] option')].map((o) => [o.value, o.textContent]);
    DEFAULTS.warehouse.people[0].name = 'Levi'; DEFAULTS.warehouse.names.manager = 'LTEC';
    // 2. saved-scenario diffs address people by id: a rename and a new person
    const inp = clone(DEALS['siena-villas']);
    inp.warehouse.people[0].name = 'Levi I.'; inp.warehouse.people[1].manager_capital = 0;
    inp.warehouse.people.push({ id: 'gp_partner', name: 'GP partner', amount: 0, role: 'member', manager_capital: 0, manager_share: 0, loan_rate: 0.08 });
    out.diff = scenarioDiff(inp, 'siena-villas');
    // ...and a later deal-file rename of someone the scenario didn't rename flows into it
    const deal = DEALS['siena-villas'], keep = deal.warehouse.people[1].name;
    deal.warehouse.people[1].name = 'T. Smith';
    const back = scenarioInputs({ deal: 'siena-villas', diff_json: JSON.stringify(out.diff) }, 'siena-villas');
    out.back = back.warehouse.people.map((q) => [q.id, q.name, q.manager_capital]);
    deal.warehouse.people[1].name = keep;
    // 3. an older full-inputs save: people without ids, loans by name
    const old = clone(DEALS['siena-villas']);
    old.warehouse.people.forEach((q) => { delete q.id; });
    old.warehouse.manager_loans = [{ lender: 'Levi', borrower: 'Thaxter', amount: 1000, rate: 0.08, rate_type: 'simple', recourse: true }];
    const up = scenarioInputs({ deal: 'siena-villas', inputs: JSON.stringify(old) }, 'siena-villas');
    out.oldIds = up.warehouse.people.map((q) => q.id); out.oldLoan = [up.warehouse.manager_loans[0].lender, up.warehouse.manager_loans[0].borrower];
    // 4. an older diff save with index paths still applies
    const idx = scenarioInputs({ deal: 'siena-villas', diff_json: JSON.stringify({ 'warehouse.people.1.manager_capital': 12345 }) }, 'siena-villas');
    out.idx = idx.warehouse.people[1].manager_capital;
    return out;
  });
  check(r.title === 'Acme C · Bob lends Thaxter his half at 8%', `variant title: ${r.title}`);
  check(r.lender === 'levi' && r.firstName === 'Bob', `variant after rename: lender ${r.lender}, first person ${r.firstName}`);
  check(r.loan && r.loan.settled !== 'invalid' && r.loan.lender === 'Bob', `loan after rename: ${JSON.stringify(r.loan)}`);
  check(!r.issues.length, `no vehicle issues expected: ${r.issues}`);
  check(JSON.stringify(r.menu) === JSON.stringify([['levi', 'Bob'], ['thaxter', 'Thaxter']]), `lender menu: ${JSON.stringify(r.menu)}`);
  check(r.diff['warehouse.people[levi].name'] === 'Levi I.' && r.diff['warehouse.people[thaxter].manager_capital'] === 0 && r.diff['warehouse.people[gp_partner]'] && r.diff['warehouse.people[gp_partner]'].name === 'GP partner',
    `scenario diff by id: ${JSON.stringify(r.diff)}`);
  check(JSON.stringify(r.back) === JSON.stringify([['levi', 'Levi I.', r.back[0][2]], ['thaxter', 'T. Smith', 0], ['gp_partner', 'GP partner', 0]]), `scenario after deal-file rename: ${JSON.stringify(r.back)}`);
  check(JSON.stringify(r.oldIds) === '["levi","thaxter"]' && JSON.stringify(r.oldLoan) === '["levi","thaxter"]', `older save upgrade: ${r.oldIds} ${r.oldLoan}`);
  check(r.idx === 12345, `index-path diff: ${r.idx}`);
  errs.forEach((e) => fail.push('page error: ' + e));
  await b.close();
  if (fail.length) { console.log('FAIL\n' + fail.join('\n')); process.exitCode = 1; } else console.log('ok');
})();
