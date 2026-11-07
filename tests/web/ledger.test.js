// Page test (run by tests/test_web.py): the ledger views (issue #21). A partner loan on Siena: the borrower's statement
// adds up to their profit in every case and says who they repay; "balances as of" matches the loan's schedule; the
// Ask statement tool agrees; a person warehousing units with no sale gets a warning.
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
  await p.evaluate(() => {
    const w = inputs.warehouse;
    w.manager_loans = [{ lender: 'levi', borrower: 'thaxter', amount: 150000, rate: 0.08, rate_type: 'simple', recourse: true }];
    renderWarehouseInputs(); recompute();
    cbpParty = 'p1'; cbpView = 'statement'; cbpFreq = 12; renderCashByPerson();
  });
  for (const k of ['sponsor', 'base', 'downside', 'stress']) {
    await p.evaluate((k) => document.querySelector(`#cbpCases [data-cbp-case="${k}"]`).click(), k); await p.waitForTimeout(120);
    const r = await p.evaluate((k) => {
      const tot = [...document.querySelectorAll('#cbpTable table.stmt tr.total td')][2].textContent;
      const txt = document.getElementById('cbpTable').textContent;
      return { tot, want: fmt.usd(results.warehouse[k].summary.people[1].profit), loanIn: /Loan from Levi toward LTEC capital/.test(txt),
        repays: /Repays Levi \(partner loan\)|Pays Levi what's left on the loan/.test(txt), sched: !!document.querySelector('#cbpTable details.loan-sched'), settled: results.warehouse[k].manager_loans[0].settled };
    }, k);
    check(r.tot === r.want, `${k}: statement total ${r.tot} vs profit ${r.want}`);
    check(r.loanIn && r.repays && r.sched, `${k}: statement should show the loan, repayments and the schedule: ${JSON.stringify(r)}`);
  }
  // every date shows more rows than by year
  const rowsYear = await p.evaluate(() => document.querySelectorAll('#cbpTable table.stmt tbody tr').length);
  await p.evaluate(() => document.querySelector('#cbpFreq [data-cbp-freq="0"]').click()); await p.waitForTimeout(120);
  const rowsDate = await p.evaluate(() => ({ n: document.querySelectorAll('#cbpTable table.stmt tbody tr').length,
    whens: [...document.querySelectorAll('#cbpTable table.stmt tbody tr:not(.total) td.lbl')].map((x) => x.textContent).filter(Boolean) }));
  check(rowsDate.n >= rowsYear && rowsDate.whens.slice(1).every((w) => /^\d{4}-\d{2}-\d{2}$/.test(w)), `each-date view should list dates: ${JSON.stringify(rowsDate.whens.slice(0, 4))}`);
  // balances as of a date match the loan's schedule; later rows are greyed
  const asOf = await p.evaluate(() => {
    const sch = results.warehouse[cbpCase].loan_schedules[0], mid = sch[Math.floor(sch.length / 2)].date;
    const i = document.getElementById('cbpAsOf'); i.value = mid; i.dispatchEvent(new Event('change', { bubbles: true }));
    const past = sch.filter((x) => x.date <= mid), want = fmt.usd(past[past.length - 1].balance);
    return { mid, box: document.getElementById('cbpBalances').textContent, want, later: document.querySelectorAll('#cbpTable tr.later').length };
  });
  check(asOf.box.includes(`owes Levi ${asOf.want}`) && asOf.later > 0, `balances as of ${asOf.mid}: ${asOf.box} (want ${asOf.want}), greyed ${asOf.later}`);
  await (await p.$('#cbpTable')).screenshot({ path: __P.join(OUT, 'statement.png') });
  // Ask's statement tool agrees with the engine
  const ask = await p.evaluate((mid) => {
    const t = ASK_TOOLS.find((x) => x.name === 'get_statement');
    const r = t.execute({ deal: 'siena-villas', case: 'downside', person: 'thaxter', as_of: mid, changes: { 'warehouse.manager_loans': inputs.warehouse.manager_loans } });
    const sch = r.partner_loans[0].schedule.filter((x) => x.date <= mid);
    return { total: r.total, want: Math.round(results.warehouse.downside.summary.people[1].profit), bal: r.partner_loans[0].balance_as_of, wantBal: sch[sch.length - 1].balance, years: r.totals_by_year.length };
  }, asOf.mid);
  check(Math.abs(ask.total - ask.want) <= 1 && ask.bal === ask.wantBal && ask.years > 0, `get_statement: ${JSON.stringify(ask)}`);
  // warehousing with no sale is flagged
  const warn = await p.evaluate(() => { inputs.warehouse.selldown.tranches = []; renderWarehouseInputs(); recompute(); return document.getElementById('whIssues').textContent; });
  check(/warehouses .* but no sale is set/.test(warn), `warehousing warning: ${warn}`);
  errs.forEach((e) => fail.push('page error: ' + e));
  await b.close();
  if (fail.length) { console.log('FAIL\n' + fail.join('\n')); process.exitCode = 1; } else console.log('ok');
})();
