// Page test (run by tests/test_web.py). Fails on any page error or thrown error.
const __P = require('path');
const PAGE = 'file://' + __P.resolve(__dirname, '../../dist/index.html');
const OUT = __P.join(__dirname, '.out'); require('fs').mkdirSync(OUT, { recursive: true });
const { chromium } = require('playwright');
const t1 = require('./.fixtures/test1.json');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1200 } });
  const errs = []; p.on('pageerror', e => errs.push(e.stack.split('\n').slice(0, 3).join(' | ')));
  await p.addInitScript((t1) => {
    window.__saved = []; window.__log = []; window.__ctx = '';
    let docs = [{ id: 'nkao', data: () => ({ name: 'test 1 _ hold all capital', deal: 'siena-villas', inputs: t1.inputs, created_at: '2026-11-06T13:27:52Z', summary: 'Base 7.3% · Custom 7.4% · Levi +$117k' }) }];
    const db = { collection: () => ({ orderBy: () => ({ onSnapshot: (cb) => { setTimeout(() => cb({ docs }), 30); return () => {}; } }), add: async (d) => { window.__saved.push(d); return { id: 'x' }; }, doc: () => ({ delete: async () => {} }) }) };
    const fake = async (input, opts) => {
      window.__ctx = input[0].content;
      const t = Object.fromEntries(opts.tools.map((x) => [x.name, x]));
      const call = async (n, a) => { try { const r = await t[n].execute(a, { signal: new AbortController().signal }); window.__log.push([n, r]); return r; } catch (e) { window.__log.push([n, 'ERROR ' + e.message]); return null; } };
      await call('list_scenarios', {});
      await call('get_vehicle', { deal: 'siena-villas', case: 'base', scenario: 'test 1' });
      await call('get_deal', { deal: 'siena-villas', scenario: 'test 1' });
      await call('run_what_if', { deal: 'siena-villas', scenario: 'test 1', case: 'base', changes: { 'cases.base.exit_cap': 0.06 }, label: 'test 1 at a 6% exit cap' });
      await call('get_vehicle', { deal: 'siena-villas', case: 'base', scenario: 'nope' });
      const text = 'Done.'; opts.onText({ text, delta: text }); return { text, truncated: false };
    };
    fake.limits = async () => ({ maxPromptBytes: 262144, tools: { maxCount: 20 } });
    window.claude = { use: async (n) => (n === 'sample' ? fake : n === 'db' ? db : null) };
  }, t1);
  await p.goto(PAGE + '#siena-villas'); await p.waitForTimeout(800);
  console.log('suggested:', await p.evaluate(() => [...document.querySelectorAll('#askChips button')].map(b => b.textContent).pop()));
  await p.fill('#askInput', 'what does test 1 do for Levi?'); await p.click('#askSend'); await p.waitForTimeout(2500);
  console.log('context line:', await p.evaluate(() => window.__ctx.split('\n').find(l => l.startsWith('Saved scenarios'))));
  const log = await p.evaluate(() => window.__log.map(([n, r]) => typeof r === 'string' ? [n, r] :
    n === 'list_scenarios' ? [n, r.map(x => [x.name, x.changed_inputs.length, x.lp_irr_by_case.base, x.vehicle_profit_base, x.vehicle_issues])] :
    n === 'get_vehicle' ? [n, r.vehicle, r.people.map(x => [x.name, x.cash_in, x.profit, x.irr]), r.buyers.map(x => [x.name, x.cost, x.irr]), r.manager_fees_total, r.reconciles, r.issues] :
    n === 'get_deal' ? [n, r.using, r.cases.map(c => [c.case, c.lp_irr])] :
    n === 'run_what_if' ? [n, r.results.map(x => [x.before.lp_irr, x.after.lp_irr])] : [n]));
  log.forEach(l => console.log(JSON.stringify(l)));
  console.log('what-if row:', await p.evaluate(() => document.querySelector('.ask-wi .ask-wi-name').innerText));
  await p.evaluate(() => [...document.querySelectorAll('.ask-wi button')].find(b => b.textContent === 'Open on dashboard').click()); await p.waitForTimeout(400);
  console.log('opened base card:', await p.evaluate(() => [...document.querySelectorAll('#caseCards .case')].map(c => c.querySelector('.name').innerText + ' ' + c.querySelector('.irr').innerText.split('\n')[0]).join(' | ')));
  await p.evaluate(() => [...document.querySelectorAll('.ask-wi button')].find(b => b.textContent === 'Save as scenario').click()); await p.waitForTimeout(400);
  console.log('saved note:', await p.evaluate(() => window.__saved.map(d => [d.name, d.note, Object.keys(JSON.parse(d.diff_json)).join(', ')])));
  console.log('errors:', errs); if (errs.length) process.exitCode = 1; await b.close();
})();
