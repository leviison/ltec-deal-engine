"""Pull tie-out values from the sponsor model into deals/the-bend/reference/excel_values.json.
    python deals/the-bend/extract_reference.py
Reads cached values (the workbook as saved by the sponsor, 9-23-26); no recalculation needed.
"""
import json
import warnings
from pathlib import Path

import openpyxl

warnings.simplefilter("ignore")
HERE = Path(__file__).parent
wb = openpyxl.load_workbook(HERE / "reference" / "TheBend_proforma_InvestmentMemo_CMBS-Citi_9-23-26.xlsm", data_only=True)
uw, pr = wb["UW Model"], wb["Partnership Returns - Annual"]
se, sl = wb["IRR Sensitivity"], wb["Sample LP Returns"]

Y = "MNOPQ"  # UW Model, Years 1-5
row = lambda ws, r, cols: [ws[f"{c}{r}"].value for c in cols]  # noqa: E731

out = {
    "_about": "Values from the sponsor model, read by deals/the-bend/extract_reference.py.",
    "ops": {k: row(uw, r, Y) for k, r in [("rental", 62), ("other", 68), ("egi", 70), ("opex", 92), ("noi", 98),
                                          ("capex", 124), ("tif", 125), ("ds", 152), ("am", 163), ("cfad", 164)]},
    "sale": {k: uw[c].value for k, c in [("gross", "Q166"), ("costs", "Q167"), ("payoff", "Q168"), ("reserves", "Q171"),
                                         ("dispo", "Q172"), ("bond", "Q173"), ("proceeds", "Q174")]},
    "partnership": {  # 'Partnership Returns - Annual': IRR-hurdle waterfall (the deck's headline 17.08%)
        "cash": row(pr, 49, "GHIJK"), "lp": row(pr, 65, "GHIJK"), "gp": row(pr, 72, "GHIJK"),
        "irr": pr["D68"].value, "multiple": pr["D69"].value, "gp_fees": row(pr, 73, "FGHIJK"),
    },
    "uw": {  # UW Model tab: simple pref, operating excess split, capital from the sale
        "lp": row(uw, 222, Y),
        "gp": [(uw[f"{c}228"].value or 0) + (uw[f"{c}229"].value or 0) for c in Y],
        "irr": uw["I223"].value,
    },
    "sensitivity_uw": [[se[f"{c}3"].value, se[f"{c}4"].value] for c in "HIJKLMN"],
    "sample_100k": {"ownership": sl["F5"].value, "distributions": row(sl, 10, "GHIJK")},
}
(HERE / "reference" / "excel_values.json").write_text(json.dumps(out, indent=1) + "\n")
print("wrote", HERE / "reference" / "excel_values.json")
