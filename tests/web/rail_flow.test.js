// Page test (run by tests/test_web.py): the side panel follows the flow (issue #18).
// Stages in the order of the flow diagram; side letter with our check, TIF and sale costs with the deal; LTEC's terms
// in their own card; diagram boxes open the cards that control them; "show only what's changed"; "find an input".
const __P = require('path');
const PAGE = 'file://' + __P.resolve(__dirname, '../../dist/index.html');
const OUT = __P.join(__dirname, '.out'); require('fs').mkdirSync(OUT, { recursive: true });
const { chromium } = require('playwright');
const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); };
const setVal = (p, path, v) => p.evaluate(([path, v]) => { const i = document.querySelector(`[data-path="${path}"] input, [data-path="${path}"] select`); if (i.type === 'checkbox') i.checked = v; else i.value = v; i.dispatchEvent(new Event('change', { bubbles: true })); i.dispatchEvent(new Event('input', { bubbles: true })); }, [path, v]);

(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(PAGE + '#the-bend'); await p.waitForTimeout(500);

  // 1. stages and their cards, in order
  const layout = await p.evaluate(() => [...document.querySelectorAll('.rail .stage')].map((s) => ({
    stage: s.dataset.stage, title: s.querySelector('.stage-h').textContent.trim(), hidden: s.hidden,
    secs: [...s.querySelectorAll(':scope > section[id]')].filter((x) => !x.hidden).map((x) => x.id) })));
  const want = [['version', ['sec-variants', 'sec-saved']], ['deal', ['sec-cases', 'sec-redstone', 'sec-loan', 'sec-hold', 'sec-timing', 'sec-sale']],
    ['position', ['sec-investor', 'sec-direct']], ['vehicle', ['sec-wh']], ['ltec', ['sec-ltec']], ['tools', ['sec-repo']]];
  check(JSON.stringify(layout.map((s) => [s.stage, s.secs])) === JSON.stringify(want), `stages: ${JSON.stringify(layout.map((s) => [s.stage, s.secs]))}`);
  check((layout.find((s) => s.stage === 'ltec') || {}).title === 'LTEC and its partners', `LTEC stage title: ${JSON.stringify(layout.find((s) => s.stage === 'ltec'))}`);
  const where = await p.evaluate(() => {
    const sec = (path) => { const el = document.querySelector(`[data-path="${path}"]`); return el && el.closest('section[id]').id; };
    return { sl: sec('investor.side_letter.enabled'), check: sec('investor.check'), tif: sec('deal.below_noi_income.factor'), selling: sec('deal.selling_cost_pct'), capex: sec('deal.annual_capex_reserves'),
      wh: [...document.querySelectorAll('#sec-wh .grp')].map((g) => g.dataset.grp), ltec: [...document.querySelectorAll('#sec-ltec .grp')].map((g) => g.dataset.grp) };
  });
  check(where.sl === 'sec-investor' && where.check === 'sec-investor', `side letter goes with our check: ${JSON.stringify(where)}`);
  check(where.tif === 'sec-sale' && where.selling === 'sec-sale' && where.capex === 'sec-sale', `TIF and sale costs go with the deal: ${JSON.stringify(where)}`);
  check(JSON.stringify(where.wh) === '["wh-names","wh-raise","wh-fees","wh-sales","wh-people"]', `vehicle groups: ${where.wh}`);
  check(JSON.stringify(where.ltec) === '["wh-ltec","wh-buyins"]', `LTEC groups: ${where.ltec}`);

  // changed badges land on the new homes
  await setVal(p, 'investor.side_letter.enabled', true); await p.waitForTimeout(150);
  await p.evaluate(() => { inputs.warehouse.manager_loans.push({ lender: 'levi', borrower: 'thaxter', amount: 1000, rate: 0.08, rate_type: 'simple', recourse: true }); renderWarehouseInputs(); recompute(); });
  await p.waitForTimeout(150);
  const badges = await p.evaluate(() => ({ inv: document.querySelector('#sec-investor > h3 .sec-badge').textContent, ltec: document.querySelector('#sec-ltec > h3 .sec-badge').textContent }));
  check(/changed/.test(badges.inv) && /changed/.test(badges.ltec), `changed badges: ${JSON.stringify(badges)}`);

  // 2. diagram boxes open the cards that control them
  await p.evaluate(() => { railClosed.add('sec-ltec'); railClosed.add('wh-people'); railClosed.add('sec-wh'); decorateRail(); });
  await p.evaluate(() => document.querySelector('#whFlow .node[data-open^="sec-ltec"]').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await p.waitForTimeout(400);
  const o1 = await p.evaluate(() => { const s = document.getElementById('sec-ltec'), r = s.getBoundingClientRect(), rr = document.querySelector('aside.rail').getBoundingClientRect();
    return { open: !s.classList.contains('collapsed'), inView: r.top >= rr.top - 2 && r.top < rr.bottom }; });
  check(o1.open && o1.inView, `LTEC box should open and show the LTEC card: ${JSON.stringify(o1)}`);
  await p.evaluate(() => document.querySelector('#whFlow .node[data-open*="wh-people"]').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await p.waitForTimeout(400);
  check(await p.evaluate(() => !document.getElementById('sec-wh').classList.contains('collapsed') && !document.querySelector('[data-grp="wh-people"]').classList.contains('collapsed')),
    'a partner box should open People in the vehicle card');

  // 3. show only what's changed
  await p.evaluate(() => document.querySelector('#sec-variants [data-v="-1"]').click()); await p.waitForTimeout(200);
  await p.evaluate(() => { const ck = inputs.cases.base; ck.exit_cap = 0.06; renderCaseFields(); recompute(); });
  await p.waitForTimeout(150);
  await p.click('#onlyChanged'); await p.waitForTimeout(200);
  const oc = await p.evaluate(() => {
    const vis = (el) => el && el.offsetParent !== null;
    return { cases: vis(document.getElementById('sec-cases')), loan: vis(document.getElementById('sec-loan')), wh: vis(document.getElementById('sec-wh')),
      exitCap: vis(document.querySelector('[data-path="cases.base.exit_cap"]')), unchanged: vis(document.querySelector('[data-path="cases.base.rent_factor"]')),
      dealStage: vis(document.querySelector('.stage[data-stage="deal"] .stage-h')), vehStage: vis(document.querySelector('.stage[data-stage="vehicle"] .stage-h')), version: vis(document.getElementById('sec-saved')) };
  });
  check(oc.cases && oc.exitCap && !oc.loan && !oc.wh && !oc.unchanged && oc.dealStage && !oc.vehStage && oc.version, `changed-only view: ${JSON.stringify(oc)}`);
  await p.click('#onlyChanged'); await p.waitForTimeout(150);
  check(await p.evaluate(() => document.getElementById('sec-loan').offsetParent !== null), 'turning it off shows everything again');

  // 4. find an input
  await p.evaluate(() => { inputs = E.applyStructure(inputs, 'spv_warehouse', STRUCTURES); renderWarehouseInputs(); recompute(); });
  await p.waitForTimeout(200);
  await p.evaluate(() => { railClosed.add('wh-sales'); railClosed.add('sec-wh'); decorateRail(); });
  await p.fill('#railFind', 'carry'); await p.waitForTimeout(150);
  const res = await p.evaluate(() => [...document.querySelectorAll('#railFindResults [data-find]')].map((x) => x.textContent));
  check(res.some((t) => /carry/i.test(t)), `find "carry": ${JSON.stringify(res)}`);
  await p.keyboard.press('Enter'); await p.waitForTimeout(400);
  const f1 = await p.evaluate(() => ({ open: !document.querySelector('[data-grp="wh-sales"]').classList.contains('collapsed') && !document.getElementById('sec-wh').classList.contains('collapsed'),
    focus: document.activeElement && document.activeElement.closest('[data-path]') && document.activeElement.closest('[data-path]').dataset.path }));
  check(f1.open && /selldown\.tranches\.0\.rate/.test(f1.focus || ''), `Enter jumps to the carry field: ${JSON.stringify(f1)}`);
  await p.fill('#railFind', 'exit cap'); await p.waitForTimeout(150);
  await p.evaluate(() => document.querySelector('#railFindResults [data-find]').click()); await p.waitForTimeout(300);
  const f2 = await p.evaluate(() => document.activeElement && document.activeElement.closest('[data-path]') && document.activeElement.closest('[data-path]').dataset.path);
  check(/^cases\.\w+\.exit_cap$/.test(f2 || ''), `clicking a result jumps to it: ${f2}`);

  await (await p.$('aside.rail')).screenshot({ path: __P.join(OUT, 'rail_flow.png') });
  errs.forEach((e) => fail.push('page error: ' + e));
  await b.close();
  if (fail.length) { console.log('FAIL\n' + fail.join('\n')); process.exitCode = 1; } else console.log('ok');
})();
