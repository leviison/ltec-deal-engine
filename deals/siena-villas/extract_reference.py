"""Pull tie-out values from the legacy workbooks (recalculated with LibreOffice) into
deals/siena-villas/reference/excel_values.json. Run once per workbook version:
    soffice --headless --convert-to xlsx --outdir /tmp/recalc deals/siena-villas/reference/*.xlsx
    python deals/siena-villas/extract_reference.py /tmp/recalc
"""
import json, sys
from pathlib import Path
import openpyxl

d = Path(sys.argv[1])
v10 = openpyxl.load_workbook(d / "Siena_Villas_Investment_Model_v10.xlsx", data_only=True)
wh = openpyxl.load_workbook(d / "Siena_Villas_SV26_Warehouse_Model.xlsx", data_only=True)
sm, ed, wcf, ws = v10["Scenario Model"], v10["Exit & Disposition"], wh["Cash Flows"], wh["Summary"]
blocks = {"sponsor": (32, 35, 22), "base": (66, 69, 56), "downside": (100, 103, 90), "stress": (134, 137, 124)}
out = {"cases": {}, "warehouse": {}}
for k, (lp_row, irr_row, nsp_row) in blocks.items():
    out["cases"][k] = {
        "lp": [sm.cell(lp_row, c).value for c in range(2, 7)],
        "gp": [sm.cell(lp_row + 1, c).value for c in range(2, 7)],
        "ocf": [sm.cell(lp_row - 18, c).value for c in range(2, 7)],
        "irr": sm.cell(irr_row, 2).value, "multiple": sm.cell(irr_row + 1, 2).value,
        "nsp": sm.cell(nsp_row, 2).value,
    }
out["custom_exit"] = {"gross": ed["B18"].value, "nsp": ed["B23"].value, "irr": ed["B35"].value}
out["sensitivity_lp_irr"] = [[ed.cell(r, c).value for c in range(2, 7)] for r in range(44, 51)]
cols = {"sponsor": "B", "base": "C", "downside": "D", "stress": "E"}
for k, c in cols.items():
    out["warehouse"][k] = {name: ws[f"{c}{r}"].value for name, r in
                           [("levi_cash_in", 7), ("levi_returned_at_selldown", 8), ("levi_at_risk", 9),
                            ("levi_profit", 10), ("levi_irr", 11), ("thaxter_profit", 15), ("thaxter_irr", 16),
                            ("new_member_price", 18), ("new_member_irr", 19), ("ltec_promote_total", 20)]}
    out["warehouse"][k]["levi_profit_by_pct_sold"] = {str(p): ws[f"{c}{r}"].value
                                                     for p, r in [(0, 33), (0.25, 34), (0.5, 35), (0.75, 36), (1.0, 37)]}
(Path(__file__).parent / "reference" / "excel_values.json").write_text(json.dumps(out, indent=1))
print("wrote reference/excel_values.json")
