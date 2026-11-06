// Page test (run by tests/test_web.py): structure templates and the flow diagram (issue #12).
// Each template on each deal: picking it rebuilds the vehicle exactly as the engine's applyStructure does, the cash
// reconciles, the picker shows it, and the diagram draws the right boxes. The Bend's SPV variants load. Editing a
// templated vehicle marks the picker "edited".
const __P = require('path');
const PAGE = 'file://' + __P.resolve(__dirname, '../../dist/index.html');
const OUT = __P.join(__dirname, '.out'); require('fs').mkdirSync(OUT, { recursive: true });
const { chromium } = require('playwright');
const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); };
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1400 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  for (const slug of ['siena-villas', 'the-bend']) {
    await p.goto(PAGE + '#' + slug); await p.waitForTimeout(500);
    for (const key of ['direct', 'spv', 'spv_warehouse']) {
      await p.selectOption('#structurePick', key); await p.waitForTimeout(250);
      const r = await p.evaluate((key) => {
        const want = E.applyStructure(clone(DEFAULTS), key, STRUCTURES).warehouse, got = inputs.warehouse;
        return { same: JSON.stringify(want.people) === JSON.stringify(got.people) && want.manager_commitment === got.manager_commitment && got.structure === key,
          checks: Object.values(results.warehouse).map((x) => x.summary.check), boxes: document.querySelectorAll('#whFlow .node').length,
          pick: document.getElementById('structurePick').value, partners: inputs.warehouse.people.filter((x) => x.manager_share > 0).map((x) => x.name) };
      }, key);
      check(r.same, `${slug} ${key}: vehicle differs from applyStructure`);
      check(r.checks.every((c) => Math.abs(c) < 0.05), `${slug} ${key}: cash doesn't reconcile ${r.checks}`);
      check(r.pick === key, `${slug} ${key}: picker shows ${r.pick}`);
      const want = key === 'direct' ? 2 + r.partners.length : key === 'spv' ? 3 + 1 + r.partners.length : 3 + 2 + r.partners.length;
      check(r.boxes === want, `${slug} ${key}: ${r.boxes} boxes in the diagram, expected ${want}`);
      check(r.partners.join() === 'Levi,Thaxter', `${slug} ${key}: partners ${r.partners}`);
    }
    // edit the templated vehicle -> "edited"
    await p.evaluate(() => { const i = document.querySelector('[data-path="warehouse.acq_fee_pct"] input'); i.value = '2'; i.dispatchEvent(new Event('change', { bubbles: true })); i.dispatchEvent(new Event('input', { bubbles: true })); });
    await p.waitForTimeout(250);
    check(await p.evaluate(() => /edited/.test(document.getElementById('structurePick').selectedOptions[0].textContent)), `${slug}: picker should say edited after a change`);
  }
  // The Bend: direct by default with Levi and Thaxter; the SPV variants load and draw
  await p.goto(PAGE + '#the-bend'); await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelector('#sec-variants [data-v="-1"]').click()); await p.waitForTimeout(200);
  check(await p.evaluate(() => inputs.warehouse.structure === 'direct' && document.querySelectorAll('#whFlow .node').length === 4), 'The Bend should default to direct with two partners');
  await (await p.$('#whFlow')).screenshot({ path: __P.join(OUT, 'flow_bend_direct.png') });
  for (const v of ['fully subscribed', 'with warehouse']) {
    const ok = await p.evaluate((v) => { const x = [...document.querySelectorAll('#sec-variants [data-v]')].find((e) => e.textContent.includes(v)); if (!x) return false; x.click(); return true; }, v);
    await p.waitForTimeout(250);
    check(ok && await p.evaluate(() => inputs.warehouse.structure.startsWith('spv') && Math.abs(results.warehouse.base.summary.check) < 0.05), `The Bend variant "${v}" missing or not reconciling`);
  }
  errs.forEach((e) => fail.push('page error: ' + e));
  await b.close();
  if (fail.length) { console.log('FAIL\n' + fail.join('\n')); process.exitCode = 1; } else console.log('ok');
})();
