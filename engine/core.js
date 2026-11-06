/* LTEC deal engine — JavaScript engine.
 * Line-for-line port of engine/core.py. Keep the two in sync; tests/test_parity.py
 * runs both on every deal's defaults and randomized inputs and fails on any difference.
 * Works in the browser (window.DealEngine) and in Node (module.exports).
 */
(function (root) {
  "use strict";
  // The hold the sponsor underwrote (the year its sale and explicit rows end on).
  const uwYears = (deal) => Math.trunc(deal.underwritten_hold_years);

  // ------------------------------------------------------------ math helpers
  function npv(rate, flows) {
    let s = 0;
    for (let t = 0; t < flows.length; t++) s += flows[t] / Math.pow(1 + rate, t);
    return s;
  }
  function bisect(f) {
    let lo = -0.9999, hi = 10.0, fLo = f(lo), fHi = f(hi);
    if (fLo * fHi > 0) return null;
    for (let i = 0; i < 300; i++) {
      const mid = (lo + hi) / 2, fMid = f(mid);
      if (Math.abs(fMid) < 1e-9) return mid;
      if (fLo * fMid < 0) { hi = mid; fHi = fMid; } else { lo = mid; fLo = fMid; }
    }
    return (lo + hi) / 2;
  }
  function irr(flows) { return bisect((r) => npv(r, flows)); }

  // dates are ISO strings "YYYY-MM-DD"; day counts in UTC to avoid DST drift
  function toDay(iso) { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d) / 86400000; }
  function fromDay(n) { return new Date(n * 86400000).toISOString().slice(0, 10); }
  function xirr(flows, dates) {
    if (!flows.some((cf) => cf < -1e-9) || !flows.some((cf) => cf > 1e-9)) return null;
    const d0 = toDay(dates[0]);
    const yrs = dates.map((d) => (toDay(d) - d0) / 365);
    return bisect((r) => flows.reduce((s, cf, i) => s + cf / Math.pow(1 + r, yrs[i]), 0));
  }
  function addMonths(iso, months) {
    const [y, m, d] = iso.split("-").map(Number);
    const total = m - 1 + months;
    const ny = y + Math.floor(total / 12), nm = (total % 12 + 12) % 12;
    const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
    return fromDay(Date.UTC(ny, nm, Math.min(d, lastDay)) / 86400000);
  }
  const sum = (a) => a.reduce((s, x) => s + x, 0);

  // ------------------------------------------------------------ operations
  // ------------------------------------------------------------ hold period, refinance (see core.py)
  const holdYears = (deal) => Math.trunc(deal.hold_years);
  function grow(series, n, rate) {
    const out = series.slice();
    while (out.length < n) { const g = typeof rate === "function" ? rate(out.length) : rate; out.push(out[out.length - 1] * (1 + g)); }
    return out;
  }
  function caseCapBasis(c, deal, nxt5) {
    if (c.kind === "explicit") return nxt5 / ((c.net_sale_proceeds + deal.loan_amount) / (1 - deal.selling_cost_pct));
    return c.exit_cap;
  }

  function merge(base, ov) {
    const out = Object.assign({}, base);
    Object.keys(ov).forEach((k) => {
      const v = ov[k];
      out[k] = v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object" && !Array.isArray(base[k]) ? merge(base[k], v) : v;
    });
    return out;
  }
  // The deal as one case sees it: deal inputs with that case's deal_overrides merged in (see core.py).
  function caseDeal(inp, key) {
    const ov = inp.cases[key].deal_overrides;
    return ov ? merge(inp.deal, ov) : inp.deal;
  }
  // Rents, other income, opex and CapEx for years 1..n; 'derived' cases adjust another case's lines (see core.py).
  function caseLines(c, deal, n, cases) {
    if (c.kind === "derived") {
      const [r, o, x, cx] = caseLines(cases[c.from], deal, n, cases);
      const path = (base, mode, g, factor) => {
        const out = [base[0] * factor];
        for (let i = 1; i < n; i++) out.push(mode === "growth" ? out[i - 1] * (1 + g) : base[i] * factor);
        return out;
      };
      const adj = c.rent_adjust;
      const r2 = path(r, c.rent_path, c.rent_growth, c.rent_factor).map((v, i) => v + (i < adj.length ? adj[i] : 0));
      const o2 = path(o, c.other_income_path, c.other_income_growth, c.other_income_factor);
      const st = Math.trunc(c.opex_add_start_year);
      const x2 = path(x, c.opex_path, c.opex_growth, c.opex_factor).map((v, i) => v + (i + 1 >= st ? c.opex_add * Math.pow(1 + c.opex_add_growth, i + 1 - st) : 0));
      return [r2, o2, x2, cx];
    }
    let rAll, oAll, xAll;
    if (c.kind === "explicit" || c.kind === "custom") {
      const gr = c.kind === "explicit" ? c.y6_noi_growth : c.rent_growth_y6;
      const go = c.kind === "explicit" ? c.y6_noi_growth : c.other_income_growth_y6;
      const gx = c.kind === "explicit" ? c.y6_noi_growth : c.opex_growth_y6;
      rAll = grow(c.rents, n, gr); oAll = grow(c.other_income, n, go); xAll = grow(c.opex, n, gx);
    } else {
      const g3 = c.rent_growth_y3_plus;
      rAll = grow([c.rent_y1], n, (i) => (i === 1 ? c.rent_growth_y2 : g3));
      oAll = c.other_income_explicit ? grow(c.other_income_explicit, n, g3) : grow([c.other_income_y1], n, c.other_income_growth);
      xAll = grow([c.opex_y1], n, c.opex_growth);
    }
    const capexIn = c.capex ? c.capex.slice() : [deal.annual_capex_reserves];
    return [rAll, oAll, xAll, capexIn.concat(Array(n).fill(capexIn[capexIn.length - 1])).slice(0, n)];
  }

  function caseOperations(c, deal, cases) {
    const H = holdYears(deal), Y = uwYears(deal), n = Math.max(H + 1, Y + 1);
    const [rAll, oAll, xAll, cxAll] = caseLines(c, deal, n, cases);
    const noiAll = rAll.map((r, i) => r + oAll[i] - xAll[i]);
    // the NOI a buyer prices at the end of year H: next year's (forward) or the final hold year's (trailing)
    const exitNoi = deal.exit_noi_basis === "forward" ? noiAll[H] : noiAll[H - 1];
    const rents = rAll.slice(0, H), oi = oAll.slice(0, H), opex = xAll.slice(0, H);
    const income = rents.map((r, i) => r + oi[i]);
    const noi = income.map((x, i) => x - opex[i]);
    const capex = cxAll.slice(0, H);
    const am = income.map((x) => x * deal.asset_mgmt_fee_pct_of_income);
    const assume = [(deal.assumption_fee_pct || 0) * deal.loan_amount].concat(Array(H - 1).fill(0));

    // ---- debt: the assumed interest-only loan, optionally refinanced at the end of year R
    const loan0 = deal.loan_amount;
    const ds0 = deal.debt_service_method === "interest_only" ? loan0 * deal.loan_rate : deal.annual_debt_service;
    const ds = [], balEnd = [], refiNet = Array(H).fill(0);
    const rf = deal.refi || {};
    const R = rf.enabled ? Math.trunc(rf.year || 0) : 0;
    let refi = null, rate = 0, io = 0, factor = 0;
    if (R >= 1 && R < H) {
      const cap = rf.appraisal_cap || caseCapBasis(c, deal, noiAll[Y]);
      const value = noiAll[R] / cap;
      rate = rf.rate; io = Math.trunc(rf.io_years); const amort = Math.trunc(rf.amort_years);
      factor = rate > 0 ? rate / (1 - Math.pow(1 + rate, -amort)) : 1 / amort;
      let loan = rf.sizing === "ltv" ? rf.ltv * value : rf.amount, loanDscr = null;
      const payRate = io > 0 ? rate : factor;
      if ((rf.dscr_min || 0) > 0 && payRate > 0) { loanDscr = noiAll[R] / rf.dscr_min / payRate; loan = Math.min(loan, loanDscr); }
      const costs = loan * rf.cost_pct;
      refiNet[R - 1] = loan - loan0 - costs;
      refi = { year: R, appraisal_cap: cap, appraised_value: value, noi_basis: noiAll[R], loan, loan_dscr_limit: loanDscr,
               ltv: loan / value, costs, payoff_old: loan0, net_proceeds: refiNet[R - 1], rate };
    }
    let bal = loan0;
    const amortPay = refi ? refi.loan * factor : 0;  // level payment once amortization starts
    for (let y = 1; y <= H; y++) {
      let pay;
      if (refi && y > R) {
        if (y - R <= io) pay = bal * rate;
        else { pay = amortPay; bal -= pay - bal * rate; }
      } else pay = ds0;
      if (refi && y === R) bal = refi.loan;
      ds.push(pay); balEnd.push(bal);
    }
    if (refi) { refi.first_year_debt_service = ds[R]; refi.dscr = ds[R] ? noiAll[R] / ds[R] : null; }
    // cash received below NOI (e.g. a tax-increment rebate); at a sale, optionally the NPV of what is still to come
    const bni = deal.below_noi_income;
    // factor scales every payment; delay_years pushes the whole schedule back (see core.py)
    const amts = Array(Math.trunc(bni.delay_years)).fill(0).concat(bni.amounts.map((a) => a * bni.factor));
    const below = []; for (let y = 0; y < H; y++) below.push(y < amts.length ? amts[y] : 0);
    let bniSale = 0;
    if (bni.sale_value === "npv") amts.slice(H).forEach((a, k) => { bniSale += a / Math.pow(1 + bni.npv_rate, k + 1); });
    const ocf = noi.map((x, i) => x - capex[i] - ds[i] - am[i] - assume[i] + below[i]);
    return { rents, other_income: oi, total_income: income, opex, noi, capex, debt_service: ds,
             asset_mgmt_fee: am, assumption_fee: assume, below_noi_income: below, below_noi_sale_value: bniSale,
             operating_cash_flow: ocf, y6_noi: exitNoi,
             next_year_noi: exitNoi, hold_years: H, refi_proceeds: refiNet, loan_balance_end: balEnd, refi,
             _noi_year6: noiAll[Y] };
  }

  function caseExit(c, ops, deal) {
    const H = ops.hold_years, debt = ops.loan_balance_end[H - 1], sell = deal.selling_cost_pct, dispo = deal.disposition_fee_pct;
    const nxt = ops.next_year_noi, extra = saleExtras(ops, deal);
    let nsp, gross, cap;
    if (c.kind === "explicit") {
      if (H === uwYears(deal) && !ops.refi) { nsp = c.net_sale_proceeds; gross = (nsp + debt) / (1 - sell); }
      else { gross = nxt / caseCapBasis(c, deal, ops._noi_year6); nsp = gross - gross * sell - debt + extra; }
      cap = nxt / gross;
    } else if (c.kind === "custom" && c.exit_method === "sale_price") {
      gross = c.sale_price; cap = nxt / gross; nsp = gross - gross * sell - debt - gross * dispo + extra;
    } else {
      cap = c.exit_cap; gross = nxt / cap; nsp = gross - gross * sell - debt - gross * dispo + extra;
    }
    return { y6_noi: nxt, exit_cap: cap, gross_value: gross, selling_costs: gross * sell,
             disposition_fee: c.kind === "explicit" ? 0 : gross * dispo, debt_payoff: debt,
             reserves_returned: deal.reserves_returned_at_sale, below_noi_sale_value: ops.below_noi_sale_value,
             net_sale_proceeds: nsp, price_per_unit: gross / deal.units };
  }
  const saleExtras = (ops, deal) => deal.reserves_returned_at_sale + ops.below_noi_sale_value;

  // ------------------------------------------------------------ waterfall
  // wf.return_of_capital: "all_cash" or "capital_events" (see core.py); events = capital-event cash per year
  function runWaterfall(cash, equity, wf, events) {
    const pref = wf.pref_rate, rocEvents = wf.return_of_capital === "capital_events";
    let unreturned = equity, unpaid = 0;
    const rows = { cash: [], pref_due: [], to_pref: [], return_of_capital: [], unreturned_end: [],
                   unpaid_pref_end: [], tier_splits: [], lp: [], gp: [], deficit_end: [] };
    const lpHist = [];
    let deficit = 0;  // shortfalls carry forward (see core.py)
    for (let t = 1; t <= cash.length; t++) {
      let c = cash[t - 1] + deficit;
      deficit = Math.min(0, c);
      c = Math.max(0, c);
      const carried = wf.pref_compounds ? unpaid * (1 + pref) : unpaid;
      const due = unreturned * pref + carried;
      const toPref = Math.min(c, due);
      let roc;
      if (rocEvents) {
        const ev = Math.min(Math.max(0, events ? events[t - 1] : 0), c);
        roc = Math.min(Math.max(0, ev - Math.max(0, toPref - (c - ev))), unreturned);
      } else roc = Math.min(Math.max(0, c - toPref), unreturned);
      let remaining = c - toPref - roc, lp = toPref + roc, gp = 0;
      const splits = [];
      for (const tier of wf.tiers) {
        const h = tier.lp_irr_hurdle, s = tier.lp_share;
        let fvPrior = 0;
        lpHist.forEach((d, i) => { fvPrior += d * Math.pow(1 + h, t - 1 - i); });
        const lpNeeded = Math.max(0, equity * Math.pow(1 + h, t) - fvPrior - lp);
        const amt = Math.min(remaining, lpNeeded / s);
        lp += amt * s; gp += amt * (1 - s); remaining -= amt; splits.push(amt);
      }
      lp += remaining * wf.residual_lp_share;
      gp += remaining * (1 - wf.residual_lp_share);
      splits.push(remaining);
      unreturned -= roc;
      unpaid = due - toPref;
      lpHist.push(lp);
      rows.cash.push(c); rows.pref_due.push(due); rows.to_pref.push(toPref); rows.return_of_capital.push(roc);
      rows.unreturned_end.push(unreturned); rows.unpaid_pref_end.push(unpaid); rows.tier_splits.push(splits);
      rows.lp.push(lp); rows.gp.push(gp); rows.deficit_end.push(deficit);
    }
    return rows;
  }

  // irr is the annual-period IRR, or XIRR on actual payment dates when a dated schedule is given.
  function lpMetrics(lp, equity, pay, close) {
    const annual = irr([-equity].concat(lp));
    const dated = pay ? xirr([-equity].concat(pay[1]), [close].concat(pay[0])) : null;
    return { irr: pay ? dated : annual, irr_annual: annual, multiple: sum(lp) / equity,
             avg_cash_yield_y1_4: sum(lp.slice(0, Math.min(4, lp.length - 1))) / Math.max(1, Math.min(4, lp.length - 1)) / equity };
  }

  // ------------------------------------------------------------ distribution timing (see core.py)
  const scheduled = (inp) => ((inp.timing || {}).mode || "annual") === "schedule";
  const eventDate = (inp, year) => addMonths(inp.timing.sale_date, 12 * (year - uwYears(inp.deal)));
  const saleDate = (inp) => eventDate(inp, holdYears(inp.deal));
  function dealPayments(lp, opsPart, inp) {
    const close = inp.warehouse.close_date, H = lp.length;
    if (!scheduled(inp)) { const ds = []; for (let k = 1; k <= H; k++) ds.push(addMonths(close, 12 * k)); return [ds, lp.slice()]; }
    const t = inp.timing, f = t.siena_frequency, step = 12 / f, sale = saleDate(inp);
    const ops = lp.map((x, y) => (y in opsPart ? opsPart[y] : x));
    const flows = {};
    for (let y = 0; y < H; y++) for (let k = 0; k < f; k++) {
      let d = addMonths(t.first_distribution, step * (y * f + k));
      if (d > sale) d = sale;
      flows[d] = (flows[d] || 0) + ops[y] / f;
    }
    Object.keys(opsPart).map(Number).sort((a, b) => a - b).forEach((y) => {
      const d = y === H - 1 ? sale : eventDate(inp, y + 1);
      flows[d] = (flows[d] || 0) + (lp[y] - opsPart[y]);
    });
    const ds = Object.keys(flows).sort();
    return [ds, ds.map((d) => flows[d])];
  }
  function vehiclePeriods(payDates, payAmts, inp) {
    if (!scheduled(inp)) return [payDates.slice(), payAmts.slice(), payDates.map(() => 1)];
    const t = inp.timing, close = inp.warehouse.close_date, sale = saleDate(inp), vf = t.vehicle_frequency;
    const final = addMonths(sale, t.vehicle_final_lag_months || 0);
    let vdates;
    if (vf === 0) vdates = Array.from(new Set(payDates)).sort().filter((d) => d < sale);
    else {
      vdates = [];
      const first = t.vehicle_first_distribution || t.first_distribution;
      for (let k = 0; ; k++) { const d = addMonths(first, (12 / vf) * k); if (d >= sale) break; vdates.push(d); }
    }
    vdates.push(final);
    const rec = [], yfs = []; let prev = close;
    vdates.forEach((d) => {
      let r = 0; payDates.forEach((pd, i) => { if (pd > prev && pd <= d) r += payAmts[i]; });
      rec.push(r); yfs.push((toDay(d) - toDay(prev)) / 365); prev = d;
    });
    return [vdates, rec, yfs];
  }

  // ------------------------------------------------------------ top level
  function runCase(key, inp) {
    const c = inp.cases[key], deal = caseDeal(inp, key);
    const inpC = deal === inp.deal ? inp : Object.assign({}, inp, { deal });
    const ops = caseOperations(c, deal, inp.cases);
    const ex = caseExit(c, ops, deal);
    return Object.assign({ key, label: c.label, note: c.note || "", operations: ops, exit: ex },
                         returnsFor(ops, ex.net_sale_proceeds, inpC));
  }

  // Year-5 sale added to operating cash, run through the waterfall.
  // OA 8.7 crystallization (see core.py)
  function tierLpGp(rows, t, wf) {
    let lp = 0, gp = 0;
    rows.tier_splits[t].forEach((amt, j) => { const s = j < wf.tiers.length ? wf.tiers[j].lp_share : wf.residual_lp_share; lp += amt * s; gp += amt * (1 - s); });
    return [lp, gp];
  }
  function crystallize(cash, sale, w, refi, inp, events) {
    const deal = inp.deal, wf = inp.waterfall, eq = deal.lp_equity, R = refi.year, H = cash.length;
    const nev = refi.appraised_value - refi.loan - inp.deal.refi.crystallize_cost_pct * refi.appraised_value;
    const out = { applied: false, net_equity_value: nev, lp_pct: null, year: R };
    if (nev <= 0) return out;
    const hyp = runWaterfall(cash.slice(0, R - 1).concat([cash[R - 1] + nev]), eq, wf, events.slice(0, R - 1).concat([events[R - 1] + nev]));
    const [lp2, gp2] = tierLpGp(hyp, R - 1, wf), [lp1, gp1] = tierLpGp(w, R - 1, wf);
    const dLp = lp2 - lp1, dGp = gp2 - gp1;
    if (dLp + dGp <= 1e-6) return out;
    const pct = dLp / (dLp + dGp);
    const accrued0 = w.unpaid_pref_end[R - 1], unret0 = w.unreturned_end[R - 1];
    const run = (lastCash, lastSale) => {
      let accrued = accrued0, unret = unret0, deficit = w.deficit_end[R - 1];
      const lp = w.lp.slice(0, R), gp = w.gp.slice(0, R);
      for (let t = R; t < H; t++) {
        let c = (t === H - 1 ? lastCash : cash[t]) + deficit;
        deficit = Math.min(0, c); c = Math.max(0, c);
        const capital = t === H - 1 ? Math.min(Math.max(0, lastSale), c) : 0;
        const op = c - capital;
        const p1 = Math.min(op, accrued); accrued -= p1;
        const p2 = Math.min(capital, accrued); accrued -= p2;
        const rc = Math.min(capital - p2, unret); unret -= rc;
        const rest = op - p1 + capital - p2 - rc;
        lp.push(p1 + p2 + rc + pct * rest); gp.push((1 - pct) * rest);
      }
      return [lp, gp];
    };
    const [lp, gp] = run(cash[H - 1], sale);
    return Object.assign(out, { applied: true, lp_pct: pct, accrued_pref: accrued0, unreturned_capital: unret0,
      hypothetical_lp_tiers: dLp, hypothetical_sponsor_tiers: dGp, lp, gp, lp_ops_only_last: run(cash[H - 1] - sale, 0)[0][H - 1] });
  }

  function returnsFor(ops, nsp, inp) {
    const deal = inp.deal, wf = inp.waterfall;
    const ocf = ops.operating_cash_flow;
    // Refinance proceeds (OA 8.2: same order as 8.1) and the sale added to operating cash
    const cash = ocf.map((o, i) => o + ops.refi_proceeds[i]);
    cash[cash.length - 1] += nsp;
    const evCash = ops.refi_proceeds.slice();  // capital-event cash per year (refinance, sale)
    evCash[evCash.length - 1] += nsp;
    let w = runWaterfall(cash, deal.lp_equity, wf, evCash);
    const sched = scheduled(inp), close = inp.warehouse.close_date;
    // LP cash from operations alone in each capital-event year, so the event can be dated separately
    const events = [ocf.length - 1].concat(ops.refi ? [ops.refi.year - 1] : []);
    const opsAlone = (cAll, evAll, eq, wfx, lpAll, scale) => {
      const part = {};
      if (sched) events.forEach((y) => {
        part[y] = Math.min(runWaterfall(cAll.slice(0, y).concat([ocf[y] * scale]), eq, wfx, evAll.slice(0, y).concat([0])).lp[y], lpAll[y]);
      });
      return part;
    };
    const opsPart = opsAlone(cash, evCash, deal.lp_equity, wf, w.lp, 1.0);
    const payReg = dealPayments(w.lp, opsPart, inp);
    const mReg = lpMetrics(w.lp, deal.lp_equity, sched ? payReg : null, close);
    // OA 8.7 crystallization; the LTEC side letter keeps LTEC on the regular waterfall until capital + pref are back
    let cr = null, payC = payReg, m = mReg, prot = false;
    const rf = deal.refi || {};
    if (ops.refi && rf.crystallize) cr = crystallize(cash, nsp, w, ops.refi, inp, evCash);
    if (cr && cr.applied) {
      const partC = Object.assign({}, opsPart);
      if (sched) partC[ocf.length - 1] = Math.min(cr.lp_ops_only_last, cr.lp[cr.lp.length - 1]);
      payC = dealPayments(cr.lp, partC, inp);
      m = lpMetrics(cr.lp, deal.lp_equity, sched ? payC : null, close);
      prot = rf.side_letter_protects !== false && (cr.unreturned_capital > 0.5 || cr.accrued_pref > 0.5);
      cr.ltec_protected = prot;
      w = Object.assign({}, w, { lp_regular: w.lp, gp_regular: w.gp, lp: cr.lp, gp: cr.gp });
    }
    const invLp = prot ? w.lp_regular : w.lp, invPayReg = prot ? payReg : payC, invM = prot ? mReg : m;
    const check = inp.investor.check, share = check / deal.lp_equity;
    let inv = invLp.map((d) => d * share), invPay = invPayReg, invAmts = invPayReg[1].map((a) => a * share);
    let invIrr = invM.irr, invMult = invM.multiple, side = null;
    // Side letter for our check (see core.py): our pro-rata share of partnership cash through our own terms
    const sl = inp.investor.side_letter;
    if (sl.enabled && check > 0) {
      const swf = Object.assign({}, wf, sl.terms);
      const sCash = cash.map((c) => c * share), sEv = evCash.map((e) => e * share);
      const sw = runWaterfall(sCash, check, swf, sEv);
      const sPay = dealPayments(sw.lp, opsAlone(sCash, sEv, check, swf, sw.lp, share), inp);
      const sM = lpMetrics(sw.lp, check, sched ? sPay : null, close);
      side = { applied: true, regular_distributions: inv, regular_total: sum(inv), regular_irr: invIrr,
               regular_multiple: invMult, uplift: sum(sw.lp) - sum(inv), sponsor_cost: sum(sw.lp) - sum(inv) };
      inv = sw.lp.slice(); invPay = sPay; invAmts = sPay[1]; invIrr = sM.irr; invMult = sM.multiple;
    }
    return { waterfall: w, lp: m, crystallization: cr,
             payments: { dates: payC[0], amounts: payC[1] },
             investor: { distributions: inv, total: sum(inv), profit: sum(inv) - check,
                         irr: invIrr, multiple: invMult, payment_dates: invPay[0], payments: invAmts, side_letter: side },
             gp_promote_total: sum(w.gp),
             direct_investors: (inp.direct_investors || []).map((d) => directInvestor(d, w.lp, m, deal.lp_equity, payC[1])) };
  }

  // An LP who invests in Siena directly: same Preferred terms, so cash scales with the check.
  function directInvestor(d, lp, m, equity, payAmts) {
    const dist = lp.map((x) => x * d.check / equity);
    return { name: d.name, check: d.check, distributions: dist, total: sum(dist),
             profit: sum(dist) - d.check, irr: m.irr, multiple: m.multiple,
             payments: payAmts.map((a) => a * d.check / equity) };
  }

  // LP IRR on one case's operations across exit caps and Year-6 NOI factors. includeOwn adds the case's
  // own exit cap as a row when it isn't already on the grid.
  function sensitivity(inp, kase, includeOwn) {
    kase = kase || runCase("custom", inp);
    const deal = caseDeal(inp, kase.key), s = inp.sensitivity;
    if (deal !== inp.deal) inp = Object.assign({}, inp, { deal });
    const ops = kase.operations, y6 = ops.y6_noi, own = kase.exit.exit_cap;
    let caps = s.exit_caps.slice();
    if (includeOwn && !caps.some((c) => Math.abs(c - own) < 1e-9)) caps = caps.concat([own]).sort((a, b) => a - b);
    const keep = 1 - deal.selling_cost_pct - deal.disposition_fee_pct, extra = saleExtras(ops, deal);
    return {
      exit_caps: caps, noi_factors: s.noi_factors,
      lp_irr: caps.map((c) => s.noi_factors.map((f) =>
        returnsFor(ops, y6 * f / c * keep - kase.exit.debt_payoff + extra, inp).lp.irr)),
      gross_value: caps.map((c) => s.noi_factors.map((f) => y6 * f / c)),
      own_cap: own,
    };
  }

  // ------------------------------------------------------------ vehicle (SV26) warehouse
  // See engine/core.py for the full description. People put `amount` in at close as a member (keeps
  // units), warehouse (sells in the sell-down) or loan (to the manager; repaid as units sell, unsold
  // principal converts at par on the last sale date). Each sale names a buyer: a person or an outside
  // group. Unsold pool units pay warehouse_promote; other units pay promote. Hurdle is pooled.
  // Hurdle state: compound = balance grows at (1 + h)^a (an IRR hurdle); simple = h x a on unreturned capital,
  // paid to accrued return first, then capital.
  const hurdleNew = (capital) => ({ bal: capital, cap: capital, acc: 0 });
  function hurdlePay(st, cash, a, h, simple) {
    const c = Math.max(0, cash);
    if (simple) {
      st.acc += st.cap * h * a;
      const paid = Math.min(c, st.cap + st.acc), toAcc = Math.min(paid, st.acc);
      st.acc -= toAcc; st.cap -= paid - toAcc;
      return paid;
    }
    st.bal *= Math.pow(1 + h, a);
    const paid = Math.min(c, st.bal);
    st.bal -= paid;
    return paid;
  }
  // The manager's own waterfall between its partners (see core.py manager_waterfall_split).
  function managerWaterfallSplit(seq, capital, mw) {
    const simple = (mw.pref_type || "compound") === "simple";
    const pref = hurdleNew(capital);
    const tiers = mw.tiers || [];
    const hs = tiers.map(() => hurdleNew(capital));
    const out = [];
    for (const [a, x] of seq) {
      let toC = hurdlePay(pref, x, a, mw.pref, simple);  // accrues; pays nothing when x <= 0
      hs.forEach((st, k) => { st.bal *= Math.pow(1 + tiers[k].to_irr, a); });
      if (x < 0) {
        [pref].concat(hs).forEach((st) => { st.bal -= x; st.cap -= x; });
        out.push([x, 0]);
        continue;
      }
      let rem = x - toC, toP = 0;
      hs.forEach((st, k) => {
        const need = Math.max(0, st.bal - toC), c = tiers[k].capital_share;
        const z = need <= 0 ? 0 : (c <= 0 ? rem : Math.min(rem, need / c));
        toC += c * z;
        toP += (1 - c) * z;
        rem -= z;
      });
      const c = mw.residual_capital_share || 0;
      toC += c * rem;
      toP += (1 - c) * rem;
      hs.forEach((st) => { st.bal = Math.max(0, st.bal - toC); });
      out.push([toC, toP]);
    }
    return out;
  }
  // Per-unit net cash for units bought at `basis` on `start`, with their own hurdle (member-by-member mode).
  function unitSeries(grossPu, dates, yfs, close, start, basis, rate, h, simple) {
    const st = hurdleNew(basis), sDay = toDay(start);
    return dates.map((d, t) => {
      const dd = toDay(d);
      if (dd <= sDay) return 0;
      const prev = toDay(t > 0 ? dates[t - 1] : close);
      const a = sDay > prev ? (dd - sDay) / 365 : yfs[t];
      const paid = hurdlePay(st, grossPu[t], a, h, simple);
      return grossPu[t] - rate * Math.max(0, grossPu[t] - paid);
    });
  }

  function salePrice(tr, par, days, credit) {
    let base;
    if (tr.pricing === "carry_compound") base = par * Math.pow(1 + tr.rate, days / 365);
    else if (tr.pricing === "premium") base = par * (1 + tr.rate);
    else base = par * (1 + tr.rate * days / 365);
    return base - credit;
  }
  const nameKey = (s) => s.trim().toLowerCase();

  function warehouseCase(dists, inp, pctSold, dates, yfs) {
    const w = inp.warehouse, invest = inp.investor.check, par = w.unit_price, close = w.close_date;
    const raised = invest + w.reserve, mc = w.manager_commitment;
    const mr = w.manager_reserve || 0;  // cash the manager keeps outside the vehicle; back to its owners in Year 5
    const U = raised / par, mgrUnits = mc / par;
    if (!dates) { dates = []; for (let t = 1; t <= dists.length; t++) dates.push(addMonths(close, 12 * t)); yfs = dates.map(() => 1); }
    const N = dates.length;
    const dDays = dates.map(toDay), closeDay = toDay(close);

    const people = w.people, amt = people.map((p) => p.amount), role = people.map((p) => p.role);
    let pool = 0; amt.forEach((a, i) => { if (role[i] === "warehouse" || role[i] === "loan") pool += a; });
    const wTot = pool / par;

    // ---- sales
    const trs = w.selldown.tranches;
    let shares = trs.map((tr) => tr.share);
    if (pctSold != null) {
      const tot = sum(shares);
      shares = tot > 0 ? shares.map((s) => s * pctSold / tot) : trs.map((_, j) => (j === 0 ? pctSold : 0));
    }
    const tot = sum(shares);
    if (tot > 1) shares = shares.map((s) => s / tot);
    const tDay = trs.map((tr) => toDay(tr.date));
    const tDays = tDay.map((d) => d - closeDay);
    const soldBefore = dDays.map((dd) => { let s = 0; shares.forEach((x, j) => { if (tDay[j] < dd) s += x; }); return s; });
    const unsold = Math.max(0, 1 - sum(shares));
    const jLast = trs.length ? tDay.indexOf(Math.max(...tDay)) : null;
    const last = trs.length ? tDay[jLast] : closeDay;
    const lastDays = last - closeDay;
    const afterLast = dDays.map((dd) => (dd > last ? 1 : 0));
    const whHeld = soldBefore.map((sb) => wTot * (1 - sb));

    // ---- vehicle cash, pooled hurdle, promote by unit class
    const admin = w.admin_cost_method === "pct_raise" ? w.admin_cost_pct * raised : w.admin_cost_per_year;
    const distCash = [], promote = [], members = [], puS = [], puW = [], fee = [];
    const pStd = w.promote, pWh = w.warehouse_promote;
    // Schedule mode (Nov 3 memo): holdback, shortfalls carried forward, acquisition fee after first distribution.
    const sched = scheduled(inp), tm = inp.timing || {};
    const hold = sched ? (tm.vehicle_holdback || 0) : 0;
    const acqT = sched && tm.acq_fee_after_first && N > 1 ? 1 : 0;
    let carry = 0;
    for (let t = 0; t < N; t++) {
      const yf = yfs[t];
      const f = (t === acqT ? -w.acq_fee_pct * invest : 0) - w.mgmt_fee_pct * raised * yf;
      const reserve = t === N - 1 ? w.reserve : 0;
      let cash = dists[t] - admin * yf + f + reserve;
      if (sched) {
        const avail = cash + carry;
        cash = t === N - 1 ? avail : Math.max(0, avail) / (1 + hold);
        carry = avail - cash;
      }
      distCash.push(cash); fee.push(f);
    }

    // ---- hurdle and promote (see core.py): whole fund by default; per_member, simple and manager-unit switches
    const h = w.member_hurdle_irr, simple = (w.hurdle_type || "compound") === "simple";
    const perMember = (w.hurdle_basis || "pooled") === "per_member";
    const pMgr = w.promote_on_manager_units === false ? 0 : pStd;
    let puM = [], grossPu = null;
    if (!perMember) {
      const st = hurdleNew(raised);
      for (let t = 0; t < N; t++) {
        const cash = distCash[t];
        const paid = hurdlePay(st, cash, yfs[t], h, simple);
        const excess = Math.max(0, cash - paid);
        const base = (cash - excess) / U, xpu = excess / U;
        const pr = xpu * (pStd * (U - whHeld[t] - mgrUnits) + pWh * whHeld[t] + pMgr * mgrUnits);
        promote.push(pr); members.push(cash - pr);
        puS.push(base + xpu * (1 - pStd)); puW.push(base + xpu * (1 - pWh)); puM.push(base + xpu * (1 - pMgr));
      }
    } else {
      grossPu = distCash.map((c) => c / U);
      unitSeries(grossPu, dates, yfs, close, close, par, pStd, h, simple).forEach((x) => puS.push(x));
      unitSeries(grossPu, dates, yfs, close, close, par, pWh, h, simple).forEach((x) => puW.push(x));
      puM = unitSeries(grossPu, dates, yfs, close, close, par, pMgr, h, simple);
    }

    const creditOn = w.selldown.credit_distributions;
    const prices = trs.map((tr, j) => {
      let credit = 0;
      if (creditOn) puW.forEach((pu, t) => { if (dDays[t] <= tDay[j]) credit += pu; });
      return salePrice(tr, par, tDays[j], credit);
    });
    const unitsSold = shares.map((s) => s * wTot);

    // people are referred to by id (stable; names are labels) or, in older files, by name; ids win
    const pidx = {}; people.forEach((p, i) => { pidx[nameKey(p.name)] = i; });
    people.forEach((p, i) => { if (p.id) pidx[nameKey(p.id)] = i; });
    const buyerNames = trs.map((tr) => ((tr.buyer || "").trim() || w.names.buyers));
    const buyerPerson = buyerNames.map((b) => (nameKey(b) in pidx ? pidx[nameKey(b)] : null));
    // per-unit cash on bought units (their own hurdle in member-by-member mode) and on lender-converted units
    const lastIso = trs.length ? trs[jLast].date : close;
    const puB = perMember ? trs.map((tr, j) => unitSeries(grossPu, dates, yfs, close, tr.date, prices[j], pStd, h, simple)) : trs.map(() => puS);
    const puC = perMember ? unitSeries(grossPu, dates, yfs, close, lastIso, par, pWh, h, simple) : puW;
    const boughtCash = (match, t) => { let s = 0; unitsSold.forEach((u, j) => { if (match[j] && tDay[j] < dDays[t]) s += u * puB[j][t]; }); return s; };
    if (perMember) {  // promote = gross cash on every block of units held, less what its holder keeps
      let memU = 0, eqU = 0, lnU = 0;
      amt.forEach((a, i) => { const x = a / par; if (role[i] === "member") memU += x; else if (role[i] === "warehouse") eqU += x; else lnU += x; });
      for (let t = 0; t < N; t++) {
        const g = grossPu[t], heldWh = (eqU + lnU * (1 - afterLast[t])) * (1 - soldBefore[t]), conv = lnU * unsold * afterLast[t];
        let pr = memU * (g - puS[t]) + heldWh * (g - puW[t]) + mgrUnits * (g - puM[t]) + conv * (g - puC[t]);
        unitsSold.forEach((u, j) => { if (tDay[j] < dDays[t]) pr += u * (g - puB[j][t]); });
        promote.push(pr); members.push(distCash[t] - pr);
      }
    }
    const mgrCash = promote.map((p, t) => p - fee[t]);

    // ---- manager's loan book
    const P = amt, W = amt.map((a) => a / par), loan = role.map((r) => r === "loan");
    let L = 0; W.forEach((x, i) => { if (loan[i]) L += x; });
    let interestTotal = 0;
    const mgrTr = trs.map((_, j) => {
      let v = shares[j] * L * prices[j];
      people.forEach((p, i) => {
        if (loan[i]) {
          v -= shares[j] * P[i] * (1 + p.loan_rate * tDays[j] / 365);
          interestTotal += shares[j] * P[i] * p.loan_rate * tDays[j] / 365;
        }
      });
      if (j === jLast) people.forEach((p, i) => {
        if (loan[i]) {
          v -= unsold * P[i] * p.loan_rate * lastDays / 365;
          interestTotal += unsold * P[i] * p.loan_rate * lastDays / 365;
        }
      });
      return v;
    });
    // Manager cash in two kinds, owned separately: capital side (its own units, loan book, reserve)
    // and fees & promote side.
    const mcap = mc + mr;
    const capDist = puM.map((pu, t) => pu * mgrUnits + puW[t] * L * (1 - soldBefore[t]) * (1 - afterLast[t]) + (t === N - 1 ? mr : 0));
    const proDist = mgrCash;

    // ---- manager buy-ins (see core.py): capital, fees & promote, or both
    const cap0 = people.map((p) => (mcap > 0 ? p.manager_capital / mcap : 0));
    const pro0 = people.map((p) => p.manager_share);
    const xsIn = w.manager_transfers || [];
    const cap = cap0.slice(), pro = pro0.slice(), snaps = [], xfers = [];
    // Partners leaving (manager_vesting): see core.py. Handled in date order with buy-ins.
    const vestIn = w.manager_vesting || [], departures = [];
    const evs = xsIn.map((x, q) => [x.date, 0, q]).concat(vestIn.map((v, k) => [v.leaves, 1, k]).filter((e) => e[0]));
    evs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1] || a[2] - b[2]));
    evs.forEach(([, kind_, q]) => {
      if (kind_ === 1) {
        const v = vestIn[q], d = toDay(v.leaves);
        const i = nameKey(v.person) in pidx ? pidx[nameKey(v.person)] : null;
        if (i === null) {
          departures.push({ person: v.person, date: v.leaves, vested: 0, share_before: 0, share_kept: 0, valid: false });
          return;
        }
        const yrs = (d - closeDay) / 365;
        const vy = v.years || 0, cl = v.cliff_years || 0;
        let vested = yrs < cl ? 0 : (vy <= 0 ? 1 : Math.min(1, yrs / vy));
        if ((v.terms || "keep_vested") === "forfeit") vested = 0;
        const before = pro[i];
        const others = people.map((_, k) => k).filter((k) => k !== i);
        let base = others.map((k) => pro[k]);
        if (sum(base) <= 0) base = others.map((k) => cap[k]);
        if (sum(base) <= 0) base = others.map(() => 1);
        const freed = before - before * vested;
        if (others.length && freed > 0) {
          const tb = sum(base);
          others.forEach((k, m) => { pro[k] += freed * base[m] / tb; });
          pro[i] = before * vested;
        }
        departures.push({ person: people[i].name, date: v.leaves, vested, share_before: before, share_kept: pro[i], valid: true });
        snaps.push([d, cap.slice(), pro.slice()]);
        return;
      }
      const x = xsIn[q], kind = x.interest || "both", d = toDay(x.date);
      const b = nameKey(x.buyer) in pidx ? pidx[nameKey(x.buyer)] : null;
      const s = nameKey(x.seller) in pidx ? pidx[nameKey(x.seller)] : null;
      const ok = b !== null && s !== null && b !== s;
      let sh = 0, paid = 0, pps = 0;
      if (kind === "promote") {
        pps = x.share > 0 ? x.price / x.share : 0;
        if (ok && x.share > 0) { sh = Math.max(0, Math.min(x.share, pro[s])); paid = x.price * sh / x.share; }
      } else {
        let credit = 0;
        if (x.credit_distributions) {
          mgrTr.forEach((v, j) => { if (tDay[j] <= d) credit += v; });
          capDist.forEach((v, t) => { if (dDays[t] <= d) credit += v; });
          if (kind === "both") proDist.forEach((v, t) => { if (dDays[t] <= d) credit += v; });
        }
        pps = salePrice(x, mcap, d - closeDay, credit);
        if (ok && pps > 0) {
          const want = x.mode === "share" ? x.share : x.amount / pps;
          const avail = kind === "capital" ? cap[s] : Math.min(cap[s], pro[s]);
          sh = Math.max(0, Math.min(want, avail));
          paid = sh * pps;
        }
      }
      if (sh > 0) {
        if (kind === "capital" || kind === "both") { cap[s] -= sh; cap[b] += sh; }
        if (kind === "promote" || kind === "both") { pro[s] -= sh; pro[b] += sh; }
      }
      xfers.push({ date: x.date, day: d, buyer: b, seller: s, interest: kind, share: sh, paid, price_100: pps, index: q });
      snaps.push([d, cap.slice(), pro.slice()]);
    });
    const ownAt = (d) => { let c = cap0, pr = pro0; snaps.forEach(([sd, sc, sp]) => { if (sd < d) { c = sc; pr = sp; } }); return [c, pr]; };

    // ---- the manager's own split between its partners (see core.py). Off: as before.
    const mw = w.manager_waterfall || {}, mLoans = w.manager_loans || [];
    const splitOn = !!mw.enabled, custom = splitOn || mLoans.length > 0, nP = people.length;
    const ev = trs.map((_, j) => [tDay[j], 0, j]).concat(dDays.map((d, t) => [d, 1, t]));
    ev.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    const splitTot = { enabled: splitOn, to_capital: 0, to_promote: 0, capital: mcap };
    const loansOut = [], lent = people.map(() => 0);
    let mTr = null, mDist = null;
    if (custom) {
      mTr = trs.map((_, j) => people.map((_, i) => ownAt(tDay[j])[0][i] * mgrTr[j]));
      mDist = dDays.map((dd, t) => people.map((_, i) => ownAt(dd)[0][i] * capDist[t] + ownAt(dd)[1][i] * proDist[t]));
      if (splitOn) {
        let prev = closeDay;
        const seq = ev.map(([d, k, j]) => { const a = (d - prev) / 365; prev = d; return [a, k === 0 ? mgrTr[j] : capDist[j] + proDist[j]]; });
        managerWaterfallSplit(seq, mcap, mw).forEach(([toC, toP], e) => {
          const [d, k, j] = ev[e], [oc, op] = ownAt(d);
          const row = people.map((_, i) => oc[i] * toC + op[i] * toP);
          if (k === 0) mTr[j] = row; else mDist[j] = row;
          splitTot.to_capital += toC;
          splitTot.to_promote += toP;
        });
      }
      // Partner loans (see core.py)
      mLoans.forEach((ln) => {
        const lo = nameKey(ln.lender) in pidx ? pidx[nameKey(ln.lender)] : null;
        const bo = nameKey(ln.borrower) in pidx ? pidx[nameKey(ln.borrower)] : null;
        // a loan funds the borrower's own manager capital, so it is capped at that
        const aL = bo !== null ? Math.min(ln.amount, people[bo].manager_capital) : 0;
        const rec = { lender: lo !== null ? people[lo].name : ln.lender, borrower: bo !== null ? people[bo].name : ln.borrower, amount: aL, repaid: 0, interest: 0, owed_end: 0, settled: "invalid" };
        loansOut.push(rec);
        if (lo === null || bo === null || lo === bo || aL <= 0) return;
        lent[lo] += aL;
        lent[bo] -= aL;
        const simpleL = (ln.rate_type || "simple") === "simple";
        let prin = aL, acc = 0, bal = aL, prev = closeDay;
        ev.forEach(([d, k, j]) => {
          const a = (d - prev) / 365;
          prev = d;
          if (simpleL) acc += prin * ln.rate * a;
          else bal *= Math.pow(1 + ln.rate, a);
          const row = k === 0 ? mTr[j] : mDist[j];
          const pay = Math.min(Math.max(0, row[bo]), simpleL ? prin + acc : bal);
          row[bo] -= pay;
          row[lo] += pay;
          rec.repaid += pay;
          if (simpleL) {
            const ti = Math.min(pay, acc);
            acc -= ti;
            prin -= pay - ti;
          } else bal -= pay;
        });
        const owed = Math.max(0, simpleL ? prin + acc : bal);
        rec.interest = rec.repaid + owed - aL;
        rec.owed_end = owed;
        if (owed > 1e-9 && ln.recourse !== false && ev.length) {
          const [, k, j] = ev[ev.length - 1];
          const row = k === 0 ? mTr[j] : mDist[j];
          row[bo] -= owed;
          row[lo] += owed;
          rec.settled = "paid_at_end";
        } else rec.settled = owed <= 1e-9 ? "repaid" : "forgiven";
      });
    }

    // ---- people
    const allDates = [close].concat(trs.map((tr) => tr.date), xfers.map((x) => x.date), dates);
    const outPeople = people.map((p, i) => {
      let c0 = -(P[i] + p.manager_capital);
      if (custom) c0 -= lent[i];
      const mine = buyerPerson.map((bp) => bp === i);
      let fromMgr = 0;
      const trFlows = trs.map((_, j) => {
        let v;
        if (role[i] === "loan") {
          v = shares[j] * P[i] * (1 + p.loan_rate * tDays[j] / 365);
          if (j === jLast) v += unsold * P[i] * p.loan_rate * lastDays / 365;
        } else if (role[i] === "warehouse") v = shares[j] * W[i] * prices[j];
        else v = 0;
        if (mine[j]) v -= unitsSold[j] * prices[j];
        if (custom) { fromMgr += mTr[j][i]; return v + mTr[j][i]; }
        fromMgr += ownAt(tDay[j])[0][i] * mgrTr[j];
        return v + ownAt(tDay[j])[0][i] * mgrTr[j];
      });
      const dist = puS.map((ps, t) => {
        let v;
        if (role[i] === "loan") v = puC[t] * W[i] * unsold * afterLast[t];
        else if (role[i] === "warehouse") v = puW[t] * W[i] * (1 - soldBefore[t]);
        else v = ps * W[i];
        const [oc, op] = ownAt(dDays[t]);
        if (custom) { fromMgr += mDist[t][i]; return v + boughtCash(mine, t) + mDist[t][i]; }
        fromMgr += oc[i] * capDist[t] + op[i] * proDist[t];
        return v + boughtCash(mine, t) + oc[i] * capDist[t] + op[i] * proDist[t];
      });
      const xFlows = xfers.map((x) => (x.seller === i ? x.paid : 0) - (x.buyer === i ? x.paid : 0));
      const flows = [c0].concat(trFlows, xFlows, dist);
      const cashIn = -c0, atSales = sum(trFlows), atBuyins = sum(xFlows), atRisk = cashIn - atSales - atBuyins;
      return { name: p.name, flows,
        summary: { cash_in: cashIn, returned_at_selldown: atSales, at_buyins: atBuyins,
                   at_risk: atRisk, manager_share_end: pro[i], manager_capital_share_end: cap[i], profit: sum(flows),
                   irr: xirr(flows, allDates), multiple_at_risk: atRisk > 0 ? sum(dist) / atRisk : null,
                   from_manager: fromMgr, manager_loans_net: lent[i] } };
    });

    // ---- outside buyer groups
    const bDates = trs.map((tr) => tr.date).concat(dates);
    const groupNames = [];
    buyerNames.forEach((b, j) => { if (buyerPerson[j] === null && !groupNames.includes(b)) groupNames.push(b); });
    const groups = groupNames.map((name) => {
      const mine = buyerNames.map((b, j) => buyerPerson[j] === null && nameKey(b) === nameKey(name));
      const flows = unitsSold.map((u, j) => (mine[j] ? -u * prices[j] : 0)).concat(puS.map((_, t) => boughtCash(mine, t)));
      let units = 0; unitsSold.forEach((u, j) => { if (mine[j]) units += u; });
      const cost = -sum(flows.slice(0, trs.length));
      return { name, flows, summary: { units, cost, profit: sum(flows), irr: units > 0 ? xirr(flows, bDates) : null } };
    });
    const allBuy = unitsSold.map((u, j) => -u * prices[j]).concat(puS.map((_, t) => boughtCash(trs.map(() => true), t)));
    const totalSold = sum(unitsSold);

    const r2 = (x) => Math.round(x * 100) / 100;
    let check = Math.abs(r2(-raised - mr - sum(outPeople.map((x) => x.flows[0]))));
    xfers.forEach((_, q) => { check += Math.abs(r2(sum(outPeople.map((x) => x.flows[1 + trs.length + q])))); });
    trs.forEach((_, j) => { check += Math.abs(r2(sum(outPeople.map((x) => x.flows[1 + j])) + sum(groups.map((g) => g.flows[j])))); });
    for (let t = 0; t < N; t++) {
      const k = 1 + trs.length + xfers.length + t;
      check += Math.abs(r2(sum(outPeople.map((x) => x.flows[k])) + sum(groups.map((g) => g.flows[trs.length + t])) - (distCash[t] - fee[t]) - (t === N - 1 ? mr : 0)));
    }

    return {
      dates: allDates, sv26_distributable: distCash, manager_promote: promote, manager_fees: fee.map((f) => -f),
      member_distributions: members, per_unit: puS, per_unit_warehouse: puW,
      tranches: trs.map((tr, j) => ({ date: tr.date, share: shares[j], units: unitsSold[j], price: prices[j], buyer: buyerPerson[j] !== null ? people[buyerPerson[j]].name : buyerNames[j] })),
      people: outPeople,
      buyers: groups,
      manager_transfers: xfers.map((x) => ({ date: x.date, index: x.index,
        buyer: x.buyer !== null ? people[x.buyer].name : null, seller: x.seller !== null ? people[x.seller].name : null,
        interest: x.interest, share: x.share, paid: x.paid, price_100: x.price_100 })),
      manager_split: splitTot, manager_loans: loansOut, manager_departures: departures,
      summary: {
        people: outPeople.map((x) => x.summary),
        buyers: groups.map((g) => g.summary),
        buyers_units: totalSold, buyers_cost: sum(unitsSold.map((u, j) => u * prices[j])),
        buyers_irr: totalSold > 0 ? xirr(allBuy, bDates) : null,
        share_sold: sum(shares), pool, unfunded: raised - mc - sum(amt),
        manager_unfunded: mcap - sum(people.map((p) => p.manager_capital)),
        manager_promote_total: sum(promote), manager_fees_total: -sum(fee),
        loan_interest_total: interestTotal, admin_per_year: admin,
        check,
      },
    };
  }

  function warehouse(inp, cases) {
    const share = inp.investor.check / inp.deal.lp_equity;
    const out = {};
    for (const k of Object.keys(cases)) {
      const [vdates, rec, yfs] = vehiclePeriods(cases[k].investor.payment_dates, cases[k].investor.payments, inp);
      const res = warehouseCase(rec, inp, null, vdates, yfs);
      res.by_pct_sold = {};
      for (const p of [0, 0.25, 0.5, 0.75, 1.0]) {
        res.by_pct_sold[String(p === 1 ? "1.0" : p)] = warehouseCase(rec, inp, p, vdates, yfs).summary.people
          .map((s) => ({ at_risk: s.at_risk, profit: s.profit, irr: s.irr }));
      }
      out[k] = res;
    }
    return out;
  }

  function runAll(inp) {
    const cases = {};
    for (const k of Object.keys(inp.cases)) cases[k] = runCase(k, inp);
    return { inputs_version: inp.version, cases,
             sensitivity: sensitivity(inp, cases.custom),
             sensitivity_by_case: Object.fromEntries(Object.keys(cases).map((k) => [k, sensitivity(inp, cases[k], true)])),
             warehouse: warehouse(inp, cases) };
  }

  // ---- structure templates (see core.py apply_structure; lib = engine/structures.json)
  function structurePartners(inp, lib) {
    const w = inp.warehouse, mgr = nameKey(w.names.manager);
    const ps = w.people.filter((p) => (p.manager_capital > 0 || p.manager_share > 0) && nameKey(p.name) !== mgr);
    const tc = sum(ps.map((p) => p.manager_capital)), tp = sum(ps.map((p) => p.manager_share));
    if (!ps.length || tp <= 0) return lib.partners.map((p) => Object.assign({}, p));
    return ps.map((p) => ({ id: p.id || personId(p.name), name: p.name, capital_share: tc > 0 ? p.manager_capital / tc : p.manager_share / tp, promote_share: p.manager_share / tp }));
  }
  function applyStructure(inp, key, lib, partners) {
    const t = lib.templates[key];
    const out = JSON.parse(JSON.stringify(inp));
    const w0 = inp.warehouse;
    const ps = partners || structurePartners(inp, lib);
    const check = inp.investor.check;
    const reserve = check * t.reserve_pct;
    const mc = check * t.manager_commitment_pct;
    const outside = check + reserve - mc;
    const meta = inp.meta || {};
    const dealName = (meta.ui || {}).deal_short || meta.name || "Deal";
    const people = ps.map((p) => ({ id: p.id || personId(p.name), name: p.name, amount: 0, role: "member",
      manager_capital: mc * p.capital_share, manager_share: p.promote_share, loan_rate: 0.08 }));
    let tranches = [];
    if (t.outside === "members" && outside > 0.005) {
      people.push({ id: "outside_members", name: w0.names.buyers, amount: outside, role: "member", manager_capital: 0, manager_share: 0, loan_rate: 0.08 });
    } else if (t.outside === "warehouse" && outside > 0.005) {
      people[0].amount = outside;
      people[0].role = "warehouse";
      tranches = [{ date: addMonths(w0.close_date, t.sale_months), share: 1, pricing: "carry_simple", rate: t.sale_carry, buyer: w0.names.buyers }];
    }
    Object.assign(out.warehouse, {
      structure: key,
      names: { vehicle: t.vehicle_name.replace("{deal}", dealName), manager: w0.names.manager, buyers: w0.names.buyers },
      unit_price: 1000, reserve, manager_commitment: mc, manager_reserve: 0,
      admin_cost_per_year: t.admin_cost_per_year, admin_cost_method: "fixed",
      acq_fee_pct: t.acq_fee_pct, mgmt_fee_pct: t.mgmt_fee_pct,
      member_hurdle_irr: t.member_hurdle_irr, hurdle_type: "compound", hurdle_basis: "pooled",
      promote: t.promote, warehouse_promote: t.promote, promote_on_manager_units: true,
      people,
      selldown: { credit_distributions: true, tranches },
    });  // LTEC's own terms (buy-ins, waterfall, loans, vesting) stay
    return out;
  }
  // ---- ids, paths and variants (see core.py)
  function personId(name, taken) {
    const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "person";
    const t = new Set(taken || []);
    let pid = base, n = 2;
    while (t.has(pid)) { pid = `${base}_${n}`; n += 1; }
    return pid;
  }
  const ID_SEG = /^([^\[\]]+)\[([^\]]+)\]$/;
  function getPath(obj, path) {
    let cur = obj;
    for (const seg of path.split(".")) {
      const m = seg.match(ID_SEG);
      if (m) {
        const lst = cur && typeof cur === "object" && !Array.isArray(cur) ? cur[m[1]] : null;
        cur = (lst || []).find((x) => x && typeof x === "object" && x.id === m[2]);
      } else if (Array.isArray(cur)) cur = /^\d+$/.test(seg) ? cur[+seg] : undefined;
      else if (cur && typeof cur === "object") cur = cur[seg];
      else return null;
      if (cur === undefined || cur === null) return null;
    }
    return cur;
  }
  function setPath(obj, path, value) {
    const segs = path.split(".");
    let cur = obj;
    for (let n = 0; n < segs.length; n++) {
      const seg = segs[n], last = n === segs.length - 1, m = seg.match(ID_SEG);
      if (m) {
        const lst = cur[m[1]], iid = m[2];
        const idx = lst.findIndex((x) => x && typeof x === "object" && x.id === iid);
        if (last) {
          if (value === null || value === undefined) { if (idx >= 0) lst.splice(idx, 1); }
          else if (idx < 0) lst.push(Object.assign({}, value, { id: iid }));
          else lst[idx] = Object.assign({}, value, { id: iid });
          return;
        }
        if (idx < 0) throw new Error(`${path}: no item with id ${iid}`);
        cur = lst[idx];
      } else {
        const key = Array.isArray(cur) ? +seg : seg;
        if (last) { cur[key] = value; return; }
        cur = cur[key];
      }
    }
  }
  function mergeDeep(base, changes) {
    const out = JSON.parse(JSON.stringify(base));
    Object.entries(changes).forEach(([k, v]) => {
      const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);
      out[k] = isObj(v) && isObj(out[k]) ? mergeDeep(out[k], v) : JSON.parse(JSON.stringify(v));
    });
    return out;
  }
  function applyVariant(inp, alt, lib) {
    let out = JSON.parse(JSON.stringify(inp));
    if (alt.structure) out = applyStructure(out, alt.structure, lib);
    if (alt.changes) out = mergeDeep(out, alt.changes);
    Object.entries(alt.set || {}).forEach(([p, v]) => setPath(out, p, JSON.parse(JSON.stringify(v))));
    return out;
  }
  function referenceIssues(inp, strict) {
    const w = inp.warehouse, ids = w.people.map((p) => p.id), out = [];
    if (ids.some((i) => !i)) out.push("a person has no id");
    const dup = [...new Set(ids.filter((i, k) => i && ids.indexOf(i) !== k))].sort();
    if (dup.length) out.push(`duplicate ids: ${dup.join(", ")}`);
    const known = new Set(ids.filter(Boolean).concat(strict ? [] : w.people.map((p) => nameKey(p.name))));
    const ok = (r) => !!r && (known.has(r) || (!strict && known.has(nameKey(r))));
    (w.manager_loans || []).forEach((ln, q) => ["lender", "borrower"].forEach((role) => { if (!ok(ln[role])) out.push(`partner loan ${q + 1}: ${role} '${ln[role]}' is not a person`); }));
    (w.manager_vesting || []).forEach((v, q) => { if (!ok(v.person)) out.push(`vesting ${q + 1}: '${v.person}' is not a person`); });
    (w.manager_transfers || []).forEach((x, q) => ["buyer", "seller"].forEach((role) => { if (!ok(x[role])) out.push(`buy-in ${q + 1}: ${role} '${x[role]}' is not a person`); }));
    return out;
  }
  function fillLabel(text, inp) {
    const w = inp.warehouse, names = Object.assign({}, w.names);
    w.people.forEach((p) => { if (p.id) names[p.id] = p.name; });
    return (text || "").replace(/\{([a-z0-9_]+)\}/g, (m0, k) => (k in names ? names[k] : m0));
  }
  const api = { runAll, runCase, caseOperations, caseDeal, sensitivity, warehouse, warehouseCase, runWaterfall, irr, xirr, addMonths, applyStructure, structurePartners,
    personId, getPath, setPath, mergeDeep, applyVariant, fillLabel, referenceIssues };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DealEngine = api;
})(typeof window !== "undefined" ? window : this);
