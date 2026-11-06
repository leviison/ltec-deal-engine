// Page test (run by tests/test_web.py). Fails on any page error or thrown error.
const __P = require('path');
const PAGE = 'file://' + __P.resolve(__dirname, '../../dist/index.html');
const OUT = __P.join(__dirname, '.out'); require('fs').mkdirSync(OUT, { recursive: true });
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1300 } });
  const errs = []; p.on('pageerror', e => errs.push(e.stack.split('\n').slice(0, 3).join(' | ')));
  await p.addInitScript(() => {
    window.__saved = []; window.__log = [];
    const docs = [];
    const db = { collection: () => ({ orderBy: () => ({ onSnapshot: (cb) => { setTimeout(() => cb({ docs }), 30); return () => {}; } }), add: async (d) => { window.__saved.push(d); return { id: 'new' + window.__saved.length }; }, doc: () => ({ delete: async () => {} }) }) };
    const fake = async (input, opts) => {
      const t = Object.fromEntries(opts.tools.map((x) => [x.name, x]));
      const call = async (n, a) => { try { const r = await t[n].execute(a, { signal: new AbortController().signal }); window.__log.push([n, r]); return r; } catch (e) { window.__log.push([n, 'ERROR ' + e.message]); return null; } };
      const li = await call('list_inputs', { deal: 'the-bend', case: 'base' });
      const tif = await call('run_what_if', { deal: 'the-bend', case: 'base', changes: { 'deal.below_noi_income.sale_value': 'none' }, label: 'no TIF (deal level)' });
      const lab = await call('run_what_if', { deal: 'the-bend', case: 'custom', changes: { 'cases.custom.built_from': 'base' }, label: 'label only' });
      const rebuilt = await call('run_what_if', { deal: 'the-bend', case: 'custom', changes: {}, custom_from: 'base', label: 'Custom = Adjusted Base' });
      const be = await call('solve_for', { deal: 'the-bend', case: 'custom', path: 'cases.custom.exit_cap', metric: 'lp_irr', target: 0, low: 0.05, high: 0.1, custom_from: 'base' });
      const sw = await call('sweep', { deal: 'the-bend', case: 'base', metric: 'lp_irr', path: 'cases.base.exit_cap', values: [0.055, 0.0585, 0.065, 0.075], path2: 'cases.base.rent_factor', values2: [0.95, 0.99, 1.0] });
      const rows = await call('run_what_if', { deal: 'the-bend', case: 'custom', changes: { 'cases.custom.rents': '4000000, 4100000, 4200000, 4300000, 4400000, 4500000, 4600000, 4700000' }, label: 'rents as text list' });
      const pr = await call('propose_scenario', { deal: 'the-bend', name: 'Bend break-even (Adjusted Base ops)', description: 'Custom rebuilt from our Adjusted Base, with the exit cap set where LP IRR is 0%.', changes: { 'cases.custom.exit_cap': be && be.value }, custom_from: 'base' });
      const text = `Break-even exit cap on our Adjusted Base operations: **${(be.value * 100).toFixed(2)}%**.`;
      opts.onText({ text, delta: text });
      return { text, truncated: false };
    };
    fake.limits = async () => ({ maxPromptBytes: 262144, tools: { maxCount: 20 } });
    window.claude = { use: async (n) => (n === 'sample' ? fake : n === 'db' ? db : null) };
  });
  await p.goto(PAGE + '#the-bend'); await p.waitForTimeout(800);
  await p.fill('#askInput', 'can you build/adjust the custom cases on each of them to show where the break-even would be?');
  await p.click('#askSend'); await p.waitForTimeout(2500);
  const log = await p.evaluate(() => window.__log.map(([n, r]) => {
    if (typeof r === 'string') return [n, r];
    if (n === 'list_inputs') return [n, Object.keys(r.cases[0].inputs).filter(k => /factor|exit_cap|deal_overrides/.test(k)).join(', '), r.cases[0].how_to_change.slice(0, 60)];
    if (n === 'run_what_if') return [n, r.results.map(x => [x.before.case, x.before.lp_irr, x.after.lp_irr]), r.warnings];
    if (n === 'solve_for') return [n, r.value, r.achieved];
    if (n === 'sweep') return [n, r.table.map(row => row.results.map(c => c.value))];
    if (n === 'propose_scenario') return [n, r.lp_irr_by_case.map(x => [x.case, x.after])];
    return [n];
  }));
  log.forEach((l) => console.log(JSON.stringify(l)));
  console.log('cards:', await p.evaluate(() => [...document.querySelectorAll('.ask-prop')].map(c => c.innerText.replace(/\n+/g, ' | ')).join('\n')));
  await p.screenshot({ path: __P.join(OUT, 'ask_prop.png'), fullPage: false });
  await p.click('.ask-prop .btn.primary'); await p.waitForTimeout(400);
  console.log('saved:', await p.evaluate(() => window.__saved.map(d => [d.name, d.deal, d.source, d.summary, d.note.slice(0, 40), JSON.parse(d.diff_json)['cases.custom.built_from']])));
  await p.click('.ask-prop .btn:not(.primary)'); await p.waitForTimeout(400);
  console.log('opened:', await p.evaluate(() => [...document.querySelectorAll('#caseCards .case')].map(c => c.querySelector('.name').innerText + ' ' + c.querySelector('.irr').innerText.split('\n')[0]).join(' | ')));
  console.log('errors:', errs); if (errs.length) process.exitCode = 1; await b.close();
})();
