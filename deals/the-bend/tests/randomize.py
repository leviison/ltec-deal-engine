"""Randomized set-ups for The Bend, used by tests/test_parity.py (Python vs JS) and the reconciliation check.
Exercises what this deal added to the engine: trailing exit NOI, below-NOI income and its value at sale, reserves
returned, return of capital from capital events only, IRR-hurdle vs simple pref, and side-letter terms - plus
holds, refinances, crystallization and dated timing."""
import copy
import random


def randomized(base, seed):
    r = random.Random(1000 + seed)
    inp = copy.deepcopy(base)
    d, wf, inv = inp["deal"], inp["waterfall"], inp["investor"]
    inv["check"] = r.choice([250000, 1000000, 2000000])
    inp["warehouse"]["people"][0]["amount"] = inv["check"]  # the pass-through vehicle's one member funds the check
    d["exit_noi_basis"] = r.choice(["trailing", "trailing", "forward"])
    d["reserves_returned_at_sale"] = r.choice([0, d["reserves_returned_at_sale"], r.uniform(0, 5e5)])
    b = d["below_noi_income"]
    b["sale_value"] = r.choice(["npv", "none"])
    b["npv_rate"] = r.uniform(0.04, 0.10)
    b["amounts"] = r.choice([b["amounts"], b["amounts"][:r.randint(0, 15)], [r.uniform(0, 6e5)] * r.randint(1, 12)])
    d["asset_mgmt_fee_pct_of_income"] = r.choice([0.0, 0.01, 0.02])
    d["disposition_fee_pct"] = r.choice([0.0, 0.01])
    d["debt_service_method"] = r.choice(["interest_only", "fixed"])
    d["loan_rate"] = r.uniform(0.045, 0.075)
    wf.update(pref_rate=r.choice([0.07, 0.08, 0.09]), pref_compounds=r.random() < 0.5,
              return_of_capital=r.choice(["all_cash", "capital_events"]),
              residual_lp_share=r.choice([0.5, 0.7, 0.8]))
    wf["tiers"] = r.choice([[], [{"lp_irr_hurdle": 0.15, "lp_share": 0.8}],
                            [{"lp_irr_hurdle": r.uniform(0.1, 0.15), "lp_share": 0.8},
                             {"lp_irr_hurdle": r.uniform(0.16, 1.0), "lp_share": r.choice([0.7, 0.8])}]])
    if r.random() < 0.6:
        inv["side_letter"] = {"enabled": True, "terms": r.choice([
            {}, {"pref_rate": 0.09}, {"pref_rate": r.uniform(0.07, 0.11), "residual_lp_share": 0.9,
                                      "tiers": [{"lp_irr_hurdle": 0.15, "lp_share": 0.9}]},
            {"return_of_capital": r.choice(["all_cash", "capital_events"]), "pref_compounds": r.random() < 0.5}])}
    for k in ("sponsor", "custom"):
        c = inp["cases"][k]
        for key in ("rents", "other_income", "opex", "capex"):
            c[key] = [v * r.uniform(0.85, 1.15) for v in c[key]][:r.choice([5, 8])]
        c.update(exit_cap=r.uniform(0.045, 0.07), exit_method=r.choice(["cap_rate", "cap_rate", "sale_price"]),
                 sale_price=r.uniform(5e7, 8e7), rent_growth_y6=r.uniform(-0.01, 0.05), opex_growth_y6=r.uniform(0, 0.05))
    d["hold_years"] = r.choice([5, 5, 3, 4, 6, 7, 8, 10])
    if r.random() < 0.4 and d["hold_years"] > 1:
        d["refi"].update(enabled=True, year=r.randint(1, d["hold_years"] - 1), sizing=r.choice(["ltv", "amount"]),
                         ltv=r.uniform(0.5, 0.75), amount=r.uniform(3e7, 5e7), dscr_min=r.choice([0, 1.25]),
                         rate=r.uniform(0.045, 0.07), io_years=r.choice([0, 2]), cost_pct=r.uniform(0, 0.02),
                         crystallize=r.random() < 0.4, side_letter_protects=r.random() < 0.5)
    if r.random() < 0.5:
        inp["timing"].update(mode="schedule", siena_frequency=r.choice([1, 2, 4]), vehicle_frequency=r.choice([0, 2, 4]),
                             vehicle_first_distribution=r.choice(["2027-03-31", "2027-06-30"]),
                             vehicle_holdback=r.choice([0, 0.5]), vehicle_final_lag_months=r.choice([0, 3]),
                             first_distribution=r.choice(["2027-01-31", "2027-03-31"]),
                             sale_date=r.choice(["2031-10-10", "2032-01-31"]))
    inp["direct_investors"] = [{"name": "D", "check": r.uniform(0, 5e5)}] if r.random() < 0.3 else []
    return inp
