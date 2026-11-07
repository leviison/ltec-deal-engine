// Page test (run by tests/test_web.py): click-to-edit (issue #20). Warnings, the change chip, case cards, exit figures
// and Ask's answers take you to the input that drives them. Coverage: every input in every deal file opens a field or
// card in the panel (or is listed below as not shown, with the reason), so new deals and new inputs keep working.
const __P = require('path');
const PAGE = 'file://' + __P.resolve(__dirname, '../../dist/index.html');
const { chromium } = require('playwright');
const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); };
const focused = (p) => p.evaluate(() => { const a = document.activeElement, f = a && a.closest('[data-path]'); return f ? f.dataset.path : null; });
const isOpen = (p, id) => p.evaluate((id) => { const el = document.getElementById(id) || document.querySelector(`[data-grp="${id}"]`); return !!el && !el.classList.contains('collapsed') && el.offsetParent !== null; }, id);

// Inputs with no place in the panel, on purpose. Anything else in a deal file must be reachable.
const NOT_SHOWN = [
  [/^(schema_version|version|as_of|name)$/, 'file bookkeeping'],
  [/^sensitivity\./, 'the exit-cap grid shown in the Exit & sensitivity table, not an assumption'],
  [/^deal\.(purchase_price|legal_preferred_capital|unit_price|preferred_units|sponsor_common_units)$/, "context from the documents; the engine doesn't use it"],
  [/^deal\.underwritten_hold_years$/, "set by the length of the sponsor's rows"],
];
// Inputs that open their card but have no field on screen, and why. Every other input must show a field to focus.
const CARD_ONLY = [
  [/^cases\.\w+\.(label|kind|note|from|built_from|other_income_explicit)$/, "the case's description and type, shown on its card"],
  [/^cases\.\w+\.(rents|other_income|opex|capex|noi|y6_noi_growth|net_sale_proceeds)$/, "the sponsor's own rows, from the documents (a Custom case copies them to edit)"],
  [/^cases\.\w+\.(rent_y1|opex_y1)$/, "Year-1 starting figures from the documents; change them in the deal file"],
  [/^cases\.\w+\.deal_overrides\./, "a case's own deal settings, shown when they apply; otherwise change them in the deal file or through Ask"],
  [/^warehouse\.people\.\d+\.id$/, 'stable id, never edited'],
  [/^(warehouse\.(selldown\.tranches|manager_transfers|manager_loans|manager_vesting|manager_waterfall\.tiers)|direct_investors)$/, 'a list with nothing in it yet: its card has the Add button'],
  [/^deal\.below_noi_income\./, 'shown when the deal has income below NOI (the schedule itself comes from the documents)'],
  [/^investor\.side_letter\./, 'shown when the deal has a side letter (its terms when it is on)'],
  [/^deal\.refi\./, 'shown when a refinance (and crystallization) is on'],
];

(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(PAGE + '#siena-villas'); await p.waitForTimeout(500);
  await p.evaluate(() => { document.getElementById('collapseAll').click(); });

  // 1. a warning takes you to the field it's about
  await p.evaluate(() => { inputs.warehouse.people[0].manager_share = 0.2; renderWarehouseInputs(); recompute(); railClosed.add('sec-wh'); decorateRail(); });
  await p.waitForTimeout(150);
  const w1 = await p.evaluate(() => { const ib = document.getElementById('whIssues'); return { shown: ib && !ib.hidden, links: ib ? ib.querySelectorAll('[data-edit]').length : 0, text: ib ? ib.textContent : '' }; });
  check(w1.shown && w1.links > 0, `vehicle warnings should list links: ${JSON.stringify(w1)}`);
  await p.evaluate(() => { railClosed.add('wh-people'); decorateRail(); document.querySelector('#whIssues [data-edit]').click(); });
  await p.waitForTimeout(250);
  check(await isOpen(p, 'wh-people') && (await focused(p)) === 'warehouse.people.0.manager_share', `warning link should focus the share field (got ${await focused(p)})`);

  // 2. the change chip shows only what's changed
  await p.evaluate(() => document.getElementById('changeChip').click()); await p.waitForTimeout(150);
  check(await p.evaluate(() => document.querySelector('aside.rail').classList.contains('only-changed')), 'change chip should switch on "show only what\'s changed"');
  await p.evaluate(() => { setOnlyChanged(false); document.querySelector('#sec-variants [data-v="-1"]').click(); });
  await p.waitForTimeout(150);

  // 3. a case card opens that case's assumptions
  await p.evaluate(() => { railClosed.add('sec-cases'); decorateRail(); document.querySelector('#caseCards article[data-case="downside"]').click(); });
  await p.waitForTimeout(250);
  const c3 = await p.evaluate(() => ({ edit: editCase, tab: (document.querySelector('#caseTabs [aria-pressed="true"]') || {}).dataset }));
  check(await isOpen(p, 'sec-cases') && c3.edit === 'downside' && c3.tab && c3.tab.k === 'downside', `case card should open Downside's assumptions: ${JSON.stringify(c3)}`);

  // 4. exit figures link to their inputs
  await p.evaluate(() => { document.querySelector('#detailTabs [data-k="base"]').click(); railClosed.add('sec-loan'); decorateRail(); });
  await p.evaluate(() => [...document.querySelectorAll('#exitKv [data-edit]')].find((x) => /Loan payoff/.test(x.textContent)).click()); await p.waitForTimeout(250);
  check(await isOpen(p, 'sec-loan') && (await focused(p)) === 'deal.loan_amount', `loan payoff should go to the loan amount (got ${await focused(p)})`);
  await p.evaluate(() => [...document.querySelectorAll('#exitKv [data-edit]')].find((x) => /Exit cap/.test(x.textContent)).click()); await p.waitForTimeout(250);
  check((await focused(p)) === 'cases.base.exit_cap', `exit cap should go to Base's exit cap (got ${await focused(p)})`);
  check(await p.evaluate(() => ![...document.querySelectorAll('#exitKv dt')].some((d) => /LP IRR|Your profit/.test(d.textContent) && d.querySelector('[data-edit]'))), 'results (IRR, profit) must not link to a single input');

  // 5. Ask: input links in answers (this deal, another deal; unknown paths stay text) and in what-if rows
  const a5 = await p.evaluate(() => { const box = document.createElement('div'); box.id = 'askTest';
    box.innerHTML = md('Raise the [loan amount](input:deal.loan_amount), not [IRR](input:no.such.input). On The Bend: [its exit cap](input:the-bend/cases.downside.exit_cap).');
    document.body.append(box); return { links: box.querySelectorAll('[data-edit]').length, text: box.textContent }; });
  check(a5.links === 2 && /IRR/.test(a5.text), `Ask links: ${JSON.stringify(a5)}`);
  await p.evaluate(() => document.querySelector('#askTest [data-edit="deal.loan_amount"]').click()); await p.waitForTimeout(200);
  check((await focused(p)) === 'deal.loan_amount', 'an Ask link should go to its input');
  await p.evaluate(() => document.querySelector('#askTest [data-deal="the-bend"]').click()); await p.waitForTimeout(400);
  const a6 = await p.evaluate(() => ({ deal: META.slug, edit: editCase }));
  check(a6.deal === 'the-bend' && a6.edit === 'downside' && (await focused(p)) === 'cases.downside.exit_cap', `a link to another deal should open it: ${JSON.stringify(a6)} ${await focused(p)}`);

  // 6. coverage: every input in every deal file has somewhere to go
  for (const slug of await p.evaluate(() => SLUGS)) {
    const missing = await p.evaluate(([slug, NS, CO]) => {
      openDeal(slug);
      const skip = NS.map((re) => new RegExp(re));
      const leaves = [];
      const walk = (o, pre) => {
        if (Array.isArray(o)) { if (o.length && o.every((x) => x && typeof x === 'object')) o.forEach((x, i) => walk(x, `${pre}.${i}`)); else leaves.push(pre); return; }
        if (o && typeof o === 'object') { Object.entries(o).forEach(([k, v]) => { if (!k.startsWith('_')) walk(v, pre ? `${pre}.${k}` : k); }); return; }
        leaves.push(pre);
      };
      Object.entries(DEALS[slug]).forEach(([k, v]) => { if (!['meta', 'sources'].includes(k) && !k.startsWith('_')) walk(v, k); });
      const cardOnly = CO.map((re) => new RegExp(re));
      const nowhere = [], noField = [];
      leaves.filter((pp) => !skip.some((re) => re.test(pp))).forEach((pp) => {
        if (!railHome(pp).length || !goToInput(pp)) { nowhere.push(pp); return; }
        let f = pp; while (f && !document.querySelector(`.rail [data-path="${f}"]`)) f = f.includes('.') ? f.slice(0, f.lastIndexOf('.')) : '';
        if (!f && !cardOnly.some((re) => re.test(pp))) noField.push(pp);
      });
      return { nowhere, noField };
    }, [slug, NOT_SHOWN.map(([re]) => re.source), CARD_ONLY.map(([re]) => re.source)]);
    check(!missing.nowhere.length, `${slug}: inputs with nowhere to go in the panel (give them a card and a railHome, or list them in NOT_SHOWN with the reason): ${missing.nowhere.slice(0, 15).join(', ')}`);
    check(!missing.noField.length, `${slug}: inputs that open a card but show no field (add a field, or list them in CARD_ONLY with the reason): ${missing.noField.slice(0, 15).join(', ')}`);
  }

  errs.forEach((e) => fail.push('page error: ' + e));
  await b.close();
  if (fail.length) { console.log('FAIL\n' + fail.join('\n')); process.exitCode = 1; } else console.log('ok');
})();
