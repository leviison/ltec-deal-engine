"""Randomized set-ups for Lapetco OXY 2, used by tests/test_oil_gas.py (Python vs JS parity): checks, decline shapes
(exponential and hyperbolic, with and without a terminal decline), price decks, costs, tax treatments, assessments,
online dates, pay lags and horizons."""
import copy
import random


def randomized(base, seed):
    r = random.Random(4600 + seed)
    inp = copy.deepcopy(base)
    d, inv = inp["deal"], inp["investor"]
    inv["check"] = r.choice([250000, 500000, 1000000, r.uniform(1e5, 2e6)])
    inv["tax_rate"] = r.uniform(0.2, 0.5)
    d["pay_lag_months"] = r.choice([0, 1, 2, 3])
    d["pay_day"] = r.choice([1, 20, 31])
    d["horizon_months"] = r.choice([60, 180, 360, 480])
    d["fund_date"] = r.choice(["2026-11-25", "2026-09-30", "2027-01-15"])
    d["back_pay_date"] = r.choice(["2026-12-20", "2026-11-01", "2027-02-20"])
    d["monthly_management_fee"] = r.choice([0, 1000, 5000])
    for w in d["wells"]:
        w["online"] = r.choice(["2026-08-20", "2026-08-01", "2026-10-01", "2026-12-31", "2027-03-15"])
    for k, c in inp["cases"].items():
        if k == "sponsor":
            continue
        pr = c.setdefault("production", {})
        pr["rate"] = r.uniform(150, 1200)
        pr["rate_month"] = r.choice(["2026-11", "2027-04", "2028-01"])
        pr["b"] = r.choice([0.0, 0.5, 1.0, 1.4])
        pr["di"] = r.choice([0.0, 0.3, 1.2, 2.5, 4.0])
        pr["dmin"] = r.choice([0.0, 0.06, 0.1])
        c["oil_share"] = r.uniform(0.3, 1.0)
        c["gas_ngl_price"] = r.choice([None, r.uniform(5, 30)])
        c["wti"] = {"history": r.choice([{}, {"2026-10": 104}]),
                    "years": {str(y): r.uniform(40, 110) for y in range(2026, 2026 + r.randint(0, 6))},
                    "long_term": r.uniform(35, 100)}
        c["differential"] = r.uniform(-2, 12)
        c["production_tax"] = r.uniform(0, 0.15)
        c["gathering"] = r.uniform(0, 5)
        c["loe_per_boe"] = r.uniform(0, 20)
        c["loe_per_well_month"] = r.choice([0, 5000, 25000])
        c["fixed_per_unit_month"] = r.choice([0, 1596.5])
        c["tax"] = {"year1_deductible": r.uniform(0, 1), "rest": r.choice(["cost_depletion", "next_year"]),
                    "percentage_depletion": r.choice([0, 0.15])}
        c["assessments"] = r.choice([[], [{"date": "2027-06-20", "per_unit": r.uniform(0, 2e5)}],
                                     [{"date": "2026-12-01", "per_unit": 5e4}, {"date": "2029-03-01", "per_unit": 1e5}]])
    return inp
