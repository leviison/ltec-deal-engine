"""Randomized set-ups for Siena Villas, used by tests/test_parity.py (Python vs JS) and the reconciliation test."""
import copy
import random


def randomized(base, seed):
    r = random.Random(seed)
    inp = copy.deepcopy(base)
    inp["investor"]["check"] = r.choice([250000, 500000, 1000000, 1500000])
    inp["waterfall"]["pref_compounds"] = r.random() < 0.5
    for k in ("base", "downside", "stress"):
        c = inp["cases"][k]
        c["rent_growth_y3_plus"] = r.uniform(-0.02, 0.05)
        c["opex_growth"] = r.uniform(0.0, 0.06)
        c["exit_cap"] = r.uniform(0.045, 0.075)
    inp["deal"]["disposition_fee_pct"] = r.choice([0, 0.005, 0.01])
    c = inp["cases"]["custom"]
    for k in ("rents", "other_income", "opex", "capex"):
        c[k] = [v * r.uniform(0.85, 1.15) for v in c[k]]
    c.update(rent_growth_y6=r.uniform(-0.02, 0.05), other_income_growth_y6=r.uniform(-0.02, 0.05),
             opex_growth_y6=r.uniform(0.0, 0.06), exit_method=r.choice(["cap_rate", "sale_price"]),
             exit_cap=r.uniform(0.045, 0.075), sale_price=r.uniform(9e6, 26e6))
    w = inp["warehouse"]
    w["manager_reserve"] = r.choice([0, 0, 50000, r.uniform(0, 1e5)])
    w.update(hurdle_type=r.choice(["compound", "simple"]), hurdle_basis=r.choice(["pooled", "per_member"]),
             promote_on_manager_units=r.random() < 0.6)
    inp["deal"].update(debt_service_method=r.choice(["fixed", "interest_only"]), loan_rate=r.uniform(0.04, 0.07),
                       assumption_fee_pct=r.choice([0, 0.01, 0.005]), asset_mgmt_fee_pct_of_income=r.choice([0.01, 0.0, 0.02]))
    wf = inp["waterfall"]
    wf.update(pref_rate=r.choice([0.06, 0.07, 0.08]), residual_lp_share=r.choice([0.6, 0.5, 0.7]))
    wf["tiers"] = [{"lp_irr_hurdle": r.choice([0.10, 0.12]), "lp_share": r.choice([0.8, 0.75])},
                   {"lp_irr_hurdle": r.choice([0.14, 0.15]), "lp_share": r.choice([0.7, 0.65])}]
    w.update(admin_cost_method=r.choice(["fixed", "pct_raise"]), admin_cost_pct=r.uniform(0, 0.03),
             acq_fee_pct=r.choice([0, 0.01, 0.02]), mgmt_fee_pct=r.choice([0, 0.005, 0.01]),
             member_hurdle_irr=r.uniform(0.06, 0.12), promote=r.uniform(0.2, 0.5))
    n = r.randint(1, 4)
    w["warehouse_promote"] = r.choice([w["promote"], 0.0, r.uniform(0, 0.5)])
    mg = [r.random() for _ in range(n)]
    short = inp["investor"]["check"] + w["reserve"] - w["manager_commitment"]
    sf = [r.random() for _ in range(n)]
    names = [f"P{i}" for i in range(n)]
    mcp = [r.random() for _ in range(n)]
    mcap = w["manager_commitment"] + w["manager_reserve"]
    w["people"] = [{"id": f"x{i}", "name": names[i], "amount": short * sf[i] / sum(sf), "manager_share": mg[i] / sum(mg),
                    "manager_capital": mcap * mcp[i] / sum(mcp),
                    "role": r.choice(["member", "warehouse", "loan"]), "loan_rate": r.uniform(0.0, 0.14)} for i in range(n)]
    w["manager_transfers"] = [{"date": r.choice(["2027-01-15", "2027-06-30", "2027-11-05", "2028-06-30", "2029-03-01"]),
                               "buyer": r.choice(names + ["Nobody"]), "seller": r.choice(names),
                               "interest": r.choice(["both", "capital", "promote"]), "price": r.uniform(0, 1e5),
                               "mode": r.choice(["share", "amount"]), "share": r.uniform(0, 0.8),
                               "amount": r.uniform(0, 3e5), "pricing": r.choice(["carry_simple", "carry_compound", "premium"]),
                               "rate": r.uniform(-0.1, 0.12), "credit_distributions": r.random() < 0.5}
                              for _ in range(r.randint(0, 3))]
    if r.random() < 0.6:
        inp["timing"].update(mode="schedule", siena_frequency=r.choice([1, 2, 4]),
                             vehicle_frequency=r.choice([0, 0, 1, 2, 4]),
                             vehicle_first_distribution=r.choice([None, "2027-08-15", "2027-05-01"]),
                             vehicle_holdback=r.choice([0, 0.5, r.uniform(0, 1)]),
                             vehicle_final_lag_months=r.choice([0, 0, 3, 6]),
                             acq_fee_after_first=r.random() < 0.5,
                             first_distribution=r.choice(["2027-02-05", "2027-04-20", "2027-06-30"]),
                             sale_date=r.choice(["2031-06-30", "2031-10-30", "2031-11-05", "2032-01-15"]))
    d = inp["deal"]
    d["hold_years"] = r.choice([5, 5, 3, 4, 6, 7, 8, 10])
    if r.random() < 0.5 and d["hold_years"] > 1:
        d["refi"].update(enabled=True, year=r.randint(1, d["hold_years"] - 1), sizing=r.choice(["ltv", "amount"]),
                         ltv=r.uniform(0.5, 0.75), amount=r.uniform(9e6, 15e6),
                         appraisal_cap=r.choice([0, 0, r.uniform(0.045, 0.07)]), dscr_min=r.choice([0, 1.2, 1.25, 1.35]),
                         rate=r.uniform(0.045, 0.075), io_years=r.choice([0, 0, 2, 5]), amort_years=r.choice([25, 30]),
                         cost_pct=r.uniform(0, 0.02), crystallize=r.random() < 0.6,
                         side_letter_protects=r.random() < 0.7)
    inp["direct_investors"] = [{"name": "D", "check": r.uniform(0, 5e5)}] if r.random() < 0.5 else []
    dates = ["2027-01-15", "2027-03-31", "2027-12-01", "2028-06-30", "2029-02-01"]
    w["selldown"]["credit_distributions"] = r.random() < 0.7
    w["selldown"]["tranches"] = [{"date": r.choice(dates), "share": r.uniform(0, 0.7),
                                  "pricing": r.choice(["carry_simple", "carry_compound", "premium"]),
                                  "rate": r.uniform(-0.1, 0.12),
                                  "buyer": r.choice(["", "Fund A", "Fund B"] + names)} for _ in range(r.randint(0, 3))]
    # LTEC's own split between its partners (issue #9)
    pn = [r.choice([p["id"], p["name"]]) for p in w["people"]]  # people by id, or by name as older files do
    w["manager_waterfall"] = {"enabled": r.random() < 0.5, "pref": r.choice([0.0, 0.06, 0.08, 0.1]),
                              "pref_type": r.choice(["compound", "simple"]),
                              "tiers": [{"capital_share": r.choice([0.0, 0.3, 0.5, 1.0]), "to_irr": r.choice([0.12, 0.15, 0.2])}
                                        for _ in range(r.randint(0, 2))],
                              "residual_capital_share": r.choice([0.0, 0.2, 0.5])}
    w["manager_loans"] = [{"lender": r.choice(pn), "borrower": r.choice(pn + ["Nobody"]), "amount": r.uniform(0, 2e5),
                           "rate": r.uniform(0, 0.12), "rate_type": r.choice(["simple", "compound"]),
                           "recourse": r.random() < 0.5} for _ in range(r.randint(0, 2))] if r.random() < 0.5 else []
    w["manager_vesting"] = [{"person": r.choice(pn), "years": r.choice([0, 3, 4]), "cliff_years": r.choice([0, 1]),
                             "leaves": r.choice(["", "2027-06-30", "2028-11-05", "2030-01-01"]),
                             "terms": r.choice(["keep_vested", "forfeit"])} for _ in range(r.randint(0, 2))] if r.random() < 0.5 else []
    rt = random.Random(seed + 7919)  # loan terms (#24) on their own stream so earlier draws stay the same
    for ln in w["manager_loans"]:
        if rt.random() < 0.7:
            ln.update({"repayment": rt.choice(["sweep", "interest_only", "equal_principal", "at_exit", "none"]),
                       "sweep_pct": rt.choice([1.0, 0.5, 0.25]), "term_years": rt.choice([0, 3, 5, 10]),
                       "source": rt.choice(["manager_cash", "borrower"]),
                       "maturity": rt.choice(["", "", "2028-06-30", "2029-10-10", "2040-01-01"]),
                       "on_leave": rt.choice(["continues", "due", "forgiven"]),
                       "due_on": rt.choice(["cash_date", "exact_date"]),
                       "at_maturity": rt.choice(["settle", "sweep"]),
                       "paydowns": [{"date": rt.choice(["2027-01-15", "2027-06-30", "2028-02-29", "2029-10-10", "2035-01-01"]),
                                     "amount": rt.choice([0.0, 5000.0, 50000.0, 1e6])} for _ in range(rt.randint(0, 2))]})
    return inp
