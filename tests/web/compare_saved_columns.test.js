// Page test (run by tests/test_web.py). Fails on any page error or thrown error.
const __P = require('path');
const PAGE = 'file://' + __P.resolve(__dirname, '../../dist/index.html');
const OUT = __P.join(__dirname, '.out'); require('fs').mkdirSync(OUT, { recursive: true });
const { chromium } = require('playwright');
const scen = require('./.fixtures/scen.json');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; p.on('pageerror', e => errs.push(e.stack.split('\n').slice(0, 3).join(' | ')));
  await p.addInitScript((scen) => {
    const docs = [{ id: 'sc1', data: () => ({ name: 'Aggressive ask', deal: 'the-bend', inputs: scen.inputs, created_at: '2026-11-05T17:00:00Z', changes: 2 }) }];
    const db = { collection: () => ({ orderBy: () => ({ onSnapshot: (cb) => { setTimeout(() => cb({ docs }), 50); return () => {}; } }), add: async () => ({ id: 'x' }), doc: () => ({ delete: async () => {} }) }) };
    window.claude = { use: async (n) => (n === 'db' ? db : null) };
  }, scen);
  await p.goto(PAGE + '#compare'); await p.waitForTimeout(800);
  await p.evaluate(() => { try { localStorage.clear(); } catch (_) {} });
  await p.click('#cmpAddCol'); await p.waitForTimeout(200);
  const n = await p.evaluate(() => document.querySelectorAll('#cmpReturns .cmp-sel[data-what="src"]').length);
  await p.selectOption(`#cmpReturns .cmp-sel[data-col="${n - 1}"][data-what="slug"]`, 'the-bend'); await p.waitForTimeout(200);
  await p.selectOption(`#cmpReturns .cmp-sel[data-col="${n - 1}"][data-what="src"]`, 'sc1'); await p.waitForTimeout(300);
  console.log(await p.evaluate(() => { const rows = [...document.querySelectorAll('#cmpReturns tbody tr')].map(r => [...r.cells].map(c => c.innerText).join(' | ')); return rows.slice(0, 14).join('\n'); }));
  console.log('legend:', await p.evaluate(() => document.getElementById('cmpLegend').innerText.replace(/\n/g, ' / ')));
  await p.screenshot({ path: __P.join(OUT, 'cols.png') });
  await p.click(`#cmpReturns [data-open="${n - 1}"]`); await p.waitForTimeout(400);
  console.log('opened:', await p.evaluate(() => [document.getElementById('dealName').innerText, document.getElementById('scenarioChip').innerText,
    [...document.querySelectorAll('#caseCards .case')].map(c => c.querySelector('.name').innerText + ' ' + c.querySelector('.irr').innerText.split('\n')[0]).join(' | ')]));
  console.log('errors:', errs); if (errs.length) process.exitCode = 1; await b.close();
})();
