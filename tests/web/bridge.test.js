// Page test (run by tests/test_web.py): bridges and pay-downs (issue #31). Siena variant LTEC H (Levi bridges
// Thaxter's half until Jun 30, 2027) shows the Bridge method settled on the exact date; adding a pay-down from the
// card adds its own dated payment; Thaxter's statement and his period totals both add up to his profit (the flow
// layout has a column per off-cycle date); LTEC I (the buy-in way) shows names, not ids, in the panel summary.
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
  check(await pick('bridges Thaxter'), 'variant H'); await p.waitForTimeout(250);
  let r = await p.evaluate(() => ({
    preset: document.querySelector('[data-path="warehouse.manager_loans.0.preset"] select').value,
    dueOn: document.querySelector('[data-path="warehouse.manager_loans.0.due_on"] select').value,
    ln: results.warehouse.base.manager_loans[0], dates: results.warehouse.base.loan_payment_dates,
    note: document.querySelector('.loan-terms-note').textContent }));
  check(r.preset === 'bridge' && r.dueOn === 'exact_date' && r.ln.settled === 'paid_at_maturity' && r.ln.due_date === '2027-06-30' && JSON.stringify(r.dates) === '["2027-06-30"]',
    `bridge: ${JSON.stringify(r)}`);
  check(/settled on the exact date from Thaxter's own money/.test(r.note), `bridge words: ${r.note}`);

  // the late case (#33): not paid at maturity, Thaxter's LTEC cash repays it from then on
  await p.evaluate(() => { const el = document.querySelector('[data-path="warehouse.manager_loans.0.at_maturity"] select'); el.value = 'sweep'; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.waitForTimeout(250);
  r = await p.evaluate(() => { const ln = results.warehouse.base.manager_loans[0];
    cbpParty = 'p1'; cbpCase = 'base'; cbpView = 'statement'; cbpFreq = 12; renderCashByPerson();
    const t = document.getElementById('cbpTable').textContent;
    return { sw: ln.switched_on, rep: ln.repaid, row: /Not paid at maturity: LTEC cash repays it from here/.test(t), sweeps: /Repays Levi \(partner loan\)/.test(t),
      words: /if not paid by 2027-06-30, Thaxter's LTEC cash repays it from then on/.test(document.querySelector('.loan-terms-note').textContent),
      label: document.querySelector('[data-path="warehouse.manager_loans.0.preset"] select').selectedOptions[0].textContent }; });
  check(r.sw === '2027-06-30' && r.rep > 0 && r.row && r.sweeps && r.words && /Bridge.*\(edited\)/.test(r.label), `late bridge: ${JSON.stringify(r)}`);
  await p.evaluate(() => { const el = document.querySelector('[data-path="warehouse.manager_loans.0.at_maturity"] select'); el.value = 'settle'; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.waitForTimeout(200);
  // add a pay-down from the card, then set its date and amount
  await p.evaluate(() => document.querySelector('[data-add-paydown="0"]').click()); await p.waitForTimeout(200);
  await p.evaluate(() => {
    const set = (path, v) => { const el = document.querySelector(`[data-path="${path}"] input`); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    set('warehouse.manager_loans.0.paydowns.0.date', '2027-02-15'); set('warehouse.manager_loans.0.paydowns.0.amount', '40000');
  });
  await p.waitForTimeout(250);
  r = await p.evaluate(() => {
    const R = results.warehouse.base, i = 1;
    cbpParty = 'p1'; cbpCase = 'base'; cbpView = 'statement'; cbpFreq = 0; renderCashByPerson();
    const st = document.getElementById('cbpTable').textContent;
    const stTot = [...document.querySelectorAll('#cbpTable table.stmt tr.total td')][2].textContent;
    cbpView = 'periods'; cbpFreq = 12; renderCashByPerson();
    const per = cbpParties().find((x) => x.id === 'p1'), perTot = per.flows.reduce((a, f) => a + f.amount, 0);
    const lastDist = per.flows[per.flows.length - 1], payoff = per.flows.find((f) => f.date === '2027-06-30');
    return { dates: R.loan_payment_dates, paid: R.loan_schedules[0].filter((x) => x.kind === 'paydown').map((x) => x.paid), st: /Pays down the loan from Levi \(own money\)/.test(st) && /2027-02-15/.test(st),
      stTot, want: fmt.usd(R.summary.people[i].profit), perTot: Math.round(perTot), profit: Math.round(R.summary.people[i].profit), lastKind: lastDist.kind, payoffKind: payoff && payoff.kind, owed: R.manager_loans[0].owed_end };
  });
  check(JSON.stringify(r.dates) === '["2027-02-15","2027-06-30"]' && r.paid.length === 1 && Math.abs(r.paid[0] - 40000) < 0.01, `pay-down: ${JSON.stringify(r)}`);
  check(r.st && r.stTot === r.want, `statement: ${JSON.stringify(r)}`);
  check(r.perTot === r.profit && r.lastKind === 'dist' && r.payoffKind === 'in', `period totals add up (flow layout): ${JSON.stringify(r)}`);
  await (await p.$('#cbpTable')).screenshot({ path: __P.join(OUT, 'bridge_totals.png') });

  // remove it again
  await p.evaluate(() => document.querySelector('[data-remove-paydown="0.0"]').click()); await p.waitForTimeout(200);
  check(await p.evaluate(() => (inputs.warehouse.manager_loans[0].paydowns || []).length === 0 && results.warehouse.base.loan_payment_dates.length === 1), 'pay-down removed');

  // picking another method keeps the pay-downs
  await p.evaluate(() => document.querySelector('[data-add-paydown="0"]').click()); await p.waitForTimeout(150);
  await p.evaluate(() => { const el = document.querySelector('[data-path="warehouse.manager_loans.0.preset"] select'); el.value = 'interest_only_balloon'; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.waitForTimeout(250);
  check(await p.evaluate(() => inputs.warehouse.manager_loans[0].paydowns.length === 1 && inputs.warehouse.manager_loans[0].repayment === 'interest_only'), 'pay-downs kept across methods');

  // LTEC I: the buy-in way; the panel summary shows names
  check(await pick('buys in Jun 30'), 'variant I'); await p.waitForTimeout(250);
  r = await p.evaluate(() => ({ x: results.warehouse.base.manager_transfers[0], sum: document.querySelector('[data-grp="wh-buyins"]').textContent }));
  check(r.x.buyer === 'Thaxter' && r.x.paid > 175000 && /Thaxter ← Levi/.test(r.sum), `buy-in: ${JSON.stringify({ paid: r.x.paid, sum: r.sum.slice(0, 120) })}`);
  errs.forEach((e) => fail.push('page error: ' + e));
  await b.close();
  if (fail.length) { console.log('FAIL\n' + fail.join('\n')); process.exitCode = 1; } else console.log('ok');
})();
