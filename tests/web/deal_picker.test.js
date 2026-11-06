// Page test (run by tests/test_web.py). Fails on any page error or thrown error.
const __P = require('path');
const PAGE = 'file://' + __P.resolve(__dirname, '../../dist/index.html');
const OUT = __P.join(__dirname, '.out'); require('fs').mkdirSync(OUT, { recursive: true });
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/TUNNEL|ERR_/.test(m.text())) errs.push('CONSOLE ' + m.text()); });
  const cards = () => p.evaluate(() => ({ deal: document.getElementById('dealName').innerText, title: document.title,
    pick: document.getElementById('dealPick').value, cards: [...document.querySelectorAll('#caseCards .case')].map(c => c.querySelector('.name').innerText + ' ' + c.querySelector('.irr').innerText.split('\n')[0]) }));
  await p.goto(PAGE); await p.waitForTimeout(700);
  console.log('open:', JSON.stringify(await cards()));
  await p.screenshot({ path: __P.join(OUT, 'all_top.png') });
  await p.selectOption('#dealPick', 'siena-villas'); await p.waitForTimeout(500);
  console.log('picked siena:', JSON.stringify(await cards()), 'hash', await p.evaluate(() => location.hash));
  await p.screenshot({ path: __P.join(OUT, 'all_siena.png') });
  await p.goto(PAGE + '#the-bend'); await p.waitForTimeout(500);
  console.log('hash bend:', JSON.stringify(await cards()));
  // edit the Downside case: open Operating cases tab Downside, change exit cap
  await p.evaluate(() => { document.querySelector('#caseTabs [data-k="downside"]').click(); });
  await p.waitForTimeout(200);
  const before = await p.evaluate(() => document.querySelectorAll('#caseCards .case')[2].querySelector('.irr').innerText.split('\n')[0]);
  await p.fill('#f-cases-downside-exit_cap', '6');
  await p.dispatchEvent('#f-cases-downside-exit_cap', 'input'); await p.waitForTimeout(300);
  const after = await p.evaluate(() => document.querySelectorAll('#caseCards .case')[2].querySelector('.irr').innerText.split('\n')[0]);
  console.log('downside exit cap 6.25 -> 6.00:', before, '->', after);
  const fields = await p.evaluate(() => [...document.querySelectorAll('#caseFields [data-path]')].filter(e => !e.hidden).map(e => e.dataset.path.split('.').slice(2).join('.')));
  console.log('downside fields:', fields.join(', '));
  await p.evaluate(() => document.getElementById('sec-cases').scrollIntoView());
  await p.screenshot({ path: __P.join(OUT, 'all_downside_edit.png') });
  console.log('errors:', errs); if (errs.length) process.exitCode = 1;
  await b.close();
})();
