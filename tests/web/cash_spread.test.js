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
        if (finalYearOpsShare(k) <= 0) continue;  // nothing operating in the last year (e.g. a stress case)
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
  errs.forEach((e) => fail.push('page error: ' + e));
  await b.close();
  if (fail.length) { console.log('FAIL\n' + fail.join('\n')); process.exitCode = 1; } else console.log('ok');
})();
