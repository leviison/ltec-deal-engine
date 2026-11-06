// Page test (run by tests/test_web.py). Fails on any page error or thrown error.
const __P = require('path');
const PAGE = 'file://' + __P.resolve(__dirname, '../../dist/index.html');
const OUT = __P.join(__dirname, '.out'); require('fs').mkdirSync(OUT, { recursive: true });
const { chromium } = require('playwright');
const t1 = require('./.fixtures/test1.json');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1300 } });
  const errs = []; p.on('pageerror', e => errs.push(e.stack.split('\n').slice(0, 3).join(' | ')));
  await p.addInitScript((t1) => {
    // a small in-memory store with the same calls the page uses: add, doc(id).set / update / delete, live snapshots
    const store = new Map([['nkao', { name: 'test 1 _ hold all capital', deal: 'siena-villas', inputs: t1.inputs, created_at: '2026-11-06T13:27:52Z', summary: 'Base 7.3% · Custom 7.4% · Levi +$117k', changes: 8 }]]);
    let listeners = [], n = 0;
    const emit = () => { const docs = [...store].map(([id, d]) => ({ id, data: () => JSON.parse(JSON.stringify(d)) })); listeners.forEach((cb) => cb({ docs })); };
    const merge = (a, b) => { for (const k of Object.keys(b)) { if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object') merge(a[k], b[k]); else a[k] = b[k]; } return a; };
    window.__store = store;
    const db = { collection: () => ({
      orderBy: () => ({ onSnapshot: (cb) => { listeners.push(cb); setTimeout(emit, 20); return () => {}; } }),
      add: async (d) => { const id = 'new' + (++n); store.set(id, JSON.parse(JSON.stringify(d))); setTimeout(emit, 10); return { id }; },
      doc: (id) => ({ set: async (d) => { store.set(id, JSON.parse(JSON.stringify(d))); setTimeout(emit, 10); },
                      update: async (d) => { store.set(id, merge(store.get(id), JSON.parse(JSON.stringify(d)))); setTimeout(emit, 10); },
                      delete: async () => { store.delete(id); setTimeout(emit, 10); } }) }) };
    const fake = async (input, opts) => {
      const t = Object.fromEntries(opts.tools.map((x) => [x.name, x]));
      window.__prop = await t.propose_scenario.execute({ deal: 'siena-villas', name: 'Levi holds 100% of fees & promote', description: 'Fixes the 50% shares: Levi gets 100% of LTEC fees & promote; Thaxter buys half via the existing buy-in.',
        replaces: 'test 1', changes: { 'warehouse.people.0.manager_share': 1 } }, {});
      const text = 'Proposed the fix.'; opts.onText({ text, delta: text }); return { text, truncated: false };
    };
    fake.limits = async () => ({ maxPromptBytes: 262144, tools: { maxCount: 20 } });
    window.claude = { use: async (nm) => (nm === 'sample' ? fake : nm === 'db' ? db : null) };
  }, t1);
  const list = () => p.evaluate(() => [...document.querySelectorAll('#savedList .item')].map(i => i.innerText.replace(/\n+/g, ' | ')));
  const chip = () => p.evaluate(() => document.getElementById('scenarioChip').innerText + ' || ' + (document.getElementById('editingRow').hidden ? '(no edit row)' : document.getElementById('editingRow').innerText.replace(/\n/g, ' ')));
  const card = (k) => p.evaluate((k) => { const c = [...document.querySelectorAll('#caseCards .case')].find(c => c.querySelector('.name').innerText.startsWith(k)); return c.querySelector('.irr').innerText.split('\n')[0]; }, k);
  await p.goto(PAGE + '#siena-villas'); await p.waitForTimeout(800);
  console.log('1 list:', await list());
  // load it, edit, check chip, update
  await p.evaluate(() => [...document.querySelectorAll('#savedList .item')][0].querySelector('button').click()); await p.waitForTimeout(300);
  console.log('2 loaded:', await chip());
  await p.evaluate(() => { const i = document.getElementById('f-warehouse-people-0-manager_share'); i.value = '100'; i.dispatchEvent(new Event('input', { bubbles: true })); }); await p.waitForTimeout(300);
  console.log('3 edited:', await chip());
  await p.click('#updateBtn'); await p.waitForTimeout(400);
  console.log('4 after update:', await chip(), '| toast:', await p.evaluate(() => document.getElementById('saveToast').innerText));
  console.log('5 list:', await list());
  console.log('   stored:', await p.evaluate(() => { const d = window.__store.get('nkao'); return [d.name, !!d.inputs, Object.keys(JSON.parse(d.diff_json)).length, d.history.length, d.base_as_of, d.summary]; }));
  // undo (two clicks: confirm)
  await p.evaluate(() => { const u = [...document.querySelectorAll('#savedList .item button')].find(x => x.textContent === 'Undo last update'); u.click(); u.click(); }); await p.waitForTimeout(400);
  console.log('6 after undo:', await list());
  // duplicate and rename
  await p.evaluate(() => [...document.querySelectorAll('#savedList .item button')].find(x => x.textContent === 'Duplicate').click()); await p.waitForTimeout(400);
  await p.evaluate(() => { const it = [...document.querySelectorAll('#savedList .item')].find(i => i.innerText.includes('(copy)')); [...it.querySelectorAll('button')].find(x => x.textContent === 'Rename').click(); });
  await p.evaluate(() => { const it = [...document.querySelectorAll('#savedList .item')].find(i => i.querySelector('.rename')); const inp = it.querySelector('.rename input'); inp.value = 'test 2'; it.querySelector('.rename .btn').click(); }); await p.waitForTimeout(400);
  console.log('7 after duplicate + rename:', (await list()).map(x => x.split(' | ')[0]));
  // Ask proposes a fix to test 1; click Update
  await p.fill('#askInput', 'fix test 1'); await p.click('#askSend'); await p.waitForTimeout(1200);
  console.log('8 card:', await p.evaluate(() => document.querySelector('.ask-prop').innerText.replace(/\n+/g, ' | ').slice(0, 260)));
  await p.evaluate(() => [...document.querySelectorAll('.ask-prop button')].find(x => x.textContent.startsWith('Update')).click()); await p.waitForTimeout(500);
  console.log('9 after Ask update:', (await list())[0]);
  // load test 1 now: Base with full shares
  await p.evaluate(() => [...document.querySelectorAll('#savedList .item')].find(i => i.innerText.startsWith('test 1')).querySelector('button').click()); await p.waitForTimeout(300);
  console.log('10 loaded fixed test 1:', await chip(), '| share field:', await p.evaluate(() => document.getElementById('f-warehouse-people-0-manager_share').value));
  console.log('errors:', errs); if (errs.length) process.exitCode = 1; await b.close();
})();
