// Page test (run by tests/test_web.py): the live page says which engine release and commit built it, and shows no
// preview banner (preview builds do; see tests/test_release.py).
const __P = require('path');
const PAGE = 'file://' + __P.resolve(__dirname, '../../dist/index.html');
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(PAGE + '#the-bend'); await p.waitForTimeout(500);
  const r = await p.evaluate(() => ({ note: document.getElementById('buildNote').textContent, bar: document.getElementById('previewBar').hidden, v: BUILD.engine }));
  if (!/^LTEC Deal Engine v\d+\.\d+\.\d+ · build \w+/.test(r.note)) errs.push('build stamp: ' + r.note);
  if (!r.bar) errs.push('the live page must not show the preview banner');
  await b.close();
  if (errs.length) { console.log('FAIL\n' + errs.join('\n')); process.exitCode = 1; } else console.log('ok', r.note);
})();
