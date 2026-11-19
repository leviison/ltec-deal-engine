/* Oil & gas deal view (#46): the dashboard for a deal whose meta.asset_class is "oil_gas".
 * Registers MODULE_VIEWS.oil_gas, which the page calls to open a deal, list its saved scenarios, run its Ask tools and
 * add its rows to Compare. Every field comes from the module's input catalog (engine/inputs_oil_gas.json, embedded
 * as MODULE_DATA.oil_gas.inputs) and every number from engine/oil_gas.js; no deal-specific text lives here.
 * Loaded before the page's main script: it reads page helpers (fmt, esc, DEALS, working, db, ...) only when called.
 */
(function () {
  "use strict";
  const KEY = "oil_gas";
  const OG = window.OilGasEngine;
  const data = () => (MODULE_DATA[KEY] || {});
  const catalog = () => data().inputs || { groups: [], not_editable: {} };
  const house = () => data().screens || { checks: [] };
  const st = { slug: null, inp: null, editCase: "base", detailCase: "base", res: null, defRes: null, activeScenario: null, afterTax: false };

  // ------------------------------------------------------------ inputs and results
  const caseKeys = (inp) => Object.keys(inp.cases).filter((k) => k !== "custom").concat(inp.cases.custom ? ["custom"] : []);
  const params = (inp, k) => OG.caseParams(inp, k);
  function persist() { working[st.slug] = { inputs: st.inp, activeScenario: st.activeScenario }; refreshPicker(); }
  function runAll(inp) { return OG.runAll(inp, house()); }
  function recompute() { st.res = runAll(st.inp); persist(); renderMain(); markChanged(); }

  // a change by dotted path (cases.<k>.<path> or deal / investor paths); a derived case stores only what it changes
  function applyChange(inp, path, v) {
    const m = String(path).match(/^cases\.([^.]+)\.(.+)$/);
    if (m) {
      if (!inp.cases[m[1]]) throw new Error(`Unknown case "${m[1]}". Cases: ${Object.keys(inp.cases).join(", ")}`);
      const rel = m[2], known = catFields("case").some((f) => rel === f.path || rel.startsWith(f.path + "."));
      if (!known) throw new Error(`No case input "${rel}". Case inputs: ${catFields("case").map((f) => f.path).join(", ")}`);
      const cur = get(params(inp, m[1]), rel);
      setDeep(inp, path, coerce(cur, v, rel));
      return;
    }
    if (get(inp, path) === undefined || !catFields("deal").some((f) => f.path === path)) throw new Error(`No input at "${path}". Deal inputs: ${catFields("deal").map((f) => f.path).join(", ")}`);
    setDeep(inp, path, coerce(get(inp, path), v, path));
  }
  function coerce(cur, v, path) {
    if (/gas_ngl_price$/.test(path) && (v === null || v === "")) return null;
    if (/\.(years|history)\.[0-9-]+$/.test(path) || typeof cur === "number" || /gas_ngl_price$/.test(path)) {
      const n = Number(v); if (!isFinite(n)) throw new Error(`"${path}" needs a number`); return n;
    }
    return clone(v);
  }
  const catFields = (scope) => catalog().groups.filter((g) => g.scope === scope).flatMap((g) => g.fields);

  // ------------------------------------------------------------ open, load
  function open(slug) {
    st.slug = slug;
    const w = working[slug];
    st.inp = w ? w.inputs : clone(DEALS[slug]);
    st.activeScenario = w ? w.activeScenario : null;
    const ks = caseKeys(st.inp);
    st.editCase = ks.includes("base") ? "base" : ks[0];
    st.detailCase = st.editCase;
    st.defRes = runAll(DEALS[slug]);
    const m = DEALS[slug].meta;
    document.getElementById("dealName").textContent = m.name;
    document.getElementById("versionChip").textContent = "Model " + DEALS[slug].version + " · inputs " + DEALS[slug].as_of;
    document.getElementById("modView").innerHTML = skeleton();
    bind();
    renderRail();
    recompute();
    renderStatic();
  }
  function load(inp, scenarioId) { st.inp = inp; st.activeScenario = scenarioId || null; renderRail(); recompute(); }

  function skeleton() {
    return `<div class="layout og-layout">
    <aside class="rail" aria-label="Assumptions">
      <section>
        <div class="row" style="justify-content:space-between"><h2>Assumptions</h2><button class="link" id="ogReset" type="button">Reset to defaults</button></div>
        <p class="note" style="margin:0">Changed fields turn yellow. Results update as you type. A derived case shows what it inherits; change a field to set its own.</p>
      </section>
      <div class="stage"><div class="stage-h">Which version</div>
        <section><h3>Saved scenarios</h3>
          <div class="row"><input class="text" id="ogSaveName" placeholder="Name this scenario" maxlength="80" aria-label="Scenario name"><button class="btn primary" id="ogSave" type="button">Save</button></div>
          <div class="toast" id="ogToast" role="status"></div>
          <div class="saved" id="ogSaved"></div>
        </section>
      </div>
      <div class="stage"><div class="stage-h">The case</div>
        <section><h3>Case to edit</h3><div class="seg" id="ogCaseTabs" role="group" aria-label="Case to edit"></div><p class="note" id="ogCaseNote" style="margin:0"></p></section>
        <div id="ogCaseFields"></div>
      </div>
      <div class="stage"><div class="stage-h">Our position and the venture</div><div id="ogDealFields"></div></div>
      <div class="stage"><div class="stage-h">Tools</div>
        <section><h3>Send changes to the repo</h3><p class="note" style="margin:0">Copy these inputs over <span class="num">deals/${esc(st.slug)}/deal.json</span> to make them the new defaults.</p>
          <div class="row"><button class="btn" id="ogCopy" type="button">Copy deal.json</button></div><div class="toast" id="ogCopyToast" role="status"></div></section>
      </div>
    </aside>
    <main class="mod-main">
      <section aria-label="Returns by case"><div class="cases" id="ogCards"></div></section>
      <section class="panel"><header><div><h2>Cash back on the check</h2><span class="muted small" id="ogChartSub"></span></div>
        <div class="seg" id="ogTaxSeg" role="group" aria-label="Before or after tax" style="flex:0 0 auto"><button type="button" data-tax="0">Before tax</button><button type="button" data-tax="1">After tax</button></div></header>
        <div class="legend" id="ogLegend" style="margin-bottom:8px"></div><div class="chart-wrap" id="ogChart"></div></section>
      <section class="panel"><header><h2>Case detail by year</h2><div class="seg" id="ogDetailTabs" role="group" aria-label="Case to show" style="min-width:340px"></div></header>
        <div class="tablewrap" id="ogYears"></div><p class="note" id="ogYearsNote"></p></section>
      <section class="panel"><header><h2>Quick checks</h2><span class="muted small">House thresholds for oil &amp; gas; hover a figure for its rule</span></header>
        <div class="tablewrap" id="ogChecks"></div></section>
      <section class="panel"><header><h2>What the sponsor says, and what it costs</h2></header>
        <div class="two"><div style="min-width:0"><div class="eyebrow" style="margin-bottom:6px">Where the money goes</div><dl class="kv" id="ogCost"></dl></div>
        <div style="min-width:0"><div class="eyebrow" style="margin-bottom:6px">The sponsor's conversion table, rebuilt</div><div class="tablewrap" id="ogTable"></div></div></div>
        <p class="note" id="ogTableNote"></p></section>
      <section class="panel"><header><h2>Wells</h2><span class="muted small" id="ogWellsSub"></span></header><div class="tablewrap" id="ogWells"></div></section>
      <section class="panel"><header><h2>Open diligence</h2></header><ul class="plain" id="ogDiligence"></ul></section>
      <section class="panel"><header><h2>Sources</h2><span class="muted small">Where each input came from</span></header><div class="tablewrap" id="ogSources" style="max-height:360px;overflow:auto"></div></section>
      <p class="foot muted small">${esc(moduleLabel(st.slug))} · engine/oil_gas.js · ${ENGINE_LABEL}</p>
    </main></div>`;
  }

  // ------------------------------------------------------------ the rail: fields from the catalog
  const fid = (path) => "og-" + path.replace(/[^a-zA-Z0-9]+/g, "-");
  function shown(kind, v) {
    if (v == null) return "";
    if (kind === "pct" || kind === "pct4") return +(v * 100).toFixed(kind === "pct4" ? 6 : 4);
    if (kind === "usd") return Math.round(v);
    return v;
  }
  function fieldHtml(f, full, v, v0) {
    const changed = JSON.stringify(v) !== JSON.stringify(v0);
    const lab = `<label for="${fid(full)}">${esc(f.label)}${f.help ? `<span class="src">${esc(f.help)}</span>` : ""}</label>`;
    const wrap = (inner, cls) => `<div class="field${cls || ""}${changed ? " is-changed" : ""}" data-path="${esc(full)}">${lab}<div class="in">${inner}</div></div>`;
    if (f.kind === "select") return wrap(`<select id="${fid(full)}">${f.options.map(([val, l]) => `<option value="${esc(val)}"${String(v) === String(val) ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`);
    if (f.kind === "date") return wrap(`<input id="${fid(full)}" type="date" min="${DATE_MIN}" max="${DATE_MAX}" value="${esc(v || "")}">`);
    if (f.kind === "month") return wrap(`<input id="${fid(full)}" type="month" value="${esc(v || "")}">`);
    if (f.kind === "year_map" || f.kind === "month_map") {
      const keys = Object.keys(v || {}).sort();
      return `<div style="display:grid;gap:4px" data-path="${esc(full)}" class="${changed ? "is-changed" : ""}">${lab}<div class="oi-grid">${keys.length ? keys.map((k) =>
        `<div><span class="yl">${esc(k)}</span><div class="in${JSON.stringify((v || {})[k]) !== JSON.stringify((v0 || {})[k]) ? " is-changed" : ""}"><input id="${fid(full + "." + k)}" data-key="${esc(k)}" type="number" step="0.5" value="${v[k]}" aria-label="${esc(f.label)}, ${esc(k)}"></div></div>`).join("") : `<span class="muted small">none</span>`}</div></div>`;
    }
    if (f.kind === "assessments") {
      const list = v || [];
      return `<div style="display:grid;gap:4px" data-path="${esc(full)}" class="${changed ? "is-changed" : ""}">${lab}${list.map((a, i) =>
        `<div class="row" style="gap:6px"><input class="text" type="date" data-ai="${i}" data-ak="date" value="${esc(a.date)}" aria-label="Assessment ${i + 1} date"><span>$</span><input class="text" type="number" step="10000" data-ai="${i}" data-ak="per_unit" value="${Math.round(a.per_unit)}" aria-label="Assessment ${i + 1} per unit" style="width:110px"><span class="muted small">/unit</span><button class="link" type="button" data-arm="${i}">Remove</button></div>`).join("")}
        <button class="link" type="button" data-aadd="1" style="justify-self:start">+ Add an assessment</button></div>`;
    }
    const pre = /^usd/.test(f.kind) ? "$" : "", post = f.kind === "pct" || f.kind === "pct4" ? "%" : f.unit && !pre ? f.unit : f.unit && pre ? f.unit.replace("$", "") : "";
    const step = f.step || (f.kind === "pct" ? 0.5 : f.kind === "pct4" ? 0.0001 : f.kind === "usd" ? 1000 : f.kind.startsWith("usd2") ? 0.5 : 0.01);
    return wrap(`${pre ? `<span>${pre}</span>` : ""}<input id="${fid(full)}" type="number" step="${step}" value="${shown(f.kind, v)}"${f.kind === "usd2_or_null" ? ' placeholder="as oil"' : ""}>${post ? `<span>${esc(post)}</span>` : ""}`);
  }
  function groupHtml(g, k) {
    const full = (f) => (g.scope === "case" ? `cases.${k}.${f.path}` : f.path);
    const val = (inp, f) => (g.scope === "case" ? get(params(inp, k), f.path) : get(inp, f.path));
    const defInp = DEALS[st.slug];
    return `<section class="og-grp" data-grp="${esc(g.id)}"><h3>${esc(g.title)}</h3><div style="display:grid;gap:8px">${g.fields.map((f) =>
      fieldHtml(f, full(f), val(st.inp, f), defInp.cases[k] || g.scope !== "case" ? val(defInp, f) : undefined)).join("")}</div></section>`;
  }
  function renderRail() {
    const k = st.editCase, ks = caseKeys(st.inp);
    document.getElementById("ogCaseTabs").innerHTML = ks.map((c) => `<button type="button" data-ogk="${c}" aria-pressed="${c === k}">${esc(shortCase(c))}</button>`).join("");
    const c = st.inp.cases[k];
    document.getElementById("ogCaseNote").textContent = (c.from ? `Derived from ${st.inp.cases[c.from] ? st.inp.cases[c.from].label : c.from}. ` : "") + (c.note || "");
    document.getElementById("ogCaseFields").innerHTML = catalog().groups.filter((g) => g.scope === "case").map((g) => groupHtml(g, k)).join("");
    document.getElementById("ogDealFields").innerHTML = catalog().groups.filter((g) => g.scope === "deal").map((g) => groupHtml(g, k)).join("");
    renderSaved();
    updateChip();
  }
  const shortCase = (k) => ({ sponsor: "Sponsor", base: "Base", downside: "Downside", stress: "Stress", custom: "Custom" }[k] || (st.inp.cases[k] || {}).label || k);
  function fieldSpec(path) {
    const m = path.match(/^cases\.[^.]+\.(.+)$/), rel = m ? m[1] : path;
    for (const g of catalog().groups) for (const f of g.fields) if ((g.scope === "case") === !!m && (rel === f.path || rel.startsWith(f.path + "."))) return f;
    return null;
  }
  function onField(el) {
    const host = el.closest("[data-path]"); if (!host) return;
    const path = host.dataset.path, f = fieldSpec(path); if (!f) return;
    let v;
    try {
      if (f.kind === "year_map" || f.kind === "month_map") { const n = parseFloat(el.value); if (!isFinite(n)) return; applyChange(st.inp, `${path}.${el.dataset.key}`, n); }
      else if (f.kind === "assessments") {
        const cur = clone(get(st.inp, path) !== undefined ? get(st.inp, path) : get(params(st.inp, st.editCase), "assessments") || []);
        const a = cur[+el.dataset.ai]; if (!a) return;
        if (el.dataset.ak === "date") { if (!plausibleDate(el.value)) return; a.date = el.value; } else { const n = parseFloat(el.value); if (!isFinite(n)) return; a.per_unit = n; }
        applyChange(st.inp, path, cur);
      } else {
        if (f.kind === "select") v = el.value;
        else if (f.kind === "date") { if ((el.validity && el.validity.badInput) || !plausibleDate(el.value)) return; v = el.value; }
        else if (f.kind === "month") { if (!/^\d{4}-\d{2}$/.test(el.value)) return; v = el.value; }
        else if (f.kind === "usd2_or_null" && el.value.trim() === "") v = null;
        else { const n = parseFloat(el.value); if (!isFinite(n)) return; v = f.kind === "pct" || f.kind === "pct4" ? n / 100 : n; }
        applyChange(st.inp, path, v);
      }
    } catch (_) { return; }
    recompute();
  }
  function markChanged() {
    const def = DEALS[st.slug];
    document.querySelectorAll("#modView .rail [data-path]").forEach((el) => {
      const p = el.dataset.path, m = p.match(/^cases\.([^.]+)\.(.+)$/);
      const a = m ? get(params(st.inp, m[1]), m[2]) : get(st.inp, p), b = m ? (def.cases[m[1]] ? get(params(def, m[1]), m[2]) : undefined) : get(def, p);
      el.classList.toggle("is-changed", JSON.stringify(a) !== JSON.stringify(b));
    });
    updateChip();
  }

  // ------------------------------------------------------------ saved scenarios (shared database, this deal's only)
  const loadedScenario = () => (st.activeScenario ? scenarios.find((x) => x.id === st.activeScenario) : null);
  function updateChip() {
    const sc = loadedScenario(), n = diffPaths(st.inp, DEALS[st.slug]).length;
    document.getElementById("scenarioChip").textContent = sc ? "Scenario: " + sc.name + (n ? "" : "") : n ? `Defaults · ${n} change${n > 1 ? "s" : ""}` : "Defaults";
  }
  function ogToast(msg, err) { const t = document.getElementById("ogToast"); if (t) { t.className = "toast" + (err ? " err" : ""); t.textContent = msg; } }
  function renderSaved() {
    const box = document.getElementById("ogSaved"); if (!box) return;
    if (!db) { box.innerHTML = `<p class="note" style="margin:0">Saving needs a signed-in claude.ai view. You can still change inputs and copy them to the repo.</p>`; return; }
    const list = scenariosFor(st.slug);
    if (!list.length) { box.innerHTML = `<p class="note" style="margin:0">No saved scenarios yet for this deal.</p>`; return; }
    box.innerHTML = list.map((s) => `<div class="item${s.id === st.activeScenario ? " active" : ""}"><span class="nm">${esc(s.name)}</span><span class="acts"><button class="link" type="button" data-load="${esc(s.id)}">Load</button><button class="link" type="button" data-del="${esc(s.id)}">Delete</button></span><span class="meta">${esc([s.summary || "", s.source === "ask" ? "built with Ask" : ""].filter(Boolean).join(" · "))}</span>${s.note ? `<span class="note">${esc(s.note)}</span>` : ""}</div>`).join("");
  }

  // ------------------------------------------------------------ main panels
  const cs = () => caseKeys(st.inp).map((k) => [k, st.res.cases[k]]);
  const yrs = (x) => (x == null ? "never" : x.toFixed(1) + " yrs");
  const x2 = (v) => (v == null ? "n/a" : v.toFixed(2) + "×");
  function renderMain() {
    renderCards(); renderChart(); renderYears(); renderChecks(); renderCost();
  }
  function renderCards() {
    const chk = st.inp.investor.check;
    document.getElementById("ogCards").innerHTML = cs().map(([k, c]) => {
      const m = c.common, d = st.defRes.cases[k] ? st.defRes.cases[k].common : null;
      const dm = d ? m.multiple - d.multiple : 0;
      const delta = Math.abs(dm) > 5e-4 ? `<span class="delta ${dm > 0 ? "pos" : "neg"}">${dm > 0 ? "+" : "−"}${Math.abs(dm).toFixed(2)}× vs defaults</span>` : "";
      return `<article class="case${k === st.detailCase ? " hl" : ""}" data-case="${k}" style="--case-color:${CASE_COLOR[k] || "var(--c-custom)"}">
        <div class="head"><span class="name">${esc(c.label)}</span></div>
        <div class="irr">${x2(m.multiple)}<small>multiple</small></div>${delta}
        <dl>
          <dt>IRR</dt><dd>${fmt.pct(m.irr)}</dd>
          <dt>After-tax IRR</dt><dd>${fmt.pct(m.after_tax_irr)}</dd>
          <dt>Profit on ${fmt.usdk(chk)}</dt><dd class="${m.profit >= 0 ? "pos" : "neg"}">${fmt.signedk(m.profit)}</dd>
          <dt>First 12 months</dt><dd>${fmt.usdk(m.first_12_months)}</dd>
          <dt>Payback</dt><dd>${yrs(m.payback_years)}</dd>
          <dt>PV10 per $1</dt><dd>${m.pv10_per_dollar == null ? "n/a" : "$" + m.pv10_per_dollar.toFixed(2)}</dd>
          <dt>EUR per well</dt><dd>${Math.round(c.wells.eur / 1000)}k BOE</dd>
        </dl></article>`;
    }).join("");
  }
  function byYear(c) {
    if (!st.afterTax) return c.common.cash_by_year;
    const a = c.after_tax;  // the same contract measure, on the after-tax flows
    return E.commonSummary(c.common.start, a.payment_dates, a.payments, a.irr).cash_by_year;
  }
  function renderChart() {
    document.querySelectorAll("#ogTaxSeg button").forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.tax === "1") === st.afterTax)));
    const chk = st.inp.investor.check;
    const series = cs().map(([k, c]) => { let cum = -chk; const pts = [cum]; byYear(c).forEach((v) => { cum += v; pts.push(cum); }); return { k, c, pts }; });
    const HY = Math.max(...series.map((s) => s.pts.length - 1), 1);
    const all = series.flatMap((s) => s.pts);
    let lo = Math.min(...all), hi = Math.max(...all, 0);
    const step = niceStep((hi - lo) / 5 || 1);
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    const W = 760, H = 280, L = 64, R = 74, T = 12, B = 30;
    const x = (i) => L + (i / HY) * (W - L - R), y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    let g = "";
    for (let v = lo; v <= hi + 1e-6; v += step) {
      g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="${Math.abs(v) < 1e-6 ? 1.5 : 1}" ${Math.abs(v) < 1e-6 ? "" : 'stroke-dasharray="2 4"'}/>`;
      g += `<text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${fmt.usdk(v)}</text>`;
    }
    const every = HY > 15 ? 5 : HY > 8 ? 2 : 1;
    for (let i = 0; i <= HY; i += every) g += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${i === 0 ? "Fund" : "Y" + i}</text>`;
    g += `<text x="${L + 6}" y="${y(0) - 6}" style="fill:var(--fg)">break-even</text>`;
    series.forEach((s) => {
      const col = CASE_COLOR[s.k] || "var(--c-custom)", w = s.k === st.detailCase ? 2.75 : 1.75;
      g += `<path d="${s.pts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("")}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linejoin="round"/>`;
      const e = s.pts.length - 1;
      g += `<circle cx="${x(e)}" cy="${y(s.pts[e])}" r="4" fill="${col}"><title>${esc(s.c.label)} after Y${e}: ${fmt.usd(s.pts[e])}</title></circle>`;
    });
    const ends = series.map((s) => ({ s, v: s.pts[s.pts.length - 1], yy: y(s.pts[s.pts.length - 1]), xx: x(s.pts.length - 1) })).sort((a, b) => a.yy - b.yy);
    for (let i = 1; i < ends.length; i++) if (ends[i].yy - ends[i - 1].yy < 14) ends[i].yy = ends[i - 1].yy + 14;
    ends.forEach((e) => { g += `<text x="${Math.min(e.xx + 8, W - R + 8)}" y="${e.yy + 4}" style="fill:${CASE_COLOR[e.s.k] || "var(--c-custom)"}">${fmt.signedk(e.v)}</text>`; });
    document.getElementById("ogChart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="min-width:520px;display:block" role="img" aria-label="Cumulative cash to the investor by case">${g}</svg>`;
    document.getElementById("ogLegend").innerHTML = series.map((s) => `<span><i style="background:${CASE_COLOR[s.k] || "var(--c-custom)"}"></i>${esc(s.c.label)}</span>`).join("");
    document.getElementById("ogChartSub").textContent = `Cumulative net cash on a ${fmt.usd(chk)} check by year from funding${st.afterTax ? ", after the tax each year's income and deductions bring (paid or saved each April)" : ", before tax"}; wells run until they stop netting cash.`;
  }
  function renderYears() {
    const k = st.detailCase, c = st.res.cases[k];
    document.getElementById("ogDetailTabs").innerHTML = caseKeys(st.inp).map((x) => `<button type="button" data-dk="${x}" aria-pressed="${x === k}">${esc(shortCase(x))}</button>`).join("");
    const pr = c.production, tax = Object.fromEntries(c.after_tax.years.map((t) => [t.year, t]));
    const wt = {};
    pr.months.forEach((m, i) => { const yv = +m.slice(0, 4); wt[yv] = wt[yv] || { b: 0, w: 0 }; wt[yv].b += pr.boe[i]; wt[yv].w += pr.boe[i] * pr.wti[i]; });
    const rows = c.annual.map((a) => { const t = tax[a.year] || {}; const w = wt[a.year] && wt[a.year].b > 0 ? wt[a.year].w / wt[a.year].b : null;
      return `<tr><td>${a.year}</td><td class="n">${Math.round(a.boe).toLocaleString("en-US")}</td><td class="n">${w == null ? "—" : "$" + w.toFixed(0)}</td><td class="n">${fmt.usd(a.rev)}</td><td class="n">${fmt.usd(a.net - a.rev)}</td><td class="n"><b>${fmt.usd(a.net)}</b></td><td class="n">${t.deduction != null ? fmt.usd(t.deduction + t.depletion) : "—"}</td><td class="n">${t.tax_cash != null ? fmt.usd(t.tax_cash) : "—"}</td><td class="n">${t.tax_cash != null ? fmt.usd(a.net + t.tax_cash) : fmt.usd(a.net)}</td></tr>`; }).join("");
    const tot = c.annual.reduce((s, a) => ({ boe: s.boe + a.boe, rev: s.rev + a.rev, net: s.net + a.net }), { boe: 0, rev: 0, net: 0 });
    const ttot = c.after_tax.years.reduce((s, t) => s + t.tax_cash, 0);
    document.getElementById("ogYears").innerHTML = `<table><thead><tr><th>Year</th><th class="n">BOE, all wells (8/8ths)</th><th class="n">WTI (avg)</th><th class="n">Our revenue</th><th class="n">Taxes, gathering, LOE, fees</th><th class="n">Our net cash</th><th class="n">Deductions</th><th class="n">Tax saved (+) / paid</th><th class="n">After tax</th></tr></thead><tbody>${rows}</tbody>
      <tfoot><tr><td>Total</td><td class="n">${Math.round(tot.boe).toLocaleString("en-US")}</td><td></td><td class="n">${fmt.usd(tot.rev)}</td><td class="n">${fmt.usd(tot.net - tot.rev)}</td><td class="n"><b>${fmt.usd(tot.net)}</b></td><td></td><td class="n">${fmt.usd(ttot)}</td><td class="n">${fmt.usd(tot.net + ttot)}</td></tr></tfoot></table>`;
    const i = c.investor;
    document.getElementById("ogYearsNote").textContent = `${c.label}: our check ${fmt.usd(i.check)} buys ${(i.wi * 100).toFixed(4)}% WI / ${(i.nri * 100).toFixed(4)}% NRI in each well. By production year; cash is paid ${st.inp.deal.pay_lag_months} month(s) later, with production before we fund paid on ${st.inp.deal.back_pay_date} (${fmt.usd(i.back_production)} here). Tax at ${fmt.pct(st.inp.investor.tax_rate, 0)}, cash in April of the next year; a negative taxable year is assumed to offset other income. Wells stop at ${c.wells.last_month || "—"} (${c.wells.life_years.toFixed(1)} years), when they no longer net cash.`;
  }
  function fmtCheck(v, f) { if (v == null) return "n/a"; return f === "x" ? v.toFixed(2) + "×" : f === "yrs" ? v.toFixed(1) + " yrs" : fmt.pct(v); }
  function renderChecks() {
    const ks = caseKeys(st.inp), qc = st.res.quick_checks;
    const why = Object.fromEntries(house().checks.map((c) => [c.id, c.why]));
    document.getElementById("ogChecks").innerHTML = `<table><thead><tr><th>Check</th>${ks.map((k) => `<th class="n">${esc(shortCase(k))}</th>`).join("")}</tr></thead><tbody>${house().checks.map((h, i) =>
      `<tr><td class="lbl" title="${esc(why[h.id] || "")}">${esc(h.label)}</td>${ks.map((k) => { const c = qc[k].checks[i], s = c.status === "n/a" ? "na" : c.status;
        const rule = h.better === "higher" ? `green ≥ ${fmtCheck(c.green, c.format)}, amber ≥ ${fmtCheck(c.amber, c.format)}` : `green ≤ ${fmtCheck(c.green, c.format)}, amber ≤ ${fmtCheck(c.amber, c.format)}`;
        return `<td class="n" title="${esc(rule + " · " + c.source)}"><span class="qc-dot qc-${s}" aria-label="${c.status}"></span>${c.value == null && h.metric === "payback_years" && c.status === "red" ? "never" : fmtCheck(c.value, c.format)}</td>`; }).join("")}</tr>`).join("")}</tbody></table>`;
  }
  function renderCost() {
    const d = st.inp.deal, c = st.res.cases[st.detailCase], u = d.turnkey_uses || {};
    const share = st.inp.investor.check / (d.units_offered * d.unit_price);
    const lab = (k) => k.replace(/_/g, " ").replace(/^./, (x) => x.toUpperCase());
    document.getElementById("ogCost").innerHTML = `<dt>Turnkey price (all units)</dt><dd>${fmt.usd(d.turnkey_price)}</dd>` +
      Object.entries(u).map(([k, v]) => `<dt>· ${esc(lab(k))}</dt><dd>${fmt.usd(v)} (${fmt.pct(v / d.turnkey_price, 0)})</dd>`).join("") +
      `<dt>Our check</dt><dd>${fmt.usd(st.inp.investor.check)} (${fmt.pct(share, 1)} of the raise)</dd>
       <dt>Our share of the operator's well costs (AFEs)</dt><dd>${fmt.usd(c.cost.at_afe)}</dd>
       <dt><b>Load: paid over that cost</b></dt><dd class="big">${fmt.pct(c.cost.load, 0)}</dd>`;
    const t = st.res.sponsor_table;
    if (!t) { document.getElementById("ogTable").innerHTML = `<p class="note">No sponsor table in this deal file.</p>`; return; }
    const tk = st.inp.sponsor_table.tickets;
    document.getElementById("ogTable").innerHTML = `<table><thead><tr><th class="n">BOE/day per well</th>${tk.map((x) => `<th class="n">${x} unit${x === 1 ? "" : "s"} / month</th>`).join("")}<th class="n">Cash on cash / yr</th></tr></thead><tbody>${t.monthly.map((r) =>
      `<tr><td class="n">${r.rate.toLocaleString("en-US")}</td>${r.by_ticket.map((v) => `<td class="n">${fmt.usd(v)}</td>`).join("")}<td class="n">${fmt.pct(r.cash_on_cash, 0)}</td></tr>`).join("")}</tbody></table>`;
    const sp = st.res.cases.sponsor, base = st.res.cases.base;
    document.getElementById("ogTableNote").textContent = `The sponsor's table rebuilt by the engine; it ties to the printed figures to the dollar (tests/test_oil_gas.py). It holds production flat at each rate and prices every BOE at $${st.inp.sponsor_table.price} with a unit NRI of ${(t.unit_nri * 100).toFixed(4)}% and a fixed ${fmt.usd(st.inp.sponsor_table.fixed_per_unit_month)} a month per unit it doesn't explain.` +
      (sp && base ? ` On our check: the sponsor's figures pay back ${fmt.usdk(sp.common.first_12_months)} in the first 12 months and ${x2(sp.common.multiple)} overall; our Base, with decline, production taxes and costs, ${fmt.usdk(base.common.first_12_months)} and ${x2(base.common.multiple)}.` : "");
  }
  function renderStatic() {
    const d = st.inp.deal, m = DEALS[st.slug].meta;
    document.getElementById("ogWells").innerHTML = `<table><thead><tr><th>Well</th><th>API</th><th>Formation</th><th class="n">AFE (gross)</th><th>Online</th></tr></thead><tbody>${d.wells.map((w) =>
      `<tr><td>${esc(w.name)}</td><td>${esc(w.api || "")}</td><td>${esc(w.formation || "")}</td><td class="n">${w.afe ? fmt.usd(w.afe) : "—"}</td><td>${esc(w.online)}</td></tr>`).join("")}</tbody></table>`;
    document.getElementById("ogWellsSub").textContent = [m.operator, m.location, `venture ${(d.venture_wi * 100).toFixed(4)}% WI / ${(d.venture_nri * 100).toFixed(4)}% NRI`].filter(Boolean).join(" · ");
    document.getElementById("ogDiligence").innerHTML = (m.diligence || []).map((x) => `<li>${esc(typeof x === "string" ? x : x.text || x.item || JSON.stringify(x))}</li>`).join("");
    document.getElementById("ogSources").innerHTML = `<table><tbody>${Object.entries(DEALS[st.slug].sources).map(([k, v]) => `<tr><td class="num small">${esc(k)}</td><td class="small">${esc(v)}</td></tr>`).join("")}</tbody></table>`;
    const f = document.querySelectorAll("#wrap .facts span");
    const facts = [`<b>${d.wells.length}</b> wells · ${esc(m.location || "")}`, esc(m.operator || ""), `Turnkey <b>${fmt.usdk(d.turnkey_price)}</b>`, `Our check <b>${fmt.usdk(st.inp.investor.check)}</b>`, esc(moduleLabel(st.slug))];
    f.forEach((el, i) => { el.innerHTML = facts[i] || ""; });
    const eb = document.getElementById("eyebrow");
    if (eb) eb.textContent = [moduleLabel(st.slug), m.status, m.sponsor].filter(Boolean).join(" · ");
  }

  // ------------------------------------------------------------ events
  function bind() {
    const root = document.getElementById("modView");
    root.addEventListener("input", (e) => { if (e.target.closest(".rail") && e.target.matches("input[type=number],input[type=month]")) onField(e.target); });
    root.addEventListener("change", (e) => { if (e.target.closest(".rail") && e.target.matches("select,input[type=date]")) { onField(e.target); if (e.target.matches("select")) renderRail(); } });
    root.addEventListener("focusout", (e) => { if (e.target.matches("#ogCaseFields input,#ogDealFields input")) markChanged(); });
    root.addEventListener("click", async (e) => {
      const t = e.target;
      const ck = t.closest("#ogCaseTabs button[data-ogk]"); if (ck) { st.editCase = ck.dataset.ogk; renderRail(); return; }
      const dk = t.closest("#ogDetailTabs button[data-dk]"); if (dk) { st.detailCase = dk.dataset.dk; renderMain(); return; }
      const card = t.closest("#ogCards .case[data-case]"); if (card) { st.detailCase = st.editCase = card.dataset.case; renderRail(); renderMain(); return; }
      const tx = t.closest("#ogTaxSeg button"); if (tx) { st.afterTax = tx.dataset.tax === "1"; renderChart(); return; }
      if (t.closest("[data-aadd]")) {
        const path = t.closest("[data-path]").dataset.path, cur = clone(get(params(st.inp, st.editCase), "assessments") || []);
        cur.push({ date: E.addMonths(st.inp.deal.fund_date, 6), per_unit: 50000 }); applyChange(st.inp, path, cur); renderRail(); recompute(); return;
      }
      const arm = t.closest("[data-arm]");
      if (arm) { const path = t.closest("[data-path]").dataset.path, cur = clone(get(params(st.inp, st.editCase), "assessments") || []); cur.splice(+arm.dataset.arm, 1); applyChange(st.inp, path, cur); renderRail(); recompute(); return; }
      if (t.closest("#ogReset")) { st.inp = clone(DEALS[st.slug]); st.activeScenario = null; renderRail(); recompute(); return; }
      if (t.closest("#ogCopy")) {
        const o = clone(st.inp); o.as_of = new Date().toISOString().slice(0, 10);
        const txt = JSON.stringify(o, null, 2) + "\n", tt = document.getElementById("ogCopyToast");
        try { await navigator.clipboard.writeText(txt); tt.textContent = `Copied. Paste over deals/${st.slug}/deal.json in the repo.`; } catch (_) { tt.textContent = "Couldn't copy here."; }
        return;
      }
      if (t.closest("#ogSave")) {
        const nm = document.getElementById("ogSaveName").value.trim();
        if (!db) { ogToast("Saving needs a signed-in view.", true); return; }
        if (!nm) { ogToast("Name the scenario first.", true); return; }
        try { const ref = await addScenario(st.inp, st.slug, nm); st.activeScenario = ref && ref.id ? ref.id : null; document.getElementById("ogSaveName").value = ""; ogToast(`Saved “${nm}”.`); persist(); } catch (err) { ogToast("Couldn't save: " + ((err && (err.message || err.code)) || "error"), true); }
        return;
      }
      const ld = t.closest("[data-load]");
      if (ld) { const sc = scenarios.find((x) => x.id === ld.dataset.load); if (sc) { try { load(scenarioInputs(sc, st.slug), sc.id); } catch (_) {} } return; }
      const dl = t.closest("[data-del]");
      if (dl) {
        if (!dl.dataset.confirm) { dl.dataset.confirm = "1"; dl.textContent = "Confirm delete"; setTimeout(() => { if (dl.isConnected) { delete dl.dataset.confirm; dl.textContent = "Delete"; } }, 4000); return; }
        try { await db.collection("scenarios").doc(dl.dataset.del).delete(); if (st.activeScenario === dl.dataset.del) st.activeScenario = null; } catch (err) { ogToast("Couldn't delete: " + ((err && (err.message || err.code)) || "error"), true); }
      }
    });
  }
  function goToInput(path) {
    const m = String(path).match(/^cases\.([^.]+)\./);
    if (m && st.inp.cases[m[1]] && m[1] !== st.editCase) { st.editCase = m[1]; renderRail(); }
    const host = [...document.querySelectorAll("#modView .rail [data-path]")].find((el) => path === el.dataset.path || path.startsWith(el.dataset.path + "."));
    if (!host) return;
    host.scrollIntoView({ block: "center" });
    const inp = host.querySelector("input,select"); if (inp) inp.focus();
    host.classList.add("flash"); setTimeout(() => host.classList.remove("flash"), 1200);
  }
  function inputLink(path, label, slug) {
    const ok = (() => { try { const inp = clone(DEALS[slug]); applyChange(inp, path, get(/^cases\./.test(path) ? params(inp, path.split(".")[1]) : inp, path.replace(/^cases\.[^.]+\./, "")) ?? 0); return true; } catch (_) { return false; } })();
    return ok ? `<button type="button" class="edit-link" data-edit="${esc(path)}" data-deal="${esc(slug)}" title="Change this in the panel">${label}<span class="pencil" aria-hidden="true">✎</span></button>` : label;
  }

  // ------------------------------------------------------------ Ask tools (the oil & gas versions)
  const r2 = (x) => (x == null || !isFinite(x) ? null : Math.round(x * 100) / 100);
  function caseOut(c) {
    const m = c.common;
    return { case: c.key, label: c.label, note: c.note, multiple: r4(m.multiple), irr: r4(m.irr), after_tax_irr: r4(m.after_tax_irr), profit: r0(m.profit),
      after_tax_profit: r0(m.after_tax_profit), paid_in: r0(m.paid_in), first_12_months: r0(m.first_12_months), payback: m.payback, payback_years: r2(m.payback_years),
      pv10: r0(m.pv10), pv10_per_dollar: r4(m.pv10_per_dollar), back_production: r0(c.investor.back_production), eur_per_well_boe: r0(c.wells.eur),
      wells_stop: c.wells.last_month, load_over_afe: r4(c.cost.load), year1_tax_cash: r0((c.after_tax.years[0] || {}).tax_cash) };
  }
  const METRICS = { irr: (c) => c.common.irr, after_tax_irr: (c) => c.common.after_tax_irr, multiple: (c) => c.common.multiple, profit: (c) => c.common.profit,
    after_tax_profit: (c) => c.common.after_tax_profit, pv10_per_dollar: (c) => c.common.pv10_per_dollar, payback_years: (c) => c.common.payback_years,
    first_12_months: (c) => c.common.first_12_months, our_irr: (c) => c.common.irr, lp_irr: (c) => c.common.irr, our_profit: (c) => c.common.profit, lp_multiple: (c) => c.common.multiple };
  function metric(M, c) { const f = METRICS[M]; if (!f) throw new Error(`For oil & gas use metric: ${Object.keys(METRICS).slice(0, 8).join(", ")}`); return f(c); }
  function withChanges(slug, changes, scenario) {
    const inp = clone(baseInputs(slug, scenario));
    Object.entries(changes || {}).forEach(([p, v]) => applyChange(inp, p, v));
    return inp;
  }
  const using = (slug, scenario) => (scenario ? `saved scenario "${findScenario(slug, scenario).name}"` : isEdited(slug) ? "the viewer's current edits" : "the deal file as underwritten");
  const tools = {
    get_deal: ({ deal, scenario }) => {
      const slug = deal, inp = baseInputs(slug, scenario), m = DEALS[slug].meta, res = runAll(inp);
      setAskStatus(`Reading ${m.name}…`);
      return { deal: slug, name: m.name, asset_class: moduleLabel(slug), sponsor: m.sponsor, operator: m.operator, location: m.location, vehicle: m.vehicle, status: m.status, summary: m.summary,
        using: using(slug, scenario), our_check: inp.investor.check, tax_rate: inp.investor.tax_rate, fund_date: inp.deal.fund_date,
        venture: { wi: inp.deal.venture_wi, nri: inp.deal.venture_nri, units_offered: inp.deal.units_offered, unit_price: inp.deal.unit_price, turnkey_price: inp.deal.turnkey_price, turnkey_uses: inp.deal.turnkey_uses, afe_gross_total: inp.deal.afe_gross_total, wells: inp.deal.wells },
        cases: Object.values(res.cases).map(caseOut),
        quick_checks: Object.fromEntries(Object.entries(res.quick_checks).map(([k, q]) => [k, q.checks.map((c) => ({ check: c.label, value: r4(c.value), status: c.status }))])),
        sponsor_table: res.sponsor_table ? { unit_nri: res.sponsor_table.unit_nri, monthly_one_unit: res.sponsor_table.monthly.map((r) => ({ boe_per_day_per_well: r.rate, per_month: r0(r.by_ticket[1]), cash_on_cash: r4(r.cash_on_cash) })), note: "rebuilt from the printed table; it holds production flat and has no production taxes or LOE" } : null,
        diligence: m.diligence || [] };
    },
    get_case_years: ({ deal, scenario, case: k, changes }) => {
      const inp = changes ? withChanges(deal, changes, scenario) : baseInputs(deal, scenario), ck = needCase(inp, k), c = OG.runCase(ck, inp);
      setAskStatus(`Reading ${DEALS[deal].meta.name} · ${c.label} by year…`);
      const tax = Object.fromEntries(c.after_tax.years.map((t) => [t.year, t]));
      return { case: ck, label: c.label, assumptions: params(inp, ck), note: "By production year; cash is paid after a lag. tax_cash: + saved, − paid, in April of the next year.",
        years: c.annual.map((a) => ({ year: a.year, boe_all_wells: r0(a.boe), our_revenue: r0(a.rev), our_net_cash: r0(a.net), deductions: tax[a.year] ? r0(tax[a.year].deduction + tax[a.year].depletion) : null, tax_cash: tax[a.year] ? r0(tax[a.year].tax_cash) : null })),
        payments: c.investor.payment_dates.map((d, i) => ({ date: d, amount: r0(c.investor.payments[i]) })).slice(0, 40), summary: caseOut(c) };
    },
    list_inputs: ({ deal, scenario, case: k }) => {
      const inp = baseInputs(deal, scenario), ks = k ? [needCase(inp, k)] : caseKeys(inp);
      setAskStatus(`Listing inputs for ${DEALS[deal].meta.name}…`);
      return { how_to_change: "Paths: deal-level as listed; a case's as cases.<case>.<path> (e.g. cases.base.production.rate, cases.downside.wti.long_term, cases.base.wti.years.2027, cases.base.tax.year1_deductible, cases.stress.assessments = [{date, per_unit}]). A derived case (from) inherits until you set its own. Rates and shares are decimals.",
        deal_inputs: Object.fromEntries(catFields("deal").map((f) => [f.path, { label: f.label, value: get(inp, f.path), help: f.help || undefined }])),
        cases: ks.map((c) => ({ case: c, label: inp.cases[c].label, from: inp.cases[c].from || null, note: inp.cases[c].note || "", inputs: Object.fromEntries(catFields("case").map((f) => [`cases.${c}.${f.path}`, { label: f.label, value: get(params(inp, c), f.path) === undefined ? null : get(params(inp, c), f.path) }])) })),
        not_editable: catalog().not_editable };
    },
    run_what_if: ({ deal, scenario, case: k, changes, label }) => {
      const base = baseInputs(deal, scenario), after = withChanges(deal, changes || {}, scenario);
      const ks = String(k) === "all" ? caseKeys(base) : [needCase(base, k)];
      setAskStatus(`Running ${label || "a what-if"} on ${DEALS[deal].meta.name}…`);
      askWhatIfs.push({ slug: deal, scenario: scenario ? findScenario(deal, scenario).name : null, changes: changes || {}, customFrom: null, label: String(label || Object.keys(changes || {}).join(", ")).slice(0, 80) });
      const results = ks.map((c) => ({ before: caseOut(OG.runCase(c, base)), after: caseOut(OG.runCase(c, after)) }));
      const warnings = results.every((x) => JSON.stringify(x.before) === JSON.stringify(x.after)) ? ["These changes did not move any result for the case(s) shown; check list_inputs for the path, or whether another case inherits it."] : [];
      return { deal, changes, results, warnings };
    },
    sweep: ({ deal, scenario, case: k, metric: M, path, values, path2, values2, other_changes }) => {
      const ck = needCase(baseInputs(deal, scenario), k);
      const v1 = (values || []).map(Number).filter(isFinite).slice(0, 15), v2 = path2 ? (values2 || []).map(Number).filter(isFinite).slice(0, 15) : [null];
      setAskStatus(`Sweeping ${path} on ${DEALS[deal].meta.name}…`);
      const at = (a, b) => metric(M, OG.runCase(ck, withChanges(deal, Object.assign({}, other_changes || {}, { [path]: a }, path2 ? { [path2]: b } : {}), scenario)));
      return { deal, case: ck, metric: M, rows: path, columns: path2 || null, table: v1.map((a) => ({ [path]: a, results: v2.map((b) => (path2 ? { [path2]: b, value: at(a, b) } : { value: at(a, null) })) })) };
    },
    solve_for: ({ deal, scenario, case: k, path, metric: M, target, low, high, other_changes }) => {
      const ck = needCase(baseInputs(deal, scenario), k), T = Number(target);
      let lo = Number(low), hi = Number(high);
      setAskStatus(`Solving ${path} on ${DEALS[deal].meta.name}…`);
      const at = (v) => metric(M, OG.runCase(ck, withChanges(deal, Object.assign({}, other_changes || {}, { [path]: v }), scenario)));
      let flo = at(lo), fhi = at(hi);
      if (flo == null || fhi == null) throw new Error(`${M} is undefined at an end of the range; narrow it`);
      if ((flo - T) * (fhi - T) > 0) return { found: false, note: "target is outside what the range produces", at_low: { value: lo, result: flo }, at_high: { value: hi, result: fhi } };
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2, fm = at(mid); if (fm == null) break;
        if ((flo - T) * (fm - T) <= 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
        if (Math.abs(hi - lo) < 1e-7 * Math.max(1, Math.abs(lo))) break;
      }
      const v = (lo + hi) / 2;
      askWhatIfs.push({ slug: deal, scenario: scenario ? findScenario(deal, scenario).name : null, changes: Object.assign({}, other_changes || {}, { [path]: v }), customFrom: null, label: `${path} = ${+v.toPrecision(5)}` });
      return { found: true, path, value: +v.toPrecision(6), metric: M, achieved: at(v), target: T };
    },
    propose_scenario: ({ deal, scenario, name, description, changes, replaces }) => {
      if (replaces && !scenario) scenario = replaces;
      const base = baseInputs(deal, scenario), inp = withChanges(deal, changes || {}, scenario);
      setAskStatus(`Building "${name}"…`);
      const res = caseKeys(inp).map((c) => { const b = OG.runCase(c, base).common, a = OG.runCase(c, inp).common; return { case: c, label: inp.cases[c].label, before: b.irr, after: a.irr, our_irr_after: a.after_tax_irr }; });
      askWhatIfs.push({ slug: deal, scenario: scenario ? findScenario(deal, scenario).name : null, replaces: replaces ? findScenario(deal, replaces).name : null, changes: changes || {}, customFrom: null, label: String(name).slice(0, 80), proposal: true, description: String(description || "").slice(0, 600), res });
      return { staged: true, name, irr_by_case: res.map((x) => ({ case: x.case, before: r4(x.before), after: r4(x.after), after_tax_after: r4(x.our_irr_after) })), note: "On the card, 'LP IRR' is the pre-tax IRR on the investor's cash and the last column the after-tax IRR." };
    },
    get_quick_checks: ({ deal, scenario, case: k }) => {
      const inp = baseInputs(deal, scenario), res = runAll(inp), ks = k ? [needCase(inp, k)] : caseKeys(inp);
      return { house_rules: house().checks.map((c) => ({ id: c.id, label: c.label, better: c.better, green: c.green, amber: c.amber, why: c.why })),
        cases: Object.fromEntries(ks.map((c) => [c, res.quick_checks[c].checks.map((x) => ({ id: x.id, value: r4(x.value), status: x.status }))])) };
    },
  };
  // a scenario's one-line summary, Compare and list_scenarios rows
  function summary(inp) {
    const res = runAll(inp), b = res.cases.base || res.cases[caseKeys(inp)[0]];
    return `${b.label} ${x2(b.common.multiple)} · ${fmt.pct(b.common.irr)} · after tax ${fmt.pct(b.common.after_tax_irr)}`;
  }
  function scenarioRow(inp) {
    const res = runAll(inp);
    return { irr_by_case: Object.fromEntries(Object.entries(res.cases).map(([k, c]) => [k, r4(c.common.irr)])), multiple_by_case: Object.fromEntries(Object.entries(res.cases).map(([k, c]) => [k, r4(c.common.multiple)])) };
  }
  function compareSummary(d) {
    return { deal: d.slug, name: d.meta.name, asset_class: moduleLabel(d.slug), version: d.version, status: d.meta.status, using_edits: d.edited,
      our_check: d.inp.investor.check, load_over_afe: r4((Object.values(d.cases)[0] || {}).cost ? Object.values(d.cases)[0].cost.load : null),
      open_diligence: (d.meta.diligence || []).length,
      cases: Object.fromEntries(Object.entries(d.cases).map(([k, c]) => [k, { label: c.label, irr: r4(c.common.irr), after_tax_irr: r4(c.common.after_tax_irr), multiple: r4(c.common.multiple),
        payback_years: r2(c.common.payback_years), pv10_per_dollar: r4(c.common.pv10_per_dollar), profit_per_1m: r0(c.common.profit * 1e6 / d.inp.investor.check) }])) };
  }
  function compareContext(d) {
    const dl = d.inp.deal, c = d.cases.base || Object.values(d.cases)[0];
    return [["Asset", `<span title="${esc([moduleLabel(d.slug), d.meta.operator, d.meta.location].filter(Boolean).join(" · "))}">${esc(moduleLabel(d.slug).replace(/\s*\(.*\)$/, ""))}</span>`],
      ["Wells", String(dl.wells.length)], ["Our interest (WI / NRI)", c ? `${(c.investor.wi * 100).toFixed(3)}% / ${(c.investor.nri * 100).toFixed(3)}%` : "—"],
      ["Sponsor's load over well cost", c ? fmt.pct(c.cost.load, 0) : "—"], ["How long the money is out", c ? `${c.wells.life_years.toFixed(0)} yrs in ${esc(c.label)} (wells deplete; no sale)` : "—"]];
  }
  const askChips = (slug) => [
    `Summarize ${DEALS[slug].meta.name} for a partner in one paragraph, with our Base and Downside.`,
    "What current rate per well and decline make our Base return 1.5×?",
    "How much of the after-tax return depends on the 85% deduction? Run it at 30%, 50% and 85%.",
    "At what long-term oil price does our Base just return our money?",
    "What is the sponsor's load costing us, in dollars and IRR points?",
  ];
  const askContextLine = (slug) => `an oil & gas working interest bought through a general-partnership joint venture. Its tools: ${Object.keys(tools).join(", ")} (plus get_sources, list_scenarios, compare_deals). Measures: multiple, IRR and after-tax IRR on the investor's dated cash, payback, PV10 per dollar, first-12-month cash, EUR per well, the sponsor's load over the operator's AFE cost. sweep / solve_for metrics: irr, after_tax_irr, multiple, profit, after_tax_profit, pv10_per_dollar, payback_years, first_12_months. Inputs by path from list_inputs (cases.<case>.production.rate, .production.di, .wti.long_term, .tax.year1_deductible, ...). There is no vehicle, waterfall or sale: wells deplete and the investor holds a direct interest.`;

  window.MODULE_VIEWS[KEY] = { key: KEY, engine: OG, open, load, goToInput, inputLink, withChanges, tools, summary, scenarioRow, compareSummary, compareContext,
    askChips, askContextLine, onScenarios: () => { if (st.slug && SHOWN === st.slug) { renderSaved(); updateChip(); } }, state: () => st };
})();
