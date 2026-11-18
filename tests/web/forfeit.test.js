// Page test (run by tests/test_web.py): contribute by a date or forfeit the share (issue #42). Siena LTEC K (Thaxter
// misses Mar 15, 2027): the loan card shows the method, both partners' statements show the share changing hands on
// the date with no cash, the schedule ends "forfeited", Thaxter's total is his profit; switching "If not paid at
// maturity" to settled gives the paid case (LTEC J); Ask's get_vehicle reports the forfeiture.
const __P = require('path');
const PAGE = 'file://' + __P.resolve(__dirname, '../../dist/index.html');
const OUT = __P.join(__dirname, '.out'); require('fs').mkdirSync(OUT, { recursive: true });
const { chromium } = require('playwright');
const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); };

(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1600 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(PAGE + '#siena-villas'); await p.waitForTimeout(500);
  const pick = (re) => p.evaluate((src) => { const x = [...document.querySelectorAll('#sec-variants [data-v]')].find((e) => new RegExp(src).test(e.textContent)); if (x) x.click(); return !!x; }, re);
  check(await pick('misses Mar 15'), 'variant K'); await p.waitForTimeout(300);
  let r = await p.evaluate(() => {
    const st = (party) => { cbpParty = party; cbpCase = 'base'; cbpView = 'statement'; cbpFreq = 0; renderCashByPerson(); return document.getElementById('cbpTable').textContent; };
    const th = st('p1'), tot = [...document.querySelectorAll('#cbpTable table.stmt tr.total td')][2].textContent;
    const lv = st('p0');
    return { preset: document.querySelector('[data-path="warehouse.manager_loans.0.preset"] select').value,
      note: document.querySelector('.loan-terms-note').textContent, th: /Signs LTEC share over to Levi \(50% of capital, 50% of fees & promote\)/.test(th),
      sched: /Not paid: share forfeited to the lender, loan cancelled/.test(th), lv: /Takes over Thaxter's LTEC share/.test(lv),
      tot, want: fmt.usd(results.warehouse.base.summary.people[1].profit), f: results.warehouse.base.manager_forfeitures };
  });
  check(r.preset === 'bridge_forfeit' && /whole LTEC share goes to the lender/.test(r.note), `card: ${JSON.stringify({ preset: r.preset, note: r.note })}`);
  check(r.th && r.sched && r.lv && r.tot === r.want && r.f.length === 1 && r.f[0].date === '2027-03-15', `statements: ${JSON.stringify(r)}`);
  await (await p.$('#cbpTable')).screenshot({ path: __P.join(OUT, 'forfeit_statement.png') });
  // the options: fees & promote only keeps the capital and the loan; the words follow
  await p.evaluate(() => { const el = document.querySelector('[data-path="warehouse.manager_loans.0.forfeit_scope"] select'); el.value = 'promote'; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.waitForTimeout(300);
  r = await p.evaluate(() => ({ f: results.warehouse.base.manager_forfeitures[0], s: results.warehouse.base.manager_loans[0].settled,
    fields: ['forfeit_mode', 'own_capital'].every((k) => !!document.querySelector(`[data-path="warehouse.manager_loans.0.${k}"]`)),
    note: document.querySelector('.loan-terms-note').textContent }));
  check(r.f.capital_share === 0 && r.f.promote_share === 0.5 && r.s === 'paid_at_maturity' && r.fields && /fees & promote share goes to the lender; the loan stays owed/.test(r.note), `promote only: ${JSON.stringify(r)}`);
  // the paid case by one switch
  await p.evaluate(() => { const el = document.querySelector('[data-path="warehouse.manager_loans.0.at_maturity"] select'); el.value = 'settle'; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.waitForTimeout(300);
  r = await p.evaluate(() => ({ s: results.warehouse.base.manager_loans[0].settled, f: results.warehouse.base.manager_forfeitures.length }));
  check(r.s === 'paid_at_maturity' && r.f === 0, `paid case: ${JSON.stringify(r)}`);
  // Ask
  r = await p.evaluate(() => { const d = DEALS['siena-villas'], K = d.meta.alternatives.find((a) => /misses Mar 15/.test(a.name));
    const v = ASK_TOOLS.find((x) => x.name === 'get_vehicle').execute({ deal: 'siena-villas', case: 'base', changes: { 'warehouse.manager_loans': K.set['warehouse.manager_loans'], 'warehouse.people': E.applyVariant(d, K, STRUCTURES).warehouse.people } });
    return v.manager_forfeitures || v; });
  check(Array.isArray(r) && r[0] && r[0].to === 'Levi' && r[0].capital_share === 0.5, `get_vehicle: ${JSON.stringify(r).slice(0, 300)}`);
  errs.forEach((e) => fail.push('page error: ' + e));
  await b.close();
  if (fail.length) { console.log('FAIL\n' + fail.join('\n')); process.exitCode = 1; } else console.log('ok');
})();
