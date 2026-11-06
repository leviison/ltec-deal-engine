// Page test (run by tests/test_web.py). Fails on any page error or thrown error.
const __P = require('path');
const PAGE = 'file://' + __P.resolve(__dirname, '../../dist/index.html');
const OUT = __P.join(__dirname, '.out'); require('fs').mkdirSync(OUT, { recursive: true });
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR ' + e.stack.split('\n').slice(0,3).join(' | ')));
  p.on('console', m => { if (m.type() === 'error' && !/TUNNEL|ERR_/.test(m.text())) errs.push('CONSOLE ' + m.text()); });
  await p.goto(PAGE + '#compare'); await p.waitForTimeout(800);
  console.log(await p.evaluate(() => document.getElementById('cmpReturns').innerText.split('\n').slice(0, 30).join('\n')));
  await p.screenshot({ path: __P.join(OUT, 'cmp_top.png'), fullPage: true });
  // open Siena from the table, edit, back to compare
  await p.click('#cmpReturns [data-open="1"]'); await p.waitForTimeout(400);
  console.log('after open:', await p.evaluate(() => [document.getElementById('dealName').innerText, location.hash, document.getElementById('compareView').hidden]));
  await p.click('#viewSeg [data-view="compare"]'); await p.waitForTimeout(300);
  console.log('back to compare:', await p.evaluate(() => [location.hash, document.getElementById('compareView').hidden, !!document.querySelector('.edited')]));
  await p.click('#cmpCaseSeg [data-role="downside"]'); await p.waitForTimeout(200);
  console.log('legend:', await p.evaluate(() => document.getElementById('cmpLegend').innerText));
  await p.setViewportSize({ width: 400, height: 900 }); await p.waitForTimeout(200);
  await p.screenshot({ path: __P.join(OUT, 'cmp_phone.png') });
  console.log('page wider than phone?', await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth));
  console.log('errors:', errs); if (errs.length) process.exitCode = 1;
  await b.close();
})();
