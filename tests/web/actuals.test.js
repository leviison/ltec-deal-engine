// Page test (run by tests/test_web.py): actual payments (issue #22), with the shared database and the viewer stubbed.
// An editor records payments in each scope; the panel compares them with the projection as of "today"; a wrong entry
// is voided (it stays, struck through, with the reason) and stops counting; a viewer who can't edit sees no controls;
// a loan set to decide from recorded payments forfeits when the record shows it missed, and settles when paid.
const __P = require('path');
const PAGE = 'file://' + __P.resolve(__dirname, '../../dist/index.html');
const OUT = __P.join(__dirname, '.out'); require('fs').mkdirSync(OUT, { recursive: true });
const { chromium } = require('playwright');
const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); };

const STUB = (canEdit) => `(() => {
  window.__today = '2027-04-01';
  const store = {}, subs = {};
  const snap = (name) => ({ docs: Object.entries(store[name] || {}).map(([id, d]) => ({ id, data: () => JSON.parse(JSON.stringify(d)) })) });
  const fire = (name) => (subs[name] || []).forEach((cb) => setTimeout(() => cb(snap(name)), 0));
  let n = 0;
  const coll = (name) => ({
    orderBy() { return this; }, where() { return this; }, limit() { return this; },
    onSnapshot(cb) { (subs[name] = subs[name] || []).push(cb); setTimeout(() => cb(snap(name)), 0); return () => {}; },
    async add(d) { const id = 'id' + (++n); (store[name] = store[name] || {})[id] = d; fire(name); return { id }; },
    doc(id) { return { async set(d) { (store[name] = store[name] || {})[id] = d; fire(name); }, async update(p) { Object.assign(store[name][id], p); fire(name); }, async delete() { delete store[name][id]; fire(name); } }; },
  });
  const db = { collection: coll };
  const user = { canEdit: async () => ${canEdit}, id: async () => 'u1', isOwner: async () => ${canEdit} };
  window.__store = store;
  window.claude = { use: async (x) => (x === 'db' ? db : x === 'user' ? user : null) };
})();`;

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 1600 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(STUB(true));
  await p.goto(PAGE + '#siena-villas'); await p.waitForTimeout(600);
  // LTEC K's loan, set to decide from the record
  await p.evaluate(() => { const K = DEALS['siena-villas'].meta.alternatives.find((a) => /misses Mar 15/.test(a.name));
    inputs = E.applyVariant(DEFAULTS, K, STRUCTURES); inputs.warehouse.manager_loans[0].at_maturity = 'auto'; renderAllFields(); recompute(); });
  check(await p.evaluate(() => !document.getElementById('actAdd').hidden), 'editor sees + Record a payment');
  // nothing recorded by Mar 15, 2027 (today is Apr 1): missed, the share passes
  let r = await p.evaluate(() => ({ f: results.warehouse.base.manager_forfeitures.length, s: results.warehouse.base.manager_loans[0].settled }));
  check(r.f === 1 && r.s === 'forfeited', `auto with nothing recorded: ${JSON.stringify(r)}`);
  // record through the form: Thaxter repays Levi $184,000 on Mar 10
  const fill = async (vals) => {
    await p.click('#actAdd'); await p.waitForTimeout(100);
    if (vals.scope) { await p.selectOption('#actScope', vals.scope); await p.waitForTimeout(100); }
    await p.selectOption('#actKind', vals.kind);
    if (vals.date) await p.fill('#actDate', vals.date);
    if (vals.year) await p.fill('#actYear', String(vals.year));
    await p.fill('#actAmount', String(vals.amount));
    if (vals.from) await p.selectOption('#actFrom', vals.from);
    if (vals.to) await p.selectOption('#actTo', vals.to);
    if (vals.note) await p.fill('#actNoteIn', vals.note);
    await p.click('#actForm button[type=submit]'); await p.waitForTimeout(300);
  };
  await fill({ kind: 'loan_payment', date: '2027-03-10', amount: 184000, from: 'thaxter', to: 'levi', note: 'wire 3/10' });
  r = await p.evaluate(() => ({ n: actLive().length, f: results.warehouse.base.manager_forfeitures.length, s: results.warehouse.base.manager_loans[0].settled,
    words: document.getElementById('actVariance').textContent }));
  check(r.n === 1 && r.f === 0 && r.s === 'paid_at_maturity' && /paid by 2027-03-15 per the record/.test(r.words), `auto, paid per the record: ${JSON.stringify(r)}`);
  // the loan's balance per the record vs the projection; Thaxter's and Levi's partner cash
  r = await p.evaluate(() => { const v = actVariance('base'); const f = (id) => v.people.find((x) => x.id === id && x.kind === 'loan_payment'); return { loan: v.loans[0], th: f('thaxter'), lv: f('levi'), cap: v.people.find((x) => x.id === 'levi' && x.kind === 'contribution') }; });
  check(r.loan.rec.assumed_advance && r.loan.rec.balance < 1000 && r.th.recorded === -184000 && r.lv.recorded === 184000 && Math.abs(r.th.projected + r.th.recorded) > 0 && r.cap.recorded === null, `variance: ${JSON.stringify(r)}`);
  // vehicle and deal records
  await fill({ scope: 'vehicle', kind: 'unit_sale', date: '2027-03-31', amount: 716800, note: 'closing statement' });
  await fill({ scope: 'deal', kind: 'noi', year: 1, amount: 900000, note: 'Redstone Q4 report' });
  r = await p.evaluate(() => { const v = actVariance('base'); return { sale: v.vehicle[2], noi: v.deal[0].years[0], txt: document.getElementById('actVariance').textContent }; });
  check(r.sale.recorded === 716800 && Math.abs(r.sale.projected - 716800) < 1 && r.noi.recorded === 900000 && /Year 1: case · actual/.test(r.txt), `vehicle and deal: ${JSON.stringify(r).slice(0, 300)}`);
  r = await p.evaluate(() => { const g = ASK_TOOLS.find((x) => x.name === 'get_actuals').execute({}); return { n: g.recorded.length, loan: g.loans[0], noi: g.deal_by_year[0] }; });
  check(r.n === 3 && r.loan.outcome && /paid by/.test(r.loan.outcome) && r.noi.years[0].actual === 900000, `get_actuals: ${JSON.stringify(r)}`);
  await (await p.$('#actPanel')).screenshot({ path: __P.join(OUT, 'actuals.png') });
  // void the loan payment: it stays, struck through, and the loan goes back to missed
  const id = await p.evaluate(() => actLive().find((a) => a.kind === 'loan_payment').id);
  await p.click(`[data-act-void="${id}"]`); await p.waitForTimeout(100);
  await p.click(`[data-act-void-ok="${id}"]`); await p.waitForTimeout(100);
  check(await p.evaluate(() => !!document.getElementById('actVoidWhy')), 'void needs a reason');
  await p.fill('#actVoidWhy', 'wire was returned'); await p.click(`[data-act-void-ok="${id}"]`); await p.waitForTimeout(300);
  r = await p.evaluate((id) => ({ kept: !!window.__store.actuals[id], v: window.__store.actuals[id].void, row: !!document.querySelector('#actList tr.void'), f: results.warehouse.base.manager_forfeitures.length }), id);
  check(r.kept && r.v && r.v.reason === 'wire was returned' && r.row && r.f === 1, `void: ${JSON.stringify(r)}`);
  // a viewer who can't edit: no controls
  const p2 = await b.newPage(); await p2.addInitScript(STUB(false)); await p2.goto(PAGE + '#siena-villas'); await p2.waitForTimeout(600);
  check(await p2.evaluate(() => document.getElementById('actAdd').hidden && !document.querySelector('[data-act-void]')), 'viewer sees no controls');
  errs.forEach((e) => fail.push('page error: ' + e));
  await b.close();
  if (fail.length) { console.log('FAIL\n' + fail.join('\n')); process.exitCode = 1; } else console.log('ok');
})();
