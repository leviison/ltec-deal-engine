// Page test (run by tests/test_web.py): other investors in the deal directly, outside our vehicle, show in the flow
// diagram (issue #39): a box per investor off the deal with their cash, the deal box totals every LP check, a click
// opens that investor's field, removing them removes the box, and the term sheet lists them. Both deals.
const __P = require('path');
const PAGE = 'file://' + __P.resolve(__dirname, '../../dist/index.html');
const { chromium } = require('playwright');
const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); };

(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1400 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  for (const slug of ['siena-villas', 'the-bend']) {
    await p.goto(PAGE + '#' + slug); await p.waitForTimeout(500);
    const r = await p.evaluate(() => {
      inputs.direct_investors = [{ name: 'L1', check: 650000 }, { name: 'L2', check: 100000 }]; renderDirectInputs(); recompute();
      const K = detailCase, cs = results.cases[K], txt = (sel) => { const g = document.querySelector(sel); return g ? g.textContent : null; };
      const boxes = [...document.querySelectorAll('#whFlow g.node')].map((g) => g.textContent);
      const l1 = boxes.find((t) => t.includes('L1direct')), deal = boxes[0];
      const want1 = `${fmt.usdk(650000)} in → ${fmt.usdk(sum(cs.direct_investors[0].payments))} back`;
      const all = inputs.investor.check + 750000, back = sum(cs.investor.payments) + sum(cs.direct_investors.map((d) => sum(d.payments)));
      return { l1, want1, deal, wantDeal: `${fmt.usdk(all)} in → ${fmt.usdk(back)} back`, n: boxes.filter((t) => /direct LP/.test(t)).length };
    });
    check(r.n === 2 && r.l1 && r.l1.includes(r.want1) && r.deal.includes(r.wantDeal) && /3 LPs/.test(r.deal), `${slug}: ${JSON.stringify(r)}`);
    // click opens the investor's field
    await p.evaluate(() => document.querySelector('#whFlow [data-open^="sec-direct"]').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await p.waitForTimeout(400);
    const f = await p.evaluate(() => { const a = document.activeElement; return a && a.closest('[data-path]') ? a.closest('[data-path]').dataset.path : null; });
    check(f === 'direct_investors.0.name', `${slug}: click opens ${f}`);
    // the term sheet lists them
    const ts = await p.evaluate(() => { const cases = Object.fromEntries(CASES.map((k) => [k, results.cases[k].label]));
      return termsSummary(inputs, results.warehouse, cases, META.slug).sections[0].rows.filter((x) => /^Alongside/.test(x.term)).map((x) => x.term); });
    check(ts.join() === 'Alongside: L1,Alongside: L2', `${slug}: term sheet ${ts}`);
    // removing them removes the boxes
    const n0 = await p.evaluate(() => { inputs.direct_investors = []; renderDirectInputs(); recompute();
      return !document.querySelector('#whFlow g.node[data-open^="sec-direct"]') && !/ LPs/.test(document.querySelector('#whFlow g.node').textContent); });
    check(n0, `${slug}: boxes removed`);
  }
  errs.forEach((e) => fail.push('page error: ' + e));
  await b.close();
  if (fail.length) { console.log('FAIL\n' + fail.join('\n')); process.exitCode = 1; } else console.log('ok');
})();
