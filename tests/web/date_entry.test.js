// Page test (run by tests/test_web.py): typing a date by keyboard (issue #41). A year typed digit by digit passes
// through 0002, 0020, 0202 on its way to 2027; the field must not take those (and re-render under the cursor), so the
// whole date can be typed. Checked on a re-rendering field (a loan's maturity), a plain one (a sale date) and the
// statement's "Balances as of"; a date outside the deal gets a warning that links to the field.
const __P = require('path');
const PAGE = 'file://' + __P.resolve(__dirname, '../../dist/index.html');
const { chromium } = require('playwright');
const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); };

(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1600 }, locale: 'en-US' });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(PAGE + '#siena-villas'); await p.waitForTimeout(500);
  await p.evaluate(() => [...document.querySelectorAll('#sec-variants [data-v]')].find((x) => /bridges Thaxter/.test(x.textContent)).click());
  await p.waitForTimeout(300);
  const typeDate = async (sel, keys) => {
    await p.evaluate((sel) => { const el = document.querySelector(sel); el.closest('details, .grp') ; el.scrollIntoView(); }, sel);
    await p.evaluate((sel) => openRail('sec-ltec', 'wh-ltec', null), sel);
    await p.waitForTimeout(150);
    await p.focus(sel);
    for (const k of keys) { await p.keyboard.type(k); await p.waitForTimeout(40); }
    await p.waitForTimeout(250);
  };
  // the loan's maturity (its card re-renders on every change)
  const MAT = '[data-path="warehouse.manager_loans.0.maturity"] input';
  await typeDate(MAT, ['0', '1', '0', '7', '2', '0', '2', '8']);
  let r = await p.evaluate(() => ({ v: inputs.warehouse.manager_loans[0].maturity, due: results.warehouse.base.manager_loans[0].due_date }));
  check(r.v === '2028-01-07' && r.due === '2028-01-07', `maturity typed: ${JSON.stringify(r)}`);
  // a sale date (no re-render)
  await p.evaluate(() => goToInput('warehouse.selldown.tranches.0.date')); await p.waitForTimeout(300);
  const SALE = '[data-path="warehouse.selldown.tranches.0.date"] input';
  await p.focus(SALE);
  for (const k of ['0', '6', '3', '0', '2', '0', '2', '7']) { await p.keyboard.type(k); await p.waitForTimeout(40); }
  await p.waitForTimeout(250);
  r = await p.evaluate(() => ({ v: inputs.warehouse.selldown.tranches[0].date, t: results.warehouse.base.tranches[0].date }));
  check(r.v === '2027-06-30' && r.t === '2027-06-30', `sale date typed: ${JSON.stringify(r)}`);
  // nothing implausible was ever stored on the way
  // balances as of
  await p.evaluate(() => { cbpParty = 'p1'; cbpView = 'statement'; renderCashByPerson(); document.getElementById('cbpAsOf').scrollIntoView(); });
  await p.focus('#cbpAsOf');
  for (const k of ['1', '2', '3', '1', '2', '0', '2', '7']) { await p.keyboard.type(k); await p.waitForTimeout(40); }
  await p.waitForTimeout(250);
  r = await p.evaluate(() => ({ v: cbpAsOf, box: document.getElementById('cbpBalances').textContent }));
  check(r.v === '2027-12-31' && /by 2027-12-31/.test(r.box), `as-of typed: ${JSON.stringify(r)}`);
  // a date before close is flagged, with a link to the field
  r = await p.evaluate(() => { inputs.warehouse.manager_loans[0].maturity = '2002-01-07'; renderWarehouseInputs(); recompute();
    const it = vehicleIssueItems(inputs, results.warehouse[PRIMARY].summary).find((x) => /maturity/.test(x.msg));
    return it || null; });
  check(r && r.path === 'warehouse.manager_loans.0.maturity' && /before close/.test(r.msg), `warning: ${JSON.stringify(r)}`);
  errs.forEach((e) => fail.push('page error: ' + e));
  await b.close();
  if (fail.length) { console.log('FAIL\n' + fail.join('\n')); process.exitCode = 1; } else console.log('ok');
})();
