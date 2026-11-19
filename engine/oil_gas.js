/* LTEC deal engine — oil & gas module (#46), JavaScript.
 * Line-for-line port of engine/oil_gas.py. Keep the two in sync; tests/test_oil_gas.py runs both on the deal file
 * and randomized inputs and fails on any difference. Works in the browser (window.OilGasEngine, after core.js)
 * and in Node (module.exports).
 */
(function (root) {
  "use strict";
  const core = typeof module !== "undefined" && module.exports ? require("./core.js") : root.DealEngine;
  const { addMonths, mergeDeep } = core;
  const CASE_META = ["label", "note", "from"];
  const IRR_GRID = [-0.9, -0.75, -0.5, -0.25, 0.0, 0.25, 0.5, 1.0, 2.0, 4.0, 10.0];
  const sum = (a) => a.reduce((s, x) => s + x, 0);
  const pad = (n, w) => String(n).padStart(w, "0");
  function toDay(iso) { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d) / 86400000; }

  function xirr(flows, dates) {
    if (!flows.some((cf) => cf < -1e-9) || !flows.some((cf) => cf > 1e-9)) return null;
    const d0 = toDay(dates[0]);
    const yrs = dates.map((d) => (toDay(d) - d0) / 365);
    const f = (r) => flows.reduce((s, cf, i) => s + cf / Math.pow(1 + r, yrs[i]), 0);
    const vals = IRR_GRID.map(f);
    let best = -1;
    for (let i = 0; i < IRR_GRID.length - 1; i++) {
      if (vals[i] * vals[i + 1] < 0 || vals[i + 1] === 0) best = i;
    }
    if (best < 0) return vals[0] === 0 ? IRR_GRID[0] : null;
    if (vals[best + 1] === 0) return IRR_GRID[best + 1];
    let lo = IRR_GRID[best], hi = IRR_GRID[best + 1], fLo = vals[best];
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2, fMid = f(mid);
      if (Math.abs(fMid) < 1e-9) return mid;
      if (fLo * fMid < 0) hi = mid; else { lo = mid; fLo = fMid; }
    }
    return (lo + hi) / 2;
  }

  // ------------------------------------------------------------ months and dates
  const monthIndex = (iso) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;
  const monthKey = (mi) => `${pad(Math.floor(mi / 12), 4)}-${pad((mi % 12) + 1, 2)}`;
  const daysInMonth = (mi) => new Date(Date.UTC(Math.floor(mi / 12), (mi % 12) + 1, 0)).getUTCDate();
  const payDate = (mi, day) => `${monthKey(mi)}-${pad(Math.min(day, daysInMonth(mi)), 2)}`;

  // ------------------------------------------------------------ cases
  function caseParams(inp, key) {
    const c = inp.cases[key];
    const own = {};
    Object.entries(c).forEach(([k, v]) => { if (!CASE_META.includes(k)) own[k] = v; });
    if (c.from) return mergeDeep(caseParams(inp, c.from), own);
    return JSON.parse(JSON.stringify(own));
  }
  function wellShape(t, b, di, dmin) {
    if (di <= 0) return 1.0;
    if (b <= 0) return Math.exp(-di * t);
    const ts = dmin > 0 && di > dmin ? (di / dmin - 1) / (b * di) : Infinity;
    if (t <= ts) return Math.pow(1 + b * di * t, -1 / b);
    return Math.pow(1 + b * di * ts, -1 / b) * Math.exp(-dmin * (t - ts));
  }
  function wtiAt(p, mi) {
    const w = p.wti, k = monthKey(mi);
    const hist = w.history || {};
    if (k in hist) return hist[k];
    const ys = w.years || {}, y = String(Math.floor(mi / 12));
    return y in ys ? ys[y] : w.long_term;
  }
  function realizedPrice(p, wti) {
    const oil = wti - p.differential;
    const other = p.gas_ngl_price == null ? oil : p.gas_ngl_price;
    return p.oil_share * oil + (1 - p.oil_share) * other;
  }
  function shares(inp) {
    const d = inp.deal, chk = inp.investor.check;
    const raiseTotal = d.units_offered * d.unit_price;
    const s = chk / raiseTotal;
    return { of_raise: s, units: chk / d.unit_price,
      wi: d.venture_wi * (1 - d.manager_share) * s,
      nri: d.venture_nri * (1 - d.manager_share) * s };
  }

  // ------------------------------------------------------------ one case
  function runCase(key, inp) {
    const d = inp.deal, inv = inp.investor;
    const p = caseParams(inp, key);
    const pr = p.production;
    const sh = shares(inp);
    const wells = d.wells;
    const on = wells.map((w) => monthIndex(w.online));
    const onDay = wells.map((w) => Number(w.online.slice(8, 10)));
    const m0 = Math.min(...on), n = d.horizon_months;
    const b = pr.b, di = pr.di, dmin = pr.dmin;
    const tOf = (k, mi) => (mi - on[k] + 0.5) / 12;

    const rm = monthIndex(pr.rate_month);
    const live = wells.map((w, k) => k).filter((k) => on[k] <= rm);
    let avg;
    if (live.length) {
      avg = sum(live.map((k) => wellShape(tOf(k, rm), b, di, dmin))) / live.length;
    } else {
      avg = wellShape(0.5 / 12, b, di, dmin);
    }
    const qi = pr.rate / avg;

    const months = [], boe = [], wellsOn = [];
    for (let j = 0; j < n; j++) {
      const mi = m0 + j;
      const dim = daysInMonth(mi);
      let v = 0.0, cnt = 0;
      for (let k = 0; k < wells.length; k++) {
        if (mi < on[k]) continue;
        const days = mi === on[k] ? dim - onDay[k] + 1 : dim;
        v += qi * wellShape(tOf(k, mi), b, di, dmin) * days;
        cnt += 1;
      }
      months.push(mi);
      boe.push(v);
      wellsOn.push(cnt);
    }

    const wti = [], price = [], rev = [], ptax = [], gath = [], loe = [], fees = [], net = [];
    const feeM = d.monthly_management_fee * sh.of_raise + (p.fixed_per_unit_month || 0.0) * sh.units;
    for (let j = 0; j < n; j++) {
      const w = wtiAt(p, months[j]);
      const r = realizedPrice(p, w);
      const rv = boe[j] * sh.nri * r;
      const tx = rv * p.production_tax;
      const g = boe[j] * sh.nri * p.gathering;
      const lo = (boe[j] * p.loe_per_boe + wellsOn[j] * p.loe_per_well_month) * sh.wi;
      wti.push(w);
      price.push(r);
      rev.push(rv);
      ptax.push(tx);
      gath.push(g);
      loe.push(lo);
      fees.push(feeM);
      net.push(rv - tx - g - lo - feeM);
    }
    let last = -1;
    for (let j = 0; j < n; j++) if (net[j] > 0) last = j;
    for (let j = last + 1; j < n; j++) {
      boe[j] = rev[j] = ptax[j] = gath[j] = loe[j] = fees[j] = net[j] = 0.0;
      wellsOn[j] = 0;
    }

    const fund = d.fund_date;
    const flows = { [fund]: -inv.check };
    for (let j = 0; j <= last; j++) {
      const pd = payDate(months[j] + d.pay_lag_months, d.pay_day);
      const dt = pd > d.back_pay_date ? pd : d.back_pay_date;
      flows[dt] = (flows[dt] || 0.0) + net[j];
    }
    let assessTotal = 0.0;
    (p.assessments || []).forEach((a) => {
      const amt = a.per_unit * sh.units;
      flows[a.date] = (flows[a.date] || 0.0) - amt;
      assessTotal += amt;
    });
    const preDates = Object.keys(flows).sort();
    const pre = preDates.map((x) => flows[x]);

    const txP = p.tax;
    const y0 = Number(fund.slice(0, 4));
    const yFirst = Math.min(y0, Math.floor(months[0] / 12)), yLast = Math.floor(months[Math.max(last, 0)] / 12);
    const years = [];
    for (let y = yFirst; y <= yLast; y++) years.push(y);
    const byY = {};
    years.forEach((y) => { byY[y] = { boe: 0.0, rev: 0.0, net: 0.0 }; });
    for (let j = 0; j <= last; j++) {
      const y = Math.floor(months[j] / 12);
      byY[y].boe += boe[j];
      byY[y].rev += rev[j];
      byY[y].net += net[j];
    }
    let basis = inv.check * (1 - txP.year1_deductible);
    const pct = txP.percentage_depletion || 0.0;
    const taxRows = [], taxFlows = {};
    years.forEach((y) => {
      if (y < y0) return;
      let ded = y === y0 ? inv.check * txP.year1_deductible : 0.0;
      ded += sum((p.assessments || []).filter((a) => Number(a.date.slice(0, 4)) === y).map((a) => a.per_unit * sh.units));
      let cost;
      if (txP.rest === "next_year") {
        cost = y === y0 + 1 ? basis : 0.0;
      } else {
        const remaining = sum(years.filter((z) => z >= y).map((z) => byY[z].boe));
        cost = remaining > 0 ? basis * byY[y].boe / remaining : 0.0;
      }
      const pctd = Math.min(pct * byY[y].rev, Math.max(byY[y].net, 0.0));
      const dep = txP.rest !== "next_year" ? Math.max(cost, pctd) : cost + pctd;
      if (txP.rest !== "next_year") basis = Math.max(basis - dep, 0.0);
      const taxable = byY[y].net - ded - dep;
      const cash = -taxable * inv.tax_rate;
      const dt = `${y + 1}-04-15`;
      taxFlows[dt] = (taxFlows[dt] || 0.0) + cash;
      taxRows.push({ year: y, net_income: byY[y].net, deduction: ded, depletion: dep, taxable, tax_cash: cash, paid_on: dt });
    });
    const post = Object.assign({}, flows);
    Object.entries(taxFlows).forEach(([k2, v2]) => { post[k2] = (post[k2] || 0.0) + v2; });
    const postDates = Object.keys(post).sort();
    const postCf = postDates.map((x) => post[x]);

    function metrics(dates, cf) {
      let cum = 0.0, payback = null;
      dates.forEach((x, i) => {
        cum += cf[i];
        if (payback === null && x > fund && cum >= -0.005) payback = x;
      });
      return { irr: xirr(cf, dates), profit: sum(cf), payback };
    }
    const mPre = metrics(preDates, pre), mPost = metrics(postDates, postCf);
    const paidIn = inv.check + assessTotal;
    const got = sum(pre.filter((c) => c > 0));
    const yr12 = addMonths(fund, 12);
    const first12 = sum(pre.filter((c, i) => preDates[i] > fund && preDates[i] <= yr12 && c > 0));
    const back = d.back_pay_date > fund ? (flows[d.back_pay_date] || 0.0) : 0.0;
    const d0 = toDay(fund);
    const pv10 = sum(preDates.map((x, i) => [x, pre[i]]).filter(([x]) => x > fund).map(([x, c]) => c / Math.pow(1.1, (toDay(x) - d0) / 365)));
    let eur = 0;
    for (let a = 0; a <= last; a++) eur += wellShape((a + 0.5) / 12, b, di, dmin) * 365 / 12;
    eur = qi * eur;
    const costShare = d.afe_gross_total * d.venture_wi * (1 - d.manager_share) * sh.of_raise;
    return {
      key, label: inp.cases[key].label, note: inp.cases[key].note || "",
      params: p,
      wells: { ip: qi, eur, last_month: last >= 0 ? monthKey(months[last]) : null, life_years: (last + 1) / 12 },
      production: { months: months.map(monthKey), boe, wells_on: wellsOn, wti, price, revenue: rev, production_tax: ptax,
        gathering: gath, loe, fees, net },
      annual: years.map((y) => Object.assign({ year: y }, byY[y])),
      investor: { check: inv.check, assessments: assessTotal, paid_in: paidIn, payment_dates: preDates, payments: pre,
        total: got, multiple: got / paidIn, profit: mPre.profit, irr: mPre.irr, payback: mPre.payback,
        first_12_months: first12, back_production: back, pv10, pv10_per_dollar: pv10 / paidIn, wi: sh.wi, nri: sh.nri },
      after_tax: { payment_dates: postDates, payments: postCf, irr: mPost.irr, profit: mPost.profit, payback: mPost.payback,
        years: taxRows },
      cost: { at_afe: costShare, load: costShare > 0 ? inv.check / costShare - 1 : null },
    };
  }

  // ------------------------------------------------------------ the sponsor's conversion table
  function sponsorTable(inp) {
    const t = inp.sponsor_table, d = inp.deal;
    const nriU = d.venture_nri / d.units_offered;
    const unit = d.unit_price;
    const risk = unit * (1 - t.deductible * t.tax_rate);
    const monthly = t.rates.map((r) => {
      const one = Math.max(r * t.wells * 365 / 12 * t.price * nriU - t.fixed_per_unit_month, 0.0);
      return { rate: r, by_ticket: t.tickets.map((u) => one * u), cash_on_cash: one * 12 / unit, with_tax: one * 12 / risk };
    });
    const totals = t.totals.map((v) => {
      const one = v * t.wells * t.price * nriU;
      return { boe: v, by_ticket: t.tickets.map((u) => one * u), roi: one / unit, with_tax: one / risk };
    });
    return { unit_nri: nriU, risk_capital: risk, tax_saving: unit - risk, monthly, totals };
  }

  function runAll(inp) {
    const cases = {};
    Object.keys(inp.cases).forEach((k) => { cases[k] = runCase(k, inp); });
    return { inputs_version: inp.version == null ? null : inp.version, asset_class: "oil_gas", cases,
      sponsor_table: inp.sponsor_table ? sponsorTable(inp) : null };
  }

  const api = { runAll, runCase, caseParams, sponsorTable, wellShape, xirr };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OilGasEngine = api;
})(typeof window !== "undefined" ? window : this);
