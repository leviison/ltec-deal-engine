"""Export model results to an Excel workbook for lenders / partners.
    python scripts/export_excel.py <deal-slug> [out.xlsx]
Values only (the logic lives in engine/core.py). Inputs used are written to the
'Inputs' sheet so the file stands on its own.
"""
import json
import sys
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from engine.core import load_deal, run_all  # noqa: E402

USD, PCT, MULT = '#,##0;[Red](#,##0)', '0.0%;[Red]-0.0%', '0.00"x"'
BOLD, HEAD = Font(bold=True), PatternFill("solid", fgColor="E3EBF6")


def header(ws, row, values):
    for i, v in enumerate(values, 1):
        c = ws.cell(row, i, v)
        c.font, c.fill = BOLD, HEAD
        c.alignment = Alignment(horizontal="center" if i > 1 else "left")


def main(slug, out):
    inp = load_deal(slug)
    res = run_all(inp)
    wb = Workbook()

    ws = wb.active
    ws.title = "Summary"
    ws["A1"], ws["A1"].font = f"{inp['meta']['name']} — LP returns by case", Font(bold=True, size=14)
    ws["A2"] = f"Model {inp['version']} · inputs as of {inp['as_of']} · investor check ${inp['investor']['check']:,.0f}"
    header(ws, 4, ["Case", "LP IRR", "Multiple", "Avg cash yield Y1-4", "Year-6 NOI", "Exit cap",
                   "Gross exit value", "Investor total", "Investor profit"])
    for r, c in enumerate(res["cases"].values(), 5):
        vals = [c["label"], c["lp"]["irr"], c["lp"]["multiple"], c["lp"]["avg_cash_yield_y1_4"], c["exit"]["y6_noi"],
                c["exit"]["exit_cap"], c["exit"]["gross_value"], c["investor"]["total"], c["investor"]["profit"]]
        for i, (v, f) in enumerate(zip(vals, [None, PCT, MULT, PCT, USD, '0.00%', USD, USD, USD]), 1):
            cell = ws.cell(r, i, v)
            if f:
                cell.number_format = f
    r = 11
    ws.cell(r, 1, "Investor distributions by year").font = BOLD
    header(ws, r + 1, ["Case", "Year 1", "Year 2", "Year 3", "Year 4", "Year 5 / exit", "Total"])
    for i, c in enumerate(res["cases"].values(), r + 2):
        ws.cell(i, 1, c["label"])
        for j, v in enumerate(c["investor"]["distributions"] + [c["investor"]["total"]], 2):
            ws.cell(i, j, v).number_format = USD

    for c in res["cases"].values():
        sh = wb.create_sheet(c["label"].split(" (")[0][:28])
        header(sh, 1, [c["label"], "Year 1", "Year 2", "Year 3", "Year 4", "Year 5"])
        o, w = c["operations"], c["waterfall"]
        rows = [("Rents", o["rents"]), ("Other income", o["other_income"]), ("Operating expenses", o["opex"]),
                ("NOI", o["noi"]), ("CapEx / reserves", o["capex"]), ("Debt service", o["debt_service"]),
                ("Asset mgmt fee", o["asset_mgmt_fee"]), ("Operating cash flow", o["operating_cash_flow"]),
                ("Net sale proceeds", [0, 0, 0, 0, c["exit"]["net_sale_proceeds"]]), None,
                ("Pref due", w["pref_due"]), ("To pref", w["to_pref"]), ("Return of capital", w["return_of_capital"]),
                ("LP distributions", w["lp"]), ("Sponsor promote", w["gp"]),
                ("Unreturned capital, end", w["unreturned_end"]), ("Unpaid pref, end", w["unpaid_pref_end"]), None,
                ("Investor distributions", c["investor"]["distributions"])]
        rr = 2
        for row in rows:
            if row:
                sh.cell(rr, 1, row[0]).font = BOLD if row[0] in ("NOI", "Operating cash flow", "LP distributions") else Font()
                for j, v in enumerate(row[1], 2):
                    sh.cell(rr, j, v).number_format = USD
            rr += 1
        sh.column_dimensions["A"].width = 26

    wcfg = inp["warehouse"]
    names = wcfg["names"]
    wh = wb.create_sheet(f"{names['vehicle']} Warehouse"[:31])
    header(wh, 1, ["Metric"] + [c["label"] for c in res["cases"].values()])
    W = res["warehouse"]
    rows = []
    for i, person in enumerate(wcfg["people"]):
        rows.append((f"{person['name']} ({names['manager']}: ${person['manager_capital']:,.0f} capital, "
                     f"{person['manager_share']:.0%} of fees & promote)", None, None))
        for label, key, f in (("  Cash in at close", "cash_in", USD), ("  Back at sell-down", "returned_at_selldown", USD),
                              ("  Net cash at manager buy-ins", "at_buyins", USD), ("  Still at risk", "at_risk", USD), ("  Total profit", "profit", USD), ("  IRR", "irr", PCT)):
            rows.append((label, lambda k, key=key, i=i: W[k]["summary"]["people"][i][key], f))
    first = next(iter(W.values()))
    for g, grp in enumerate(first["buyers"]):
        rows.append((f"{grp['name']} (outside buyer)", None, None))
        rows.append(("  Paid", lambda k, g=g: W[k]["summary"]["buyers"][g]["cost"], USD))
        rows.append(("  Total profit", lambda k, g=g: W[k]["summary"]["buyers"][g]["profit"], USD))
        rows.append(("  IRR from purchase", lambda k, g=g: W[k]["summary"]["buyers"][g]["irr"], PCT))
    for j, tr in enumerate(first["tranches"]):
        rows.append((f"  Sale {j + 1} price ({tr['buyer']}, {tr['date']})", lambda k, j=j: W[k]["tranches"][j]["price"], USD))
    rows.append((names["manager"], None, None))
    rows.append(("  Promote earned", lambda k: W[k]["summary"]["manager_promote_total"], USD))
    rows.append(("  Fees earned", lambda k: W[k]["summary"]["manager_fees_total"], USD))
    rows.append(("  Interest owed to lenders", lambda k: W[k]["summary"]["loan_interest_total"], USD))
    for r, (label, fn, f) in enumerate(rows, 2):
        wh.cell(r, 1, label).font = BOLD if fn is None else Font()
        if fn:
            for j, k in enumerate(W, 2):
                wh.cell(r, j, fn(k)).number_format = f
    wh.column_dimensions["A"].width = 30

    si = wb.create_sheet(f"{inp['meta']['name']} Investors"[:31])
    header(si, 1, ["Investor", "Check"] + [f"{c['label']} profit" for c in res["cases"].values()]
           + [f"{c['label']} IRR" for c in res["cases"].values()])
    inv_rows = [(f"{inp['investor']['name']} (via {names['vehicle']})", inp["investor"]["check"],
                 lambda c: c["investor"])]
    inv_rows += [(d["name"], d["check"], lambda c, i=i: c["direct_investors"][i])
                 for i, d in enumerate(inp.get("direct_investors", []))]
    for r, (nm, chk, get) in enumerate(inv_rows, 2):
        si.cell(r, 1, nm); si.cell(r, 2, chk).number_format = USD
        for j, c in enumerate(res["cases"].values()):
            si.cell(r, 3 + j, get(c)["profit"]).number_format = USD
            si.cell(r, 3 + len(res["cases"]) + j, get(c)["irr"]).number_format = PCT
    si.column_dimensions["A"].width = 34

    cf = wb.create_sheet("Cash Flows by Date")
    t = inp.get("timing", {})
    cf["A1"] = ("Timing: " + ("Redstone schedule (actual payment dates)" if t.get("mode") == "schedule"
                              else "annual, on the close anniversary (v10 / SV26 workbook convention)"))
    header(cf, 2, ["Case", "Party", "Entity", "Date", "Kind", "Amount"])
    r = 3
    close = inp["warehouse"]["close_date"]
    for k, c in res["cases"].items():
        R = W[k]
        T, X = len(R["tranches"]), len(R["manager_transfers"])
        dist_dates = R["dates"][1 + T + X:]
        parties = []
        for i, person in enumerate(wcfg["people"]):
            fl = R["people"][i]["flows"]
            parties.append((person["name"], names["vehicle"], [
                (R["dates"][j], ("in" if j == 0 else ("sale / buy-in" if j <= T + X else "distribution")), a)
                for j, a in enumerate(fl)]))
        for gi, g in enumerate(R["buyers"]):
            bd = [x["date"] for x in R["tranches"]] + dist_dates
            parties.append((g["name"], "Outside buyer", [(bd[j], "in" if j < T else "distribution", a)
                                                        for j, a in enumerate(g["flows"])]))
        pd = c["payments"]["dates"]
        parties.append((f"{inp['investor']['name']} (via {names['vehicle']})", inp["meta"]["name"],
                        [(close, "in", -inp["investor"]["check"])] + [(d, "distribution", a) for d, a in zip(pd, c["investor"]["payments"])]))
        for d in c["direct_investors"]:
            parties.append((d["name"], inp["meta"]["name"] + " (direct)",
                            [(close, "in", -d["check"])] + [(dd, "distribution", a) for dd, a in zip(pd, d["payments"])]))
        for name, ent, flows in parties:
            for d, kind, a in sorted(flows, key=lambda x: x[0]):
                if abs(a) < 0.005:
                    continue
                for col, v in enumerate((c["label"], name, ent, d, kind, a), 1):
                    cell = cf.cell(r, col, v)
                    if col == 6:
                        cell.number_format = USD
                r += 1
    cf.column_dimensions["A"].width = 16
    cf.column_dimensions["B"].width = 30

    iw = wb.create_sheet("Inputs")
    iw["A1"] = f"Inputs used (deals/{slug}/deal.json)"
    for i, line in enumerate(json.dumps(inp, indent=2).splitlines(), 3):
        iw.cell(i, 1, line).font = Font(name="Consolas", size=9)

    for sheet in wb.worksheets:
        if sheet.title != "Inputs":
            for col in "BCDEFGHI":
                sheet.column_dimensions[col].width = 16
    wb["Summary"].column_dimensions["A"].width = 18
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    wb.save(out)
    print("wrote", out)


if __name__ == "__main__":
    slug = sys.argv[1] if len(sys.argv) > 1 else "siena-villas"
    main(slug, sys.argv[2] if len(sys.argv) > 2 else str(ROOT / "dist" / slug / f"{slug}_model_export.xlsx"))
