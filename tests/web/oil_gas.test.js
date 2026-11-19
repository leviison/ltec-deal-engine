// Page test (run by tests/test_web.py): the oil & gas module on the dashboard (#46).
// - a module deal opens its own view (the real-estate layout hides), with cards, chart, years, checks, sponsor table
// - every number matches Python (tests/web/.fixtures/og_results.json); every catalog field is rendered for every case
// - edits: a field change recomputes, marks the field, survives switching deals and back; a derived case stores only
//   what it changes; Reset clears; goToInput jumps to a case field
// - saved scenarios save and load through the shared database; Compare shows the deal with the common rows;
//   Ask's tools dispatch to the module's versions, and a real-estate-only tool says so
const __P = require('path');
const PAGE = 'file://' + __P.resolve(__dirname, '../../dist/index.html');
const { chromium } = require('playwright');
const WANT = require('./.fixtures/og_results.json');
const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); };

(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1600 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.stack.split('\n').slice(0, 3).join(' <- ')));
  await p.addInitScript(() => {
    const store = new Map(); let listeners = [], n = 0;
    const emit = () => { const docs = [...store].map(([id, d]) => ({ id, data: () => JSON.parse(JSON.stringify(d)) })); listeners.forEach((cb) => cb({ docs })); };
    window.__store = store;
    const db = { collection: () => ({
      orderBy: () => ({ onSnapshot: (cb) => { listeners.push(cb); setTimeout(emit, 20); return () => {}; } }),
      add: async (d) => { const id = 'og' + (++n); store.set(id, JSON.parse(JSON.stringify(d))); setTimeout(emit, 10); return { id }; },
      doc: (id) => ({ set: async (d) => { store.set(id, d); setTimeout(emit, 10); }, update: async (d) => { store.set(id, Object.assign(store.get(id), d)); setTimeout(emit, 10); },
                      delete: async () => { store.delete(id); setTimeout(emit, 10); } }) }) };
    window.claude = { use: async (nm) => (nm === 'db' ? db : null) };
  });
  for (const slug of Object.keys(WANT)) {
    await p.goto(PAGE + '#' + slug); await p.waitForTimeout(700);
    const r = await p.evaluate((slug) => {
      const st = MODULE_VIEWS.oil_gas.state();
      const cards = [...document.querySelectorAll('#ogCards .case')].map((c) => ({ k: c.dataset.case, mult: c.querySelector('.irr').firstChild.textContent }));
      const groups = MODULE_DATA.oil_gas.inputs.groups;
      const nCase = groups.filter((g) => g.scope === 'case').reduce((a, g) => a + g.fields.length, 0), nDeal = groups.filter((g) => g.scope === 'deal').reduce((a, g) => a + g.fields.length, 0);
      return { shown: SHOWN, reHidden: getComputedStyle(document.getElementById('reLayout')).display === 'none', modVisible: !document.getElementById('modView').hidden,
        cards, keys: Object.keys(st.res.cases), fields: document.querySelectorAll('#modView .rail [data-path]').length, want: nCase + nDeal,
        checks: Object.fromEntries(Object.entries(st.res.quick_checks).map(([k, q]) => [k, q.checks.map((c) => c.status)])),
        common: Object.fromEntries(Object.entries(st.res.cases).map(([k, c]) => [k, c.common])),
        years: document.querySelectorAll('#ogYears tbody tr').length, table: document.querySelectorAll('#ogTable tbody tr').length,
        eyebrow: document.getElementById('eyebrow').textContent, name: document.getElementById('dealName').textContent, title: DEALS[slug].meta.name };
    }, slug);
    check(r.shown === slug && r.reHidden && r.modVisible && r.name === r.title, `${slug}: view ${JSON.stringify([r.shown, r.reHidden, r.modVisible, r.name])}`);
    check(r.fields === r.want, `${slug}: ${r.fields} fields rendered vs ${r.want} in the catalog`);
    check(r.years > 0 && r.table > 0 && r.eyebrow.includes('Oil'), `${slug}: panels ${JSON.stringify([r.years, r.table, r.eyebrow])}`);
    for (const [k, w] of Object.entries(WANT[slug])) {
      if (k === '_checks') continue;
      for (const [m, v] of Object.entries(w)) {
        const g = r.common[k][m];
        check(v === null ? g === null : Math.abs(g - v) < 1e-6 * Math.max(1, Math.abs(v)), `${slug}/${k}.${m}: page ${g} vs python ${v}`);
      }
      const card = r.cards.find((c) => c.k === k);
      check(card && card.mult.startsWith(w.multiple.toFixed(2)), `${slug}/${k}: card ${card && card.mult} vs ${w.multiple}`);
      check(JSON.stringify(r.checks[k]) === JSON.stringify(WANT[slug]._checks[k]), `${slug}/${k}: checks ${r.checks[k]} vs ${WANT[slug]._checks[k]}`);
    }
    // every case's fields render (derived cases show inherited values)
    for (const k of r.keys) {
      const n = await p.evaluate((k) => { document.querySelector(`#ogCaseTabs [data-ogk="${k}"]`).click(); return document.querySelectorAll('#ogCaseFields [data-path]').length; }, k);
      check(n > 10, `${slug}/${k}: ${n} case fields`);
    }
  }

  const slug = 'lapetco-oxy-2';
  await p.goto(PAGE + '#' + slug); await p.waitForTimeout(500);
  const mult = (k) => p.evaluate((k) => MODULE_VIEWS.oil_gas.state().res.cases[k].common.multiple, k);
  const m0 = await mult('base'), d0 = await mult('downside');
  // edit Base's rate: recomputes, marks the field, Downside (derived from Base, own rate) unchanged
  await p.evaluate(() => { document.querySelector('#ogCaseTabs [data-ogk="base"]').click(); const i = document.getElementById('og-cases-base-production-rate'); i.value = '450'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.waitForTimeout(200);
  const m1 = await mult('base'), d1 = await mult('downside');
  check(m1 < m0 - 0.05 && Math.abs(d1 - d0) < 1e-9, `edit base rate: base ${m0}->${m1}, downside ${d0}->${d1}`);
  check(await p.evaluate(() => document.querySelector('[data-path="cases.base.production.rate"]').classList.contains('is-changed') && isEdited('lapetco-oxy-2')), 'edited field marked and deal edited');
  // a derived case stores only what it changes
  await p.evaluate(() => { document.querySelector('#ogCaseTabs [data-ogk="downside"]').click(); const i = document.getElementById('og-cases-downside-wti-long-term'); i.value = '75'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.waitForTimeout(200);
  const dc = await p.evaluate(() => MODULE_VIEWS.oil_gas.state().inp.cases.downside);
  check(dc.wti.long_term === 75 && dc.wti.history === undefined && dc.oil_share === undefined, `derived case stores only its change: ${JSON.stringify(dc.wti)}`);
  // switch to a real-estate deal and back: edits kept, real-estate page intact
  await p.selectOption('#dealPick', 'the-bend'); await p.waitForTimeout(500);
  const re = await p.evaluate(() => [SHOWN, getComputedStyle(document.getElementById('reLayout')).display, document.getElementById('dealName').textContent, document.querySelectorAll('#caseCards .case').length, document.getElementById('eyebrow').textContent]);
  check(re[0] === 'the-bend' && re[1] !== 'none' && re[2] === 'The Bend' && re[3] > 0 && !re[4].includes('Oil'), `back to real estate: ${JSON.stringify(re)}`);
  await p.selectOption('#dealPick', slug); await p.waitForTimeout(500);
  check(Math.abs((await mult('base')) - m1) < 1e-9, 'edits kept across a deal switch');
  // goToInput from anywhere jumps to the case field
  await p.evaluate(() => goToInput('cases.stress.tax.year1_deductible', 'lapetco-oxy-2')); await p.waitForTimeout(200);
  check(await p.evaluate(() => MODULE_VIEWS.oil_gas.state().editCase === 'stress' && document.activeElement.id === 'og-cases-stress-tax-year1-deductible'), 'goToInput focuses the stress tax field');
  // saved scenarios: save, reset, load
  await p.fill('#ogSaveName', 'Base at 450'); await p.click('#ogSave'); await p.waitForTimeout(300);
  const saved = await p.evaluate(() => { const d = [...window.__store.values()][0]; return d && { deal: d.deal, diff: Object.keys(JSON.parse(d.diff_json)), summary: d.summary }; });
  check(saved && saved.deal === slug && saved.diff.includes('cases.base.production.rate') && saved.diff.includes('cases.downside.wti.long_term') && /multiple|×/.test(saved.summary), `saved: ${JSON.stringify(saved)}`);
  await p.click('#ogReset'); await p.waitForTimeout(200);
  check(Math.abs((await mult('base')) - m0) < 1e-9 && !(await p.evaluate(() => isEdited('lapetco-oxy-2'))), 'reset to defaults');
  await p.evaluate(() => document.querySelector('#ogSaved [data-load]').click()); await p.waitForTimeout(200);
  check(Math.abs((await mult('base')) - m1) < 1e-9, 'loaded the saved scenario');
  // Compare: the deal in a column with the common rows; real-estate context reads "—"
  await p.goto(PAGE + '#compare'); await p.waitForTimeout(600);
  const cmp = await p.evaluate(() => {
    const cols = [...document.querySelectorAll('#cmpReturns thead th.deal select[data-what="slug"]')].map((s) => s.value);
    const rowOf = (lbl) => [...document.querySelectorAll('#cmpReturns tbody tr')].find((tr) => tr.querySelector('td.lbl') && tr.querySelector('td.lbl').textContent === lbl);
    const ctx = (lbl) => { const tr = [...document.querySelectorAll('#cmpContext tbody tr')].find((t) => t.querySelector('td.lbl').textContent === lbl); return tr ? [...tr.querySelectorAll('td.n')].map((td) => td.textContent) : null; };
    return { cols, at: rowOf('After-tax IRR') ? [...rowOf('After-tax IRR').querySelectorAll('td.n')].map((td) => td.textContent) : null, units: ctx('Units'), wells: ctx('Wells') };
  });
  const i = cmp.cols.indexOf(slug);
  check(i >= 0 && cmp.at && cmp.at[i] !== '—' && cmp.units[i] === '—' && cmp.wells[i] === '5', `compare: ${JSON.stringify(cmp)}`);
  // Ask tools dispatch to the module
  const ask = await p.evaluate(() => {
    const t = Object.fromEntries(ASK_TOOLS.map((x) => [x.name, x]));
    const deal = t.get_deal.execute({ deal: 'lapetco-oxy-2' });
    const wi = t.run_what_if.execute({ deal: 'lapetco-oxy-2', case: 'base', changes: { 'cases.base.wti.long_term': 50 } });
    const li = t.list_inputs.execute({ deal: 'lapetco-oxy-2', case: 'base' });
    const sv = t.solve_for.execute({ deal: 'lapetco-oxy-2', case: 'base', path: 'cases.base.wti.long_term', metric: 'multiple', target: 1, low: 20, high: 120 });
    let veh = null; try { t.get_vehicle.execute({ deal: 'lapetco-oxy-2', case: 'base' }); } catch (e) { veh = e.message; }
    let bad = null; try { t.run_what_if.execute({ deal: 'lapetco-oxy-2', case: 'base', changes: { 'cases.base.exit_cap': 0.06 } }); } catch (e) { bad = e.message; }
    const cd = t.compare_deals.execute({});
    const src = t.get_sources.execute({ deal: 'lapetco-oxy-2', prefix: 'deal.venture' });
    return { cases: deal.cases.length, wi: [wi.results[0].before.multiple, wi.results[0].after.multiple], li: Object.keys(li.cases[0].inputs).length, sv, veh, bad,
      cd: cd.find((x) => x.deal === 'lapetco-oxy-2'), re: cd.find((x) => x.deal === 'the-bend'), src: Object.keys(src) };
  });
  check(ask.cases === 5 && ask.wi[1] < ask.wi[0] && ask.li > 10, `ask basics ${JSON.stringify([ask.cases, ask.wi, ask.li])}`);
  check(ask.sv.found && Math.abs(ask.sv.achieved - 1) < 1e-3, `solve_for breakeven WTI ${JSON.stringify(ask.sv)}`);
  check(ask.veh && /real-estate/.test(ask.veh) && ask.bad && /No case input/.test(ask.bad), `ask errors ${ask.veh} | ${ask.bad}`);
  check(ask.cd && ask.cd.asset_class && ask.cd.cases.base.after_tax_irr != null && ask.re && ask.re.cases.sponsor.lp_irr != null, 'compare_deals covers both modules');
  check(ask.src.includes('deal.venture_wi'), 'get_sources reads the module deal');
  // a what-if opens on the module view
  await p.evaluate(() => openWhatIf({ slug: 'lapetco-oxy-2', changes: { 'cases.base.production.di': 1.0 }, scenario: null }));
  await p.waitForTimeout(300);
  check(await p.evaluate(() => SHOWN === 'lapetco-oxy-2' && MODULE_VIEWS.oil_gas.state().inp.cases.base.production.di === 1.0), 'openWhatIf loads the change on the module view');
  check(!errs.length, 'page errors: ' + errs.join(' | '));
  await b.close();
  if (fail.length) { console.error(fail.join('\n')); process.exit(1); }
  console.log('oil_gas page test passed');
})();
