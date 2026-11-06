// Page test (run by tests/test_web.py): the narrow left panel stays readable.
// Regression for Nov 6, 2026: saved-scenario names wrapped one letter per line next to their action links, and the
// "Editing" box squeezed its text beside a long Update button. Checks at desktop and phone widths, with a long
// scenario name loaded and edited, that names and messages get real width and nothing spills sideways.
const __P = require('path');
const PAGE = 'file://' + __P.resolve(__dirname, '../../dist/index.html');
const OUT = __P.join(__dirname, '.out'); require('fs').mkdirSync(OUT, { recursive: true });
const { chromium } = require('playwright');
const t1 = require('./.fixtures/test1.json');

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); };

(async () => {
  const b = await chromium.launch();
  for (const width of [1440, 1180, 400]) {
    const p = await b.newPage({ viewport: { width, height: 1400 } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.addInitScript((t1) => {
      const docs = [
        { id: 'a', data: () => ({ name: 'test 1 _ hold all capital', deal: 'siena-villas', inputs: t1.inputs, created_at: '2026-11-06T13:27:52Z', summary: 'Base 7.3% · Custom 7.4% · Levi +$117k', changes: 8,
          history: [{ saved_at: '2026-11-06T13:00:00Z', summary: 'x', diff_json: '{}' }], note: 'A fairly long note written by Ask about what this scenario assumes and why it was built.' }) },
        { id: 'b', data: () => ({ name: 'Supercalifragilisticexpialidocious-scenario-name-without-spaces-at-all', deal: 'siena-villas', diff_json: '{}', created_at: '2026-11-06T13:30:00Z', summary: 'Base 7.2%' }) },
      ];
      const db = { collection: () => ({ orderBy: () => ({ onSnapshot: (cb) => { setTimeout(() => cb({ docs }), 20); return () => {}; } }), add: async () => ({ id: 'z' }), doc: () => ({ set: async () => {}, update: async () => {}, delete: async () => {} }) }) };
      window.claude = { use: async (n) => (n === 'db' ? db : null) };
    }, t1);
    await p.goto(PAGE + '#siena-villas'); await p.waitForTimeout(700);
    // open the Saved scenarios section if collapsed, load the first scenario and edit something
    await p.evaluate(() => { const sec = document.getElementById('sec-saved'); if (sec && sec.classList.contains('closed')) sec.querySelector('h3, .sec-head, button')?.click(); });
    await p.evaluate(() => [...document.querySelectorAll('#savedList .item')][0].querySelector('button').click()); await p.waitForTimeout(300);
    await p.evaluate(() => { const i = document.getElementById('f-warehouse-people-0-manager_share'); if (i) { i.value = '100'; i.dispatchEvent(new Event('input', { bubbles: true })); } }); await p.waitForTimeout(300);
    await p.evaluate(() => document.getElementById('sec-saved').scrollIntoView());
    const m = await p.evaluate(() => {
      const r = (el) => el.getBoundingClientRect();
      const lineH = (el) => parseFloat(getComputedStyle(el).lineHeight) || 18;
      const items = [...document.querySelectorAll('#savedList .item')];
      const box = r(document.getElementById('savedList'));
      return {
        listWidth: box.width,
        names: items.map((it) => { const nm = it.querySelector('.nm'); return { w: r(nm).width, lines: Math.round(r(nm).height / lineH(nm)), text: nm.textContent.length }; }),
        spill: items.some((it) => [...it.querySelectorAll('*')].filter((c) => r(c).width > 0).some((c) => r(c).right > r(it).right + 1 || r(c).left < r(it).left - 1)),
        editing: (() => { const e = document.getElementById('editingRow'); if (e.hidden) return null; const t = document.getElementById('editingText');
          return { textW: r(t).width, boxW: r(e).width, lines: Math.round(r(t).height / lineH(t)), btnRight: r(document.getElementById('updateBtn')).right, boxRight: r(e).right }; })(),
        pageWider: document.documentElement.scrollWidth > window.innerWidth,
      };
    });
    m.names.forEach((n, i) => {
      check(n.w >= 0.8 * m.listWidth - 24, `${width}px: scenario name ${i + 1} is only ${Math.round(n.w)}px wide in a ${Math.round(m.listWidth)}px list`);
      check(n.lines <= Math.ceil(n.text / 18) + 1, `${width}px: scenario name ${i + 1} wraps onto ${n.lines} lines`);
    });
    check(!m.spill, `${width}px: something in a saved-scenario row spills outside it`);
    check(m.editing, `${width}px: the Editing box should show after loading and editing a scenario`);
    if (m.editing) {
      check(m.editing.textW >= 0.8 * m.editing.boxW - 24, `${width}px: Editing message squeezed to ${Math.round(m.editing.textW)}px of ${Math.round(m.editing.boxW)}px`);
      check(m.editing.lines <= 4, `${width}px: Editing message wraps onto ${m.editing.lines} lines`);
      check(m.editing.btnRight <= m.editing.boxRight + 1, `${width}px: Update button sticks out of the Editing box`);
    }
    check(!m.pageWider, `${width}px: the page scrolls sideways`);
    errs.forEach((e) => fail.push(`${width}px page error: ${e}`));
    await p.screenshot({ path: __P.join(OUT, `rail_${width}.png`), clip: await p.evaluate(() => { const r = document.getElementById('sec-saved').getBoundingClientRect(); return { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), width: r.width + 16, height: Math.min(r.height + 16, 1300) }; }) });
    await p.close();
  }
  await b.close();
  if (fail.length) { console.log('FAIL\n' + fail.join('\n')); process.exitCode = 1; } else console.log('ok');
})();
