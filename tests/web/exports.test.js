// Page test (run by tests/test_web.py). Fails on any page error or thrown error.
const __P = require('path');
const PAGE = 'file://' + __P.resolve(__dirname, '../../dist/index.html');
const OUT = __P.join(__dirname, '.out'); require('fs').mkdirSync(OUT, { recursive: true });
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const scen = require('./.fixtures/scen.json');
const LIB = path.resolve(__dirname, '../../node_modules');
const map = { 'exceljs@4.4.0/dist/exceljs.min.js': 'exceljs/dist/exceljs.min.js', 'xlsx@0.18.5/dist/xlsx.full.min.js': 'xlsx/dist/xlsx.full.min.js', 'jspdf@2.5.1/dist/jspdf.umd.min.js': 'jspdf/dist/jspdf.umd.min.js',
              'jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js': 'jspdf-autotable/dist/jspdf.plugin.autotable.min.js' };
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; p.on('pageerror', e => errs.push(e.stack.split('\n').slice(0, 3).join(' | ')));
  await p.route('https://cdn.jsdelivr.net/npm/**', (route) => {
    const k = route.request().url().split('/npm/')[1];
    route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(LIB, map[k])) });
  });
  const saved = [];
  await p.exposeFunction('__saveFile', (name, b64) => { fs.writeFileSync(path.join(OUT, 'out_' + name), Buffer.from(b64, 'base64')); saved.push('out_' + name); return true; });
  await p.addInitScript((scen) => {
    const docs = [{ id: 'sc1', data: () => ({ name: 'Aggressive ask', deal: 'the-bend', inputs: scen.inputs, created_at: '2026-11-05T17:00:00Z', changes: 2 }) }];
    const db = { collection: () => ({ orderBy: () => ({ onSnapshot: (cb) => { setTimeout(() => cb({ docs }), 50); return () => {}; } }) }) };
    const downloads = { save: async ({ filename, data }) => { const buf = new Uint8Array(await new Response(data).arrayBuffer()); let s = ''; for (const c of buf) s += String.fromCharCode(c); await window.__saveFile(filename.replace(/-\d{4}-\d\d-\d\d/, ''), btoa(s)); return { status: 'saved' }; } };
    window.claude = { use: async (n) => (n === 'db' ? db : n === 'downloads' ? downloads : null) };
  }, scen);
  await p.goto(PAGE + '#the-bend'); await p.waitForTimeout(800);
  await p.evaluate(() => { try { localStorage.clear(); } catch (_) {} });
  console.log('export buttons visible:', await p.evaluate(() => !document.getElementById('exportBtns').hidden));
  // turn on the side letter so it shows in the exports
  await p.evaluate(() => { const c = document.getElementById('f-investor-side_letter-enabled'); c.click(); }); await p.waitForTimeout(300);
  await p.click('#expPdf'); await p.waitForTimeout(2500);
  await p.click('#expXlsx'); await p.waitForTimeout(2500);
  console.log('toast:', await p.evaluate(() => document.getElementById('expToast').innerText));
  await p.click('#viewSeg [data-view="compare"]'); await p.waitForTimeout(400);
  await p.click('#cmpAddCol'); await p.waitForTimeout(200);
  const n = await p.evaluate(() => document.querySelectorAll('#cmpReturns .cmp-sel[data-what="src"]').length);
  await p.selectOption(`#cmpReturns .cmp-sel[data-col="${n - 1}"][data-what="slug"]`, 'the-bend'); await p.waitForTimeout(150);
  await p.selectOption(`#cmpReturns .cmp-sel[data-col="${n - 1}"][data-what="src"]`, 'sc1'); await p.waitForTimeout(300);
  await p.screenshot({ path: __P.join(OUT, 'cols2.png') });
  await p.click('#expPdf'); await p.waitForTimeout(2500);
  await p.click('#expXlsx'); await p.waitForTimeout(2500);
  console.log('toast:', await p.evaluate(() => document.getElementById('expToast').innerText));
  // Siena with an LTEC structure (variant B): both exports carry the vehicle section, each person by case
  await p.goto(PAGE + '#siena-villas'); await p.waitForTimeout(600);
  await p.evaluate(() => { const v = [...document.querySelectorAll('#sec-variants [data-v]')].find((x) => /LTEC B/.test(x.textContent)); v.click(); }); await p.waitForTimeout(300);
  saved.length = 0;
  await p.click('#expPdf'); await p.waitForTimeout(2500);
  await p.click('#expXlsx'); await p.waitForTimeout(2500);
  const pdf = saved.find((x) => x.endsWith('.pdf')), xl = saved.find((x) => x.endsWith('.xlsx'));
  if (!pdf || !xl) errs.push('Siena exports not saved: ' + saved.join(', '));
  else {
    const raw = fs.readFileSync(path.join(OUT, pdf)).toString('latin1');
    if (!/Our vehicle/.test(raw) || !/Thaxter \W+ from LTEC/.test(raw) || !/back first/.test(raw)) errs.push('PDF lacks the vehicle section');
    const ExcelJS = require(path.join(LIB, 'exceljs'));
    const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(path.join(OUT, xl));
    const txt = []; wb.getWorksheet(1).eachRow((r) => txt.push(r.values.filter((v) => typeof v === 'string').join(' ')));
    if (!txt.some((t) => /Our vehicle/.test(t)) || !txt.some((t) => /Thaxter · from LTEC/.test(t))) errs.push('xlsx Summary lacks the vehicle section');
  }
  console.log('errors:', errs); if (errs.length) process.exitCode = 1; await b.close();
})();
