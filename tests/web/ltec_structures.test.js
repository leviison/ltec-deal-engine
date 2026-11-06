// Page test (run by tests/test_web.py): LTEC's own split between its partners (issue #9).
// Clicks each Siena variant (LTEC A-E), checks every person's profit and cash from LTEC in every case match the
// Python engine to the cent, and that the "LTEC between its partners" panel shows and edits without errors.
const __P = require('path');
const PAGE = 'file://' + __P.resolve(__dirname, '../../dist/index.html');
const OUT = __P.join(__dirname, '.out'); require('fs').mkdirSync(OUT, { recursive: true });
const { chromium } = require('playwright');
const EXP = require('./.fixtures/siena_variants.json');

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); };

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 1600 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(PAGE + '#siena-villas'); await p.waitForTimeout(600);
  check(EXP.length >= 5, `expected the LTEC sample variants in Siena's deal file, found ${EXP.length}`);
  for (const v of EXP) {
    const ok = await p.evaluate((name) => { const btn = [...document.querySelectorAll('#sec-variants [data-v]')].find((x) => x.textContent.includes(name)); if (!btn) return false; btn.click(); return true; }, v.name);
    check(ok, `no variant button for ${v.name}`); if (!ok) continue;
    await p.waitForTimeout(250);
    const got = await p.evaluate(() => Object.fromEntries(Object.entries(results.warehouse).map(([k, r]) => [k, r.summary.people.map((x, i) => ({ name: r.people[i].name, profit: x.profit, from_manager: x.from_manager }))])));
    for (const [k, ps] of Object.entries(v.cases)) {
      ps.forEach((e, i) => {
        const g = (got[k] || [])[i];
        check(g && Math.abs(g.profit - e.profit) < 0.01 && Math.abs(g.from_manager - e.from_manager) < 0.01,
          `${v.name} · ${k} · ${e.name}: page ${g ? Math.round(g.profit) + ' / ' + Math.round(g.from_manager) : 'missing'} vs engine ${Math.round(e.profit)} / ${Math.round(e.from_manager)}`);
      });
    }
    const ui = await p.evaluate(() => ({ table: document.getElementById('whTable').textContent, sums: (document.getElementById('ltecSums') || {}).textContent || '' }));
    check(/From LTEC/.test(ui.table), `${v.name}: results table should show "From LTEC"`);
    if (/lends Thaxter/.test(v.name)) check(/interest/.test(ui.sums) && /lends Thaxter/.test(ui.table), `${v.name}: loan not shown (${ui.sums})`);
    if (/leaves/.test(v.name)) check(/leaves 2028-11-05/.test(ui.table) && /keeps 50%/.test(ui.sums), `${v.name}: departure not shown (${ui.sums})`);
  }
  // edit through the panel: open the group, add a step to the LTEC waterfall, add a partner loan and a vesting
  await p.evaluate(() => { const g = document.querySelector('[data-grp="wh-ltec"]'); if (g && g.classList.contains('collapsed')) g.querySelector('.grp-head').click(); });
  await p.evaluate(() => document.getElementById('addTier').click()); await p.waitForTimeout(150);
  await p.evaluate(() => document.getElementById('addMLoan').click()); await p.waitForTimeout(150);
  await p.evaluate(() => document.getElementById('addVest').click()); await p.waitForTimeout(150);
  await p.evaluate(() => { const i = document.querySelector('[data-path="warehouse.manager_vesting.1.leaves"] input'); i.value = '2029-05-01'; i.dispatchEvent(new Event('change', { bubbles: true })); i.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.waitForTimeout(200);
  const st = await p.evaluate(() => ({ tiers: inputs.warehouse.manager_waterfall.tiers.length, loans: inputs.warehouse.manager_loans.length, vest: inputs.warehouse.manager_vesting.length,
    leaves: inputs.warehouse.manager_vesting[1] && inputs.warehouse.manager_vesting[1].leaves, chk: results.warehouse.base.summary.check }));
  check(st.tiers === 1 && st.loans === 1 && st.vest === 2, `panel edits: ${JSON.stringify(st)}`);
  check(st.leaves === '2029-05-01', `leave date not set: ${st.leaves}`);
  check(Math.abs(st.chk) < 0.05, `cash doesn't reconcile after panel edits: ${st.chk}`);
  // clearing a leave date is allowed (blank = stays)
  await p.evaluate(() => { const i = document.querySelector('[data-path="warehouse.manager_vesting.1.leaves"] input'); i.value = ''; i.dispatchEvent(new Event('change', { bubbles: true })); i.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.waitForTimeout(150);
  check(await p.evaluate(() => inputs.warehouse.manager_vesting[1].leaves === ''), 'clearing the leave date should keep the partner for the whole hold');
  await p.evaluate(() => document.querySelector('[data-grp="wh-ltec"]').scrollIntoView());
  await p.screenshot({ path: __P.join(OUT, 'ltec_panel.png'), clip: await p.evaluate(() => { const r = document.querySelector('[data-grp="wh-ltec"]').getBoundingClientRect(); return { x: r.x - 8, y: Math.max(0, r.y - 8), width: r.width + 16, height: Math.min(r.height + 16, 1500) }; }) });
  await p.evaluate(() => document.getElementById('whTable').scrollIntoView());
  await p.screenshot({ path: __P.join(OUT, 'ltec_table.png'), fullPage: false });
  errs.forEach((e) => fail.push('page error: ' + e));
  await b.close();
  if (fail.length) { console.log('FAIL\n' + fail.join('\n')); process.exitCode = 1; } else console.log('ok');
})();
