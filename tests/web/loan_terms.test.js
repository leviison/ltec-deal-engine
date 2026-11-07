// Page test (run by tests/test_web.py): partner-loan terms (issue #24). A loan with no terms shows as the Cash sweep
// preset; picking a preset fills the parts; editing a part marks it "(edited)"; a maturity settles the loan there and
// the statement's schedule says so; the terms read the same in words everywhere; Ask lists the presets.
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
  const pick = (name) => p.evaluate((name) => { const x = [...document.querySelectorAll('#sec-variants [data-v]')].find((e) => e.textContent.includes(name)); if (x) x.click(); return !!x; }, name);
  const sel = (path) => `[data-path="${path}"] select`;
  const L = 'warehouse.manager_loans.0.';
  // set a field the way a person would (the card may be collapsed): value + its change/input event
  const setF = (path, v) => p.evaluate(([path, v]) => { const el = document.querySelector(`[data-path="${path}"] select, [data-path="${path}"] input`);
    el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [path, v]);

  // Variant C has no terms: it reads as the cash sweep, unedited
  check(await pick('lends Thaxter his half'), 'variant C button'); await p.waitForTimeout(250);
  let r = await p.evaluate((s) => ({ v: document.querySelector(s).value, txt: document.querySelector(s).selectedOptions[0].textContent, note: document.querySelector('.loan-terms-note').textContent }), sel(L + 'preset'));
  check(r.v === 'cash_sweep' && !/edited/.test(r.txt) && /all of Thaxter's LTEC cash/.test(r.note), `C reads as cash sweep: ${JSON.stringify(r)}`);

  // pick a preset: the parts fill in and the results change
  const before = await p.evaluate(() => results.warehouse.base.summary.people[1].profit);
  await setF(L + 'preset', 'half_sweep'); await p.waitForTimeout(250);
  r = await p.evaluate(() => ({ ln: inputs.warehouse.manager_loans[0], profit: results.warehouse.base.summary.people[1].profit, field: !!document.querySelector('[data-path="warehouse.manager_loans.0.sweep_pct"]') }));
  check(r.ln.repayment === 'sweep' && r.ln.sweep_pct === 0.5 && r.ln.preset === 'half_sweep' && r.field && r.profit !== before, `half sweep filled: ${JSON.stringify(r)}`);
  check(r.ln.lender === 'levi' && r.ln.amount === 175000, `preset keeps who and how much: ${JSON.stringify(r.ln)}`);

  // edit a part: still named, marked edited
  await setF(L + 'sweep_pct', '30'); await p.waitForTimeout(250);
  await p.evaluate(() => renderWarehouseInputs());
  r = await p.evaluate((s) => ({ txt: document.querySelector(s).selectedOptions[0].textContent, pct: inputs.warehouse.manager_loans[0].sweep_pct }), sel(L + 'preset'));
  check(/Half sweep \(edited\)/.test(r.txt) && Math.abs(r.pct - 0.3) < 1e-9, `edited marker: ${JSON.stringify(r)}`);

  // interest only with a maturity: settled on the first cash date on or after it, and the schedule says so
  await setF(L + 'preset', 'interest_only_balloon'); await p.waitForTimeout(250);
  check(await p.evaluate(() => !!document.querySelector('[data-path="warehouse.manager_loans.0.source"]') && !document.querySelector('[data-path="warehouse.manager_loans.0.sweep_pct"]')), 'interest-only shows its parts');
  await setF(L + 'maturity', '2029-06-30'); await p.waitForTimeout(250);
  r = await p.evaluate(() => {
    const ln = results.warehouse.base.manager_loans[0];
    cbpParty = 'p1'; cbpView = 'statement'; cbpCase = 'base'; cbpFreq = 12; renderCashByPerson();
    const t = document.getElementById('cbpTable').textContent;
    return { settled: ln.settled, due: ln.due_date, sched: /Rest paid at maturity/.test(t), words: /principal at maturity \(2029-06-30\)/.test(t), rows: results.warehouse.base.loan_schedules[0].map((x) => x.date) };
  });
  check(r.settled === 'paid_at_maturity' && r.due >= '2029-06-30' && r.sched && r.words && r.rows[r.rows.length - 1] === r.due, `maturity: ${JSON.stringify(r)}`);
  await (await p.$('#cbpTable')).screenshot({ path: __P.join(OUT, 'loan_terms_statement.png') });

  // Compare row and the summary line use the same words
  r = await p.evaluate(() => ({ cmp: document.body.textContent.includes(loanTermsText(inputs.warehouse.manager_loans[0], 'Thaxter', inputs.warehouse.names.manager)) }));
  check(r.cmp, 'terms in words appear on the page');

  // Ask: presets are listed; a what-if with terms runs; the statement carries the terms
  r = await p.evaluate(() => {
    const T = (n) => ASK_TOOLS.find((x) => x.name === n);
    const li = T('list_inputs').execute({ deal: 'siena-villas' });
    const loan = Object.assign({}, inputs.warehouse.manager_loans[0], { repayment: 'none', recourse: false, maturity: '', preset: 'forgivable', on_leave: 'due' });
    const st = T('get_statement').execute({ deal: 'siena-villas', case: 'base', person: 'thaxter', changes: { 'warehouse.manager_loans': [loan] } });
    return { presets: Object.keys(li.loan_terms.presets), settled: st.partner_loans[0].settled, words: st.partner_loans[0].terms_in_words };
  });
  check(r.presets.includes('forgivable') && r.presets.includes('cash_sweep') && r.settled === 'forgiven' && /nothing repaid/.test(r.words), `Ask: ${JSON.stringify(r)}`);

  // the worked examples F and G load and show their preset
  for (const [name, key] of [['interest only, balloon', 'interest_only_balloon'], ['forgiven if Thaxter stays', 'forgivable']]) {
    check(await pick(name), `variant ${name}`); await p.waitForTimeout(250);
    const v = await p.evaluate((s) => document.querySelector(s).value, sel(L + 'preset'));
    check(v === key, `${name}: preset ${v}`);
  }
  errs.forEach((e) => fail.push('page error: ' + e));
  await b.close();
  if (fail.length) { console.log('FAIL\n' + fail.join('\n')); process.exitCode = 1; } else console.log('ok');
})();
