// Page test (run by tests/test_web.py): the summary of terms (issue #25). On Siena variant F (Levi's loan to Thaxter,
// interest only) with the manager renamed: "Export terms" saves a Word file whose text has every section, the loan's
// terms in words with their sources, each case's outcome equal to the engine's, the loan schedule, the terms still
// to confirm, the new name and none of the old one; Ask's get_terms_summary returns the same; The Bend (direct) works.
const __P = require('path');
const PAGE = 'file://' + __P.resolve(__dirname, '../../dist/index.html');
const OUT = __P.join(__dirname, '.out'); require('fs').mkdirSync(OUT, { recursive: true });
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const LIB = path.resolve(__dirname, '../../node_modules');
const JSZip = require(path.join(LIB, 'jszip'));
const map = { 'docx@8.5.0/build/index.umd.js': 'docx/build/index.umd.js' };
const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); };
const docText = async (file) => {
  const z = await JSZip.loadAsync(fs.readFileSync(file));
  const xml = await z.file('word/document.xml').async('string');
  return xml.replace(/<w:p[ >]/g, '\n$&').replace(/<w:tab\/>/g, ' ').replace(/<\/w:tc>/g, ' | ').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
};

(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1200 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.route('https://cdn.jsdelivr.net/npm/**', (route) => {
    const k = route.request().url().split('/npm/')[1];
    route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(LIB, map[k])) });
  });
  const saved = [];
  await p.exposeFunction('__saveFile', (name, b64) => { fs.writeFileSync(path.join(OUT, 'terms_' + name), Buffer.from(b64, 'base64')); saved.push('terms_' + name); return true; });
  await p.addInitScript(() => {
    const downloads = { save: async ({ filename, data }) => { const buf = new Uint8Array(await new Response(data).arrayBuffer()); let s = ''; for (const c of buf) s += String.fromCharCode(c); await window.__saveFile(filename, btoa(s)); return { status: 'saved' }; } };
    window.claude = { use: async (n) => (n === 'downloads' ? downloads : null) };
  });
  await p.goto(PAGE + '#siena-villas'); await p.waitForTimeout(800);
  await p.evaluate(() => [...document.querySelectorAll('#sec-variants [data-v]')].find((x) => /interest only, balloon/.test(x.textContent)).click()); await p.waitForTimeout(250);
  await p.evaluate(() => { const el = document.querySelector('[data-path="warehouse.names.manager"] input'); el.value = 'Acme Partners'; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.waitForTimeout(300);
  const want = await p.evaluate(() => ({
    profit: Object.fromEntries(CASES.map((k) => [results.cases[k].label, fmt.usd(results.warehouse[k].summary.people[1].profit)])),
    interest: fmt.usd(results.warehouse[PRIMARY].manager_loans[0].interest),
    words: loanTermsText(inputs.warehouse.manager_loans[0], 'Thaxter', 'Acme Partners'),
    sched: results.warehouse[PRIMARY].loan_schedules[0].length,
  }));
  const srcs = await p.evaluate(() => Object.values(DEFAULTS.sources).filter((x) => typeof x === 'string').concat(DEFAULTS.meta.name));
  check(await p.evaluate(() => !document.getElementById('expTerms').hidden && document.getElementById('expTerms').offsetParent !== null), 'Export terms button visible');
  await p.click('#expTerms'); await p.waitForTimeout(2500);
  const f = saved.find((x) => x.endsWith('.docx'));
  check(!!f && /siena-villas-terms-\d{4}-\d{2}-\d{2}\.docx$/.test(f), `docx saved: ${saved.join(', ')} toast ${await p.evaluate(() => document.getElementById('expToast').textContent)}`);
  if (f) {
    const t = await docText(path.join(OUT, f));
    fs.writeFileSync(path.join(OUT, 'terms_siena.txt'), t);
    for (const h of ['Summary of terms', '1. The investment', '2. The people', '3. The vehicle: SV26', '4. Acme Partners and its partners', 'Partner loan 1: Levi to Thaxter', 'Projected outcome by case', 'Exhibit A. Partner loan 1: projected schedule', 'Terms still to confirm', 'not a legal document'])
      check(t.includes(h), `docx should include "${h}"`);
    check(t.includes('Interest only, balloon at exit: '), 'loan method named');
    check(t.includes(want.words), `loan terms in words: ${want.words}`);
    check(/Variant “Acme Partners F · Levi's loan, interest only, balloon at exit”/.test(t), 'version line names the variant with the new name');
    for (const [lab, v] of Object.entries(want.profit)) check(t.includes(v), `${lab} profit ${v} in the outcome table`);
    check(t.includes(want.interest), `loan interest ${want.interest}`);
    check(/Assumption: off\. Acme Partners's operating agreement|Assumption: off\. LTEC's operating agreement/.test(t) && /Assumption \|/.test(t), 'sources and the still-to-confirm list carry the deal file\'s assumptions');
    check(/Changed from the deal file/.test(t) && /Set in this version/.test(t) && /Partner loan 1: Lender, Borrower, Lends/.test(t), 'changes from the deal file are marked and grouped');
    // names: the manager's new name everywhere the engine writes it (deal-file sources may quote the documents)
    let stripped = t; srcs.forEach((x) => { stripped = stripped.split(x).join(' '); });
    const ours = stripped.split('\n');
    check(!ours.some((l) => /\bLTEC\b(?! Deal Engine| Holdings)/.test(l)), `old manager name left: ${ours.filter((l) => /\bLTEC\b(?! Deal Engine| Holdings)/.test(l)).slice(0, 3).join(' / ')}`);
  }
  // Ask returns the same summary
  const ask = await p.evaluate(() => {
    const r = ASK_TOOLS.find((x) => x.name === 'get_terms_summary').execute({ deal: 'siena-villas', changes: { 'warehouse.manager_loans': inputs.warehouse.manager_loans, 'warehouse.names.manager': 'Acme Partners' } });
    return { heads: r.sections.map((x) => x.heading), loan: r.sections[3].loans[0].rows.find((x) => x.term === 'In short').value, open: r.still_to_confirm.length, sched: r.loan_schedules[0].rows.length };
  });
  check(ask.heads.length === 4 && ask.loan.startsWith(want.words) && ask.open > 0 && ask.sched === want.sched, `Ask: ${JSON.stringify(ask)}`);
  // The Bend: held directly, no loans
  saved.length = 0;
  await p.goto(PAGE + '#the-bend'); await p.waitForTimeout(800);
  await p.click('#expTerms'); await p.waitForTimeout(2500);
  const g = saved.find((x) => x.endsWith('.docx'));
  if (!g) fail.push('The Bend docx not saved');
  else { const t = await docText(path.join(OUT, g)); check(/3\. Holding directly/.test(t) && /None: LTEC writes the check itself/.test(t) && !/Exhibit A/.test(t), 'The Bend direct summary'); }
  // compare view hides it
  await p.click('#viewSeg [data-view="compare"]'); await p.waitForTimeout(300);
  check(await p.evaluate(() => document.getElementById('expTerms').offsetParent === null), 'hidden in Compare');
  errs.forEach((e) => fail.push('page error: ' + e));
  await b.close();
  if (fail.length) { console.log('FAIL\n' + fail.join('\n')); process.exitCode = 1; } else console.log('ok');
})();
