// Page test (run by tests/test_web.py). Fails on any page error or thrown error.
const __P = require('path');
const PAGE = 'file://' + __P.resolve(__dirname, '../../dist/index.html');
const OUT = __P.join(__dirname, '.out'); require('fs').mkdirSync(OUT, { recursive: true });
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const card = (k) => p.evaluate((k) => { const i = [...document.querySelectorAll('#caseCards .case')].findIndex(c => c.querySelector('.name').innerText === k); return document.querySelectorAll('#caseCards .case')[i].querySelector('.irr').innerText.split('\n')[0]; }, k);
  const setField = async (id, v) => { await p.fill(id, String(v)); await p.dispatchEvent(id, 'input'); await p.waitForTimeout(200); };
  await p.goto(PAGE + '#the-bend'); await p.waitForTimeout(600);
  await p.evaluate(() => document.querySelector('#caseTabs [data-k="custom"]').click()); await p.waitForTimeout(200);
  await setField('#f-cases-custom-exit_cap', 6.0);
  console.log('Bend custom after edit:', await card('Custom'));
  await p.selectOption('#dealPick', 'siena-villas'); await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelector('#caseTabs [data-k="custom"]').click()); await p.waitForTimeout(200);
  console.log('Siena custom before edit:', await card('Custom'));
  await setField('#f-cases-custom-exit_cap', 5.0);
  console.log('Siena custom after edit:', await card('Custom'), '| picker:', await p.evaluate(() => [...document.querySelectorAll('#dealPick option')].map(o => o.textContent).join(' / ')));
  await p.click('#viewSeg [data-view="compare"]'); await p.waitForTimeout(300);
  await p.evaluate(() => { const b = document.querySelector('#cmpShowSeg [data-show="custom"]'); if (b.getAttribute('aria-pressed') !== 'true') b.click(); }); await p.waitForTimeout(200);
  console.log(await p.evaluate(() => { const t = document.getElementById('cmpReturns').innerText; return t.slice(0, 120) + ' ... ' + t.slice(t.indexOf('Custom (your'), t.indexOf('Custom (your') + 260); }));
  await p.click('#cmpReturns [data-open="0"]'); await p.waitForTimeout(400);
  console.log('back in Bend, custom:', await card('Custom'), '| chip:', await p.evaluate(() => document.getElementById('changeChip').innerText));
  console.log('errors:', errs); if (errs.length) process.exitCode = 1; await b.close();
})();
