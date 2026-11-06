// Page test (run by tests/test_web.py). Fails on any page error or thrown error.
const __P = require('path');
const PAGE = 'file://' + __P.resolve(__dirname, '../../dist/index.html');
const OUT = __P.join(__dirname, '.out'); require('fs').mkdirSync(OUT, { recursive: true });
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 1100 } });
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR ' + e.stack.split('\n').slice(0, 3).join(' | ')));
  await p.addInitScript(() => {
    window.__toolLog = [];
    const fake = async (input, opts) => {
      const t = Object.fromEntries(opts.tools.map((x) => [x.name, x]));
      const call = async (n, a) => { const r = await t[n].execute(a, { signal: new AbortController().signal }); window.__toolLog.push([n, a, r]); return r; };
      const ctx = input[0].content;
      const deal = await call('get_deal', { deal: 'the-bend' });
      const w = await call('run_what_if', { deal: 'the-bend', case: 'downside', changes: { 'cases.downside.exit_cap': 0.06 }, label: 'Downside at a 6.0% exit cap' });
      const sv = await call('solve_for', { deal: 'the-bend', case: 'downside', path: 'cases.downside.exit_cap', metric: 'lp_irr', target: 0, low: 0.05, high: 0.09 });
      const sl = await call('run_what_if', { deal: 'the-bend', case: 'all', changes: { 'investor.side_letter.enabled': true }, label: 'Side letter on' });
      const yrs = await call('get_case_years', { deal: 'siena-villas', case: 'base' });
      const cmp = await call('compare_deals', {});
      const src = await call('get_sources', { deal: 'the-bend', prefix: 'cases.downside' });
      let bad; try { await call('run_what_if', { deal: 'the-bend', case: 'base', changes: { 'deal.nope': 1 } }); } catch (e) { bad = e.message; }
      const text = `**Short answer:** the Downside loses capital past a ${(sv.value*100).toFixed(2)}% exit cap.\n\n| Case | Before | After |\n|---|---|---|\n| Downside | ${(w.results[0].before.lp_irr*100).toFixed(1)}% | ${(w.results[0].after.lp_irr*100).toFixed(1)}% |\n\n- Side letter adds $${sl.results[0].after.side_letter_extra_dollars} in the sponsor case\n- Context mentions compare: ${ctx.includes('Compare') || ctx.includes('deal view')}\n- bad path error: ${bad}`;
      opts.onText({ text: 'partial…', delta: 'partial…' });
      opts.onText({ text, delta: text });
      return { text, truncated: false, modelTierApplied: 'default' };
    };
    fake.limits = async () => ({ maxPromptBytes: 262144, tools: { maxCount: 20 } });
    window.claude = { use: async (n) => (n === 'sample' ? fake : null) };
  });
  await p.goto(PAGE + '#the-bend'); await p.waitForTimeout(800);
  console.log('panel visible:', await p.evaluate(() => !document.getElementById('askPanel').hidden), 'chips:', await p.evaluate(() => [...document.querySelectorAll('#askChips button')].map(b => b.textContent)));
  await p.fill('#askInput', 'When does our downside lose money?');
  await p.click('#askSend'); await p.waitForTimeout(1500);
  const log = await p.evaluate(() => window.__toolLog.map(([n, a, r]) => [n, JSON.stringify(r).length, n === 'solve_for' ? r : n === 'run_what_if' ? r.results.map(x => [x.before.case, x.before.lp_irr, x.after.lp_irr, x.after.side_letter_extra_dollars]) : n === 'get_deal' ? r.cases.map(c => [c.case, c.lp_irr]) : '']));
  console.log(JSON.stringify(log, null, 0));
  console.log('answer:', await p.evaluate(() => document.querySelector('.ask-a').innerText));
  const btns = await p.evaluate(() => [...document.querySelectorAll('.ask-wi .ask-wi-name')].map(b => b.textContent));
  console.log('buttons:', btns);
  await p.screenshot({ path: __P.join(OUT, 'ask_answer.png') });
  await p.click('.ask-wi button'); await p.waitForTimeout(400);
  console.log('after open: downside card', await p.evaluate(() => [...document.querySelectorAll('#caseCards .case')].map(c => c.querySelector('.name').innerText + ' ' + c.querySelector('.irr').innerText.split('\n')[0]).join(' | ')), await p.evaluate(() => document.getElementById('changeChip').innerText));
  await p.click('#viewSeg [data-view="compare"]'); await p.waitForTimeout(300);
  console.log('panel in compare view:', await p.evaluate(() => document.getElementById('askPanel').parentElement.id), await p.evaluate(() => [...document.querySelectorAll('#askChips button')].map(b => b.textContent)[0]));
  console.log('errors:', errs); if (errs.length) process.exitCode = 1;
  await b.close();
})();
