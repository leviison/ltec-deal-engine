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
  // the diagram follows the case shown: its own buttons and "Case to show" stay in step
  await p.evaluate(() => document.querySelector('#flowTabs [data-k="downside"]').click()); await p.waitForTimeout(200);
  const f1 = await p.evaluate(() => ({ cap: document.querySelector('#whFlow .cap').textContent, det: document.querySelector('#detailTabs [aria-pressed="true"]').dataset.k,
    back: document.querySelector('#whFlow .node .lab').textContent, want: results.cases.downside.investor.payments.reduce((a, b) => a + b, 0) }));
  check(/^Downside/.test(f1.cap) && f1.det === 'downside', `diagram tabs should set the case everywhere: ${JSON.stringify(f1)}`);
  const f2 = await p.evaluate(() => { document.querySelector('#detailTabs [data-k="sponsor"]').click(); return { cap: document.querySelector('#whFlow .cap').textContent, sel: document.querySelector('#flowTabs [aria-pressed="true"]').dataset.k, lab: document.querySelector('#whFlow .node .lab').textContent, want: fmt.usdk(results.cases.sponsor.investor.payments.reduce((a, b) => a + b, 0)) }; });
  check(f2.sel === 'sponsor' && f2.lab.includes(f2.want), `"Case to show" should move the diagram: ${JSON.stringify(f2)}`);
  // the tables with every case point at the case shown
  await p.evaluate(() => document.querySelector('#flowTabs [data-k="downside"]').click()); await p.waitForTimeout(200);
  const hl = await p.evaluate(() => ({ th: [...document.querySelectorAll('#whTable th.shown')].map((x) => x.textContent), cells: document.querySelectorAll('#whTable td.shown').length,
    rows: document.querySelectorAll('#whTable tbody tr:not(.grp)').length, label: results.cases.downside.label }));
  check(await p.evaluate(() => document.getElementById('whCallout').textContent.includes(results.cases.downside.label)), 'the callout should describe the case shown');
  check(hl.th.length === 1 && hl.th[0] === hl.label && hl.cells > 5, `vehicle table should mark the Downside column: ${JSON.stringify(hl)}`);
  // #16: the description shows the template's own numbers, and once the vehicle is edited it says what changed
  await p.goto(PAGE + '#the-bend'); await p.waitForTimeout(400);
  await p.selectOption('#structurePick', 'spv_warehouse'); await p.waitForTimeout(200);
  const n0 = await p.evaluate(() => { STRUCTURES.templates.spv_warehouse.sale_carry = 0.07; renderWarehouseInputs(); return document.querySelector('.structure-pick').textContent; });
  check(/7\.0% simple carry/.test(n0) && !/\{/.test(n0), `template description should use the template's carry: ${n0.slice(0, 300)}`);
  await p.evaluate(() => { STRUCTURES.templates.spv_warehouse.sale_carry = 0.06; renderWarehouseInputs(); });
  await p.evaluate(() => { const i = document.querySelector('[data-path="warehouse.selldown.tranches.0.rate"] input'); i.value = '8'; i.dispatchEvent(new Event('change', { bubbles: true })); i.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.waitForTimeout(200);
  const n1 = await p.evaluate(() => document.querySelector('.structure-pick').textContent);
  check(/sale carry 8\.0% \(template 6\.0%\)/.test(n1), `edited vehicle should list what changed from the template: ${n1.slice(0, 400)}`);
  check(/resets/.test(n1), 'the picker should say picking again resets edits to the house terms');
  errs.forEach((e) => fail.push('page error: ' + e));
  await b.close();
  if (fail.length) { console.log('FAIL\n' + fail.join('\n')); process.exitCode = 1; } else console.log('ok');
})();
