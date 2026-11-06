// Page test (run by tests/test_web.py). Fails on any page error or thrown error.
const __P = require('path');
const PAGE = 'file://' + __P.resolve(__dirname, '../../dist/index.html');
const OUT = __P.join(__dirname, '.out'); require('fs').mkdirSync(OUT, { recursive: true });
const { chromium } = require('playwright');
const scen = require('./.fixtures/scen.json');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1200 } });
  const errs = []; p.on('pageerror', e => errs.push(e.stack.split('\n').slice(0, 3).join(' | ')));
  await p.addInitScript((scen) => {
    window.__saved = []; window.__log = [];
    let docs = [{ id: 'old1', data: () => ({ name: 'Aggressive ask (saved before v4)', deal: 'the-bend', inputs: scen.inputs, created_at: '2026-11-05T17:00:00Z' }) }];
    let listener = null;
    const db = { collection: () => ({ orderBy: () => ({ onSnapshot: (cb) => { listener = cb; setTimeout(() => cb({ docs }), 30); return () => {}; } }),
      add: async (d) => { const id = 'n' + (window.__saved.length + 1); window.__saved.push(d); docs = docs.concat([{ id, data: () => d }]); setTimeout(() => listener && listener({ docs }), 10); return { id }; }, doc: () => ({ delete: async () => {} }) }) };
    const fake = async (input, opts) => {
      const t = Object.fromEntries(opts.tools.map((x) => [x.name, x]));
      const call = async (n, a) => { try { const r = await t[n].execute(a, { signal: new AbortController().signal }); window.__log.push([n, r]); return r; } catch (e) { window.__log.push([n, 'ERROR ' + e.message]); return null; } };
      const li = await call('list_inputs', { deal: 'the-bend', case: 'base' });
      const yrs = await call('get_case_years', { deal: 'the-bend', case: 'base', changes: { 'deal.below_noi_income.factor': 0.5 } });
      const w = await call('run_what_if', { deal: 'the-bend', case: 'all', changes: { 'deal.below_noi_income.delay_years': 2 }, label: 'TIF delayed 2 years' });
      const text = 'Rows for the 50% cut computed.';
      opts.onText({ text, delta: text }); return { text, truncated: false };
    };
    fake.limits = async () => ({ maxPromptBytes: 262144, tools: { maxCount: 20 } });
    window.claude = { use: async (n) => (n === 'sample' ? fake : n === 'db' ? db : null) };
  }, scen);
  const cards = () => p.evaluate(() => [...document.querySelectorAll('#caseCards .case')].map(c => c.querySelector('.name').innerText.split(' ')[0] + ' ' + c.querySelector('.irr').innerText.split('\n')[0].replace('LP IRR', '')).join(' | '));
  await p.goto(PAGE + '#the-bend'); await p.waitForTimeout(800);
  console.log('variants:', await p.evaluate(() => [...document.querySelectorAll('#sec-variants [data-v]')].map(b => b.querySelector('b').innerText).join(' / ')));
  await p.evaluate(() => [...document.querySelectorAll('#sec-variants [data-v]')].find(b => b.innerText.startsWith('TIF rebate cut')).click()); await p.waitForTimeout(300);
  console.log('cut 50% variant:', await cards(), '| field:', await p.evaluate(() => document.getElementById('f-deal-below_noi_income-factor').value));
  await p.evaluate(() => [...document.querySelectorAll('#sec-variants [data-v]')].find(b => b.innerText.startsWith('No TIF value at sale')).click()); await p.waitForTimeout(300);
  console.log('no TIF at sale variant:', await cards());
  await p.evaluate(() => [...document.querySelectorAll('#sec-variants [data-v]')].find(b => b.innerText.startsWith('Defaults')).click()); await p.waitForTimeout(300);
  await p.fill('#askInput', 'rebuild the cash flow table with the TIF numbers'); await p.click('#askSend'); await p.waitForTimeout(1500);
  const log = await p.evaluate(() => window.__log.map(([n, r]) => typeof r === 'string' ? [n, r] : n === 'get_case_years' ? [n, r.below_noi_income, r.our_check_cash] : n === 'run_what_if' ? [n, r.results.map(x => [x.before.case, x.after.our_irr])] : n === 'list_inputs' ? [n, Object.keys(r.deal).filter(k => k.includes('below_noi'))] : [n]));
  log.forEach(l => console.log(JSON.stringify(l)));
  console.log('what-if rows:', await p.evaluate(() => [...document.querySelectorAll('.ask-wi')].map(r => r.innerText.replace(/\n/g, ' | '))));
  await p.evaluate(() => [...document.querySelectorAll('.ask-wi button')].find(b => b.textContent === 'Save and compare').click()); await p.waitForTimeout(700);
  console.log('after save+compare: hash', await p.evaluate(() => location.hash), '| columns:', await p.evaluate(() => [...document.querySelectorAll('#cmpReturns thead th.deal')].map(th => [...th.querySelectorAll('select')].map(s => s.options[s.selectedIndex].text).join(' / ')).join('  ||  ')));
  console.log('base row:', await p.evaluate(() => { const rows = [...document.querySelectorAll('#cmpReturns tbody tr')]; const i = rows.findIndex(r => r.innerText.startsWith('Our Adjusted Base')); return rows[i + 1].innerText.replace(/\t/g, ' | '); }));
  // old scenario (pre-v4) as a column and opened
  await p.click('#cmpAddCol'); await p.waitForTimeout(200);
  const n = await p.evaluate(() => document.querySelectorAll('#cmpReturns .cmp-sel[data-what="src"]').length);
  await p.selectOption(`#cmpReturns .cmp-sel[data-col="${n - 1}"][data-what="slug"]`, 'the-bend'); await p.waitForTimeout(150);
  await p.selectOption(`#cmpReturns .cmp-sel[data-col="${n - 1}"][data-what="src"]`, 'old1'); await p.waitForTimeout(300);
  console.log('old scenario column downside:', await p.evaluate((n) => { const rows = [...document.querySelectorAll('#cmpReturns tbody tr')]; const i = rows.findIndex(r => r.innerText.startsWith('Our Downside')); return rows[i + 1].cells[n].innerText; }, n));
  await p.click(`#cmpReturns [data-open="${n - 1}"]`); await p.waitForTimeout(400);
  console.log('old scenario opened:', await cards());
  await p.screenshot({ path: __P.join(OUT, 'tif.png') });
  console.log('errors:', errs); if (errs.length) process.exitCode = 1; await b.close();
})();
