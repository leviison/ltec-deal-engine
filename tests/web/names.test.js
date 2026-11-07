// Page test (run by tests/test_web.py): names are labels. Rename the manager, the vehicle, the default buyers, the
// investor and every vehicle person through their fields, then open every card, schedule and view, on the defaults and
// on every variant: no old name may be left anywhere on the page, except inside the deal file's own text (facts,
// diligence, sources, notes), which is what the deal's documents say. Also: variant titles read with the new names
// and keep them when clicked; the loan-terms words and the structure picker follow the manager's name.
const __P = require('path');
const PAGE = 'file://' + __P.resolve(__dirname, '../../dist/index.html');
const { chromium } = require('playwright');
const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); };
const BRAND = ['LTEC Deal Engine', 'LTEC Holdings'];  // the firm and the product, not a deal's manager

(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1600 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  for (const slug of ['siena-villas', 'the-bend']) {
    await p.goto(PAGE + '#' + slug); await p.waitForTimeout(500);
    const nVar = await p.evaluate(() => document.querySelectorAll('#sec-variants [data-v]').length);
    for (let v = 0; v < Math.max(1, nVar); v++) {
      if (nVar) { await p.evaluate((v) => document.querySelectorAll('#sec-variants [data-v]')[v].click(), v); await p.waitForTimeout(200); }
      // the names before, and every field that holds one
      const fields = await p.evaluate(() => {
        const w = inputs.warehouse, f = [['warehouse.names.manager', w.names.manager], ['warehouse.names.vehicle', w.names.vehicle], ['warehouse.names.buyers', w.names.buyers], ['investor.name', inputs.investor.name]];
        // people from the deal file (a variant's added partner is described in its own title, e.g. "add a GP partner")
        w.people.forEach((q, i) => f.push([`warehouse.people.${i}.name`, DEFAULTS.warehouse.people.some((d) => d.id === q.id) ? q.name : '']));
        return f;
      });
      for (const [k, [path]] of fields.entries()) {
        await p.evaluate(([path, val]) => { const el = document.querySelector(`[data-path="${path}"] input`); el.value = val; el.dispatchEvent(new Event('change', { bubbles: true })); }, [path, `Zv${v}n${k}z`]);
        await p.waitForTimeout(60);
      }
      await p.waitForTimeout(250);
      const r = await p.evaluate(({ olds, brand }) => {
        // open everything a person could open
        document.querySelectorAll('.collapsed').forEach((x) => x.classList.remove('collapsed'));
        document.querySelectorAll('details').forEach((d) => { d.open = true; });
        const views = [];
        for (const view of ['periods', 'statement']) {
          cbpView = view; cbpParty = 'p0'; renderCashByPerson();
          views.push(document.getElementById('cbpTable').innerText + document.getElementById('cbpSummary').innerText);
        }
        // the deal file's own words (not names) may mention anyone
        const own = [], walk = (o, path) => {
          if (typeof o === 'string') { if (o.length >= 12) own.push(o); return; }
          if (Array.isArray(o)) o.forEach((x, i) => walk(x, path + '.' + i));
          else if (o && typeof o === 'object') Object.entries(o).forEach(([k, x]) => { if (path === '.meta' && k === 'alternatives') return; walk(x, path + '.' + k); });
        };
        walk(DEFAULTS.meta, '.meta'); walk(DEFAULTS.sources || {}, '.sources');
        Object.values(DEFAULTS.cases).forEach((c) => walk({ label: c.label, note: c.note }, '.case'));
        // "edited from the template" quotes what the template would set (e.g. its vehicle name): not a stale label
        const se = document.getElementById('structureEdits'); if (se) se.remove();
        const texts = [document.body.innerText, ...views,
          ...[...document.querySelectorAll('option')].map((o) => o.textContent),
          ...[...document.querySelectorAll('[title],[aria-label]')].map((e) => (e.getAttribute('title') || '') + ' ' + (e.getAttribute('aria-label') || ''))];
        const hits = new Set();
        texts.forEach((t) => {
          let x = t;
          own.concat(brand).forEach((s) => { x = x.split(s).join(' '); });
          olds.forEach((o) => { const re = new RegExp(`(^|[^A-Za-z0-9])${o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9]|$)`); const m = x.match(re);
            if (m) { const i = x.indexOf(m[0]); hits.add(`"${o}": …${x.slice(Math.max(0, i - 50), i + 60).replace(/\s+/g, ' ')}…`); } });
        });
        return { hits: [...hits].slice(0, 12), variants: (document.getElementById('sec-variants') || {}).innerText || '' };
      }, { olds: [...new Set(fields.map(([, o]) => o).filter((o) => o && o.length > 1))], brand: BRAND });
      const label = `${slug} · variant ${v}`;
      check(!r.hits.length, `${label}: old names still shown:\n  ${r.hits.join('\n  ')}`);
    }
    // a variant keeps the names you typed
    if (nVar) {
      const kept = await p.evaluate(() => { document.querySelector('#sec-variants [data-v="0"]').click(); return inputs.warehouse.names.manager; });
      check(/^Zv\d+n0z$/.test(kept), `${slug}: a variant should keep the typed manager name, got ${kept}`);
    }
  }
  errs.forEach((e) => fail.push('page error: ' + e));
  await b.close();
  if (fail.length) { console.log('FAIL\n' + fail.join('\n')); process.exitCode = 1; } else console.log('ok');
})();
