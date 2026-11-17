// Page test (run by tests/test_web.py): the Quick checks panel (issue #37), for EVERY deal on the page (new deals are
// covered automatically). One row per house check, one column per case, each cell's status equal to the engine's;
// the per-unit table follows the case picked in Case detail; an input change moves a status; a deal's own threshold
// overrides the house's; Ask's get_quick_checks and solve_for on a quick-check metric work.
const __P = require('path');
const PAGE = 'file://' + __P.resolve(__dirname, '../../dist/index.html');
const OUT = __P.join(__dirname, '.out'); require('fs').mkdirSync(OUT, { recursive: true });
const { chromium } = require('playwright');
const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); };

(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1600 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(PAGE); await p.waitForTimeout(400);
  const slugs = await p.evaluate(() => Object.keys(DEALS));
  for (const slug of slugs) {
    await p.goto(PAGE + '#' + slug); await p.waitForTimeout(500);
    const r = await p.evaluate(() => {
      const rows = [...document.querySelectorAll('#qcTable tbody tr')];
      const want = qcAll(inputs, results);
      const bad = [];
      rows.forEach((tr, i) => [...tr.querySelectorAll('td.n')].forEach((td, j) => {
        const st = td.querySelector('.qc-dot').getAttribute('aria-label'), w = want[CASES[j]].checks[i].status;
        if (st !== w) bad.push(`${SCREENS.checks[i].id}/${CASES[j]}: ${st} vs ${w}`);
      }));
      return { n: rows.length, want: SCREENS.checks.length, cols: rows[0] ? rows[0].querySelectorAll('td.n').length : 0, cases: CASES.length, bad,
        title: document.getElementById('qcUnitTitle').textContent, shown: document.querySelector('#qcTable th.shown').textContent };
    });
    check(r.n === r.want && r.cols === r.cases && !r.bad.length, `${slug}: panel ${JSON.stringify(r)}`);
    // follows the case picked in Case detail
    const r2 = await p.evaluate(() => {
      const k = CASES.find((x) => x !== detailCase);
      document.querySelector(`#detailTabs [data-k="${k}"]`).click();
      return { k, title: document.getElementById('qcUnitTitle').textContent, label: results.cases[k].label, shown: document.querySelector('#qcTable th.shown').textContent, short: shortLabel(k) };
    });
    check(r2.title.includes(r2.label) && r2.shown === r2.short, `${slug}: follows Case detail ${JSON.stringify(r2)}`);
  }
  // Siena: Thaxter's number in the per-unit table, an input moves a status, a deal threshold overrides
  await p.goto(PAGE + '#siena-villas'); await p.waitForTimeout(500);
  const s = await p.evaluate(() => {
    document.querySelector(`#detailTabs [data-k="sponsor"]`).click();
    const debtRow = [...document.querySelectorAll('#qcUnits tbody tr')].find((tr) => /Debt service/.test(tr.textContent));
    const y1 = debtRow.querySelectorAll('td.n')[0].textContent;
    const st = () => document.querySelector('#qcTable tbody tr:nth-child(1) td.n:nth-child(2) .qc-dot').getAttribute('aria-label');
    const before = st();
    inputs.deal.annual_debt_service = 1100000; recompute();
    const after = st();
    inputs.screens = { dscr: { green: 1.0, amber: 0.9, source: 'Test covenant' } }; recompute();
    const over = st(), tip = document.querySelector('#qcTable tbody tr:nth-child(1) td.n:nth-child(2)').title, note = document.getElementById('qcNote').textContent;
    return { y1, before, after, over, tip, note };
  });
  check(s.y1 === '$481', `Siena debt service per unit per month ${s.y1}`);
  check(s.before === 'green' && s.after === 'red' && s.over === 'amber' && /Test covenant/.test(s.tip) && /own threshold for dscr/.test(s.note), `inputs and overrides: ${JSON.stringify(s)}`);
  await (await p.$('#qcPanel')).screenshot({ path: __P.join(OUT, 'quick_checks.png') });
  // Ask
  const a = await p.evaluate(() => {
    const T = (n) => ASK_TOOLS.find((x) => x.name === n);
    const q = T('get_quick_checks').execute({ deal: 'the-bend', case: 'base' });
    const sv = T('solve_for').execute({ deal: 'the-bend', case: 'base', path: 'deal.loan_rate', metric: 'min_dscr', target: 1.25, low: 0.03, high: 0.08 });
    return { ids: q.checks.map((c) => c.id), dscr: q.checks[0].by_case.base, unit: q.per_unit_per_month_by_year[0], sv };
  });
  check(a.ids.length === 7 && a.dscr.status === 'amber' && a.unit.breakeven_rent_debt > 500, `get_quick_checks: ${JSON.stringify({ ids: a.ids, dscr: a.dscr })}`);
  check(a.sv.found && a.sv.value > 0.03 && a.sv.value < 0.0584 && Math.abs(a.sv.achieved - 1.25) < 0.01, `solve_for min_dscr: ${JSON.stringify(a.sv)}`);
  errs.forEach((e) => fail.push('page error: ' + e));
  await b.close();
  if (fail.length) { console.log('FAIL\n' + fail.join('\n')); process.exitCode = 1; } else console.log('ok');
})();
