// Page test (run by tests/test_web.py): Cash by person in finer periods under annual timing (issue #35). Every month
// (and quarter) of the final year shows its share of that year's operating distribution, not a blank row; the
// totals still equal the person's profit; the sale part lands in the period it's paid. Both deals, every case.
const __P = require('path');
const PAGE = 'file://' + __P.resolve(__dirname, '../../dist/index.html');
const { chromium } = require('playwright');
const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); };

(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1600 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  for (const slug of ['siena-villas', 'the-bend']) {
    await p.goto(PAGE + '#' + slug); await p.waitForTimeout(500);
    const r = await p.evaluate(() => {
      const out = [];
      for (const k of CASES) {
        const C = results.cases[k];
        if (C.waterfall.cash.slice(-1)[0] <= 0 || C.operations.operating_cash_flow.slice(-1)[0] <= 0) continue;  // nothing to pay in the last year (e.g. a stress case)
        for (const freq of [1, 3]) {
          cbpCase = k; cbpView = 'periods'; cbpFreq = freq; cbpParty = 'v'; renderCashByPerson();
          const rows = [...document.querySelectorAll('#cbpTable tbody tr:not(.total)')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));
          const dist = rows.slice(1).map((x) => x[3]);
          const lastYear = dist.slice(-12 / freq);
          const me = cbpParties().find((x) => x.id === 'v');
          const profit = me.flows.reduce((a, f) => a + f.amount, 0);
          const tot = document.querySelector('#cbpTable tr.total').querySelectorAll('td')[4].textContent;
          out.push({ k, freq, blanks: lastYear.filter((x) => x.trim() === '—').length, last: lastYear[lastYear.length - 1], prev: lastYear[0], tot, want: fmt.usd(profit) });
        }
      }
      return out;
    });
    for (const x of r) {
      check(x.blanks === 0, `${slug} ${x.k} every ${x.freq} mo: ${x.blanks} blank periods in the final year`);
      check(x.tot === x.want, `${slug} ${x.k} every ${x.freq} mo: total ${x.tot} vs profit ${x.want}`);
    }
    check(r.length > 0, `${slug}: checked something`);
  }
  // follows the inputs: a 7-year hold with a refinance in year 3 (Siena, Sponsor). The year-3 months each get their
  // operating share and the refinance proceeds land in the month they're paid; the last year is not blank either.
  await p.goto(PAGE + '#siena-villas'); await p.waitForTimeout(500);
  const rf = await p.evaluate(() => {
    inputs.deal.hold_years = 7; inputs.deal.refi.enabled = true; inputs.deal.refi.year = 3; recompute();
    cbpCase = 'sponsor'; cbpView = 'periods'; cbpFreq = 1; cbpParty = 'v'; renderCashByPerson();
    const C = results.cases.sponsor, rows = [...document.querySelectorAll('#cbpTable tbody tr:not(.total)')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));
    const dist = rows.slice(1).map((x) => x[3]), num = (x) => x.trim() === '—' ? 0 : +x.replace(/[$,]/g, '');
    const y3 = dist.slice(24, 36).map(num), y7 = dist.slice(72, 84).map(num);
    const me = cbpParties().find((x) => x.id === 'v'), profit = me.flows.reduce((a, f) => a + f.amount, 0);
    return { years: C.waterfall.cash.length, refi: C.operations.refi_proceeds[2], y3blank: y3.filter((v) => v === 0).length, y3lump: y3[11] > 5 * y3[0], y7blank: y7.filter((v) => v === 0).length,
      tot: document.querySelector('#cbpTable tr.total').querySelectorAll('td')[4].textContent, want: fmt.usd(profit) };
  });
  check(rf.years === 7 && rf.refi > 0 && rf.y3blank === 0 && rf.y3lump && rf.y7blank === 0 && rf.tot === rf.want, `7-year hold with a year-3 refinance: ${JSON.stringify(rf)}`);
  errs.forEach((e) => fail.push('page error: ' + e));
  await b.close();
  if (fail.length) { console.log('FAIL\n' + fail.join('\n')); process.exitCode = 1; } else console.log('ok');
})();
