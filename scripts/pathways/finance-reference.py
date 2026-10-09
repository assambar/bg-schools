#!/usr/bin/env python3
"""Reference finance calculator (stdlib only), the source of truth for src/pathways/finance.ts.

    python3 scripts/pathways/finance-reference.py > tests/fixtures/finance-reference.json

Prints the default results as JSON; tests/finance.test.ts checks that the TypeScript port
gives the same numbers. Inputs and sources: data/finance/assumptions.yaml. Not financial advice.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent

DEFAULTS = {  # = data/finance/assumptions.yaml defaults + fixed
    "monthly_per_child": 1000.0, "kids": 2, "months_per_year": 9, "start_year": 2027, "kid_offsets": [0, 2],
    "horizons": {"pg2_to_g4": 5, "pg2_to_g7": 8, "pg2_to_g12": 13}, "uni_start_after_years": 13,
    "degree_years": [4], "contribution_growth": 0.0, "fee_growth": {"base": 0.05}, "uni_cost_growth": 0.03,
    "eur_inflation": 0.02, "ter": 0.0007, "capital_gains_tax": 0.0, "loan_apr": 0.0942, "loan_term_years": 5,
    "mortgage_apr": 0.0277, "mortgage_term_years": 25, "sofia_eur_per_m2": 2680.0, "rent_yield_gross": [0.04, 0.06],
    "avg_gross_wage_eur": 1444.0, "fx": {"USD": 1.1186, "GBP": 0.84698, "CHF": 0.9326}, "tutoring_per_year": 1850.0,
}

def load_returns():
    rows = [l.strip().split(",") for l in open(ROOT / "data/finance/sp500-total-return.csv") if l[:1].isdigit()]
    return {int(y): float(v) for y, v in rows}

def cagr(r, a, b):
    p = 1.0
    for y in range(a, b + 1):
        p *= 1 + r[y]
    return p ** (1 / (b - a + 1)) - 1

def return_scenarios(r, window=13):
    ys = sorted(r)
    w = sorted(cagr(r, s, s + window - 1) for s in ys if s + window - 1 <= ys[-1])
    q = lambda p: w[int(p * (len(w) - 1))]
    return {
        "pessimistic": {"nominal_usd": q(0.10), "basis": f"10th percentile of rolling {window}-year CAGR 1928-2025 ({len(w)} windows)"},
        "cautious": {"nominal_usd": cagr(r, 2000, 2025), "basis": "CAGR 2000-2025"},
        "base": {"nominal_usd": cagr(r, 1928, 2025), "basis": "CAGR 1928-2025"},
        "optimistic": {"nominal_usd": q(0.90), "basis": f"90th percentile of rolling {window}-year CAGR 1928-2025"},
        "worst_window": {"nominal_usd": w[0], "basis": f"worst rolling {window}-year CAGR (info only)"},
    }

# ----------------------------------------------------------------------------- core flows
def contributions(cfg, years):
    """Per-child list of (year_index, month_index_from_start, amount) for school-year months."""
    out = []
    m = cfg["months_per_year"]
    for t in range(years):
        amt = cfg["monthly_per_child"] * (1 + cfg["contribution_growth"]) ** t
        for k in range(m):              # Sep (k=0) .. May (k=8) when m=9
            out.append((t, 12 * t + k, amt))
    return out

def fv_invest(cfg, years, annual_r, hold_until_years=None):
    """Value of monthly contributions (school months only) at the end of `years` school years
    (end of August), optionally held without new money until `hold_until_years`."""
    net = (1 + annual_r) * (1 - cfg["ter"]) - 1
    mr = (1 + net) ** (1 / 12) - 1
    end = 12 * years
    v = sum(a * (1 + mr) ** (end - mi) for _, mi, a in contributions(cfg, years))
    paid = sum(a for _, _, a in contributions(cfg, years))
    if hold_until_years and hold_until_years > years:
        v *= (1 + mr) ** (12 * (hold_until_years - years))
    gain = v - paid
    v_after_tax = v - max(gain, 0) * cfg["capital_gains_tax"]
    return paid, v_after_tax

def annuity_payment(p, apr, n_years):
    i = apr / 12; n = 12 * n_years
    return p * i / (1 - (1 + i) ** -n)

def loan_scenario(cfg, years):
    """Each school year's fees (months x monthly) borrowed in September as one consumer loan."""
    principal = total = 0.0
    last_payment_month = 0
    for t in range(years):
        p = cfg["monthly_per_child"] * cfg["months_per_year"] * (1 + cfg["contribution_growth"]) ** t
        pay = annuity_payment(p, cfg["loan_apr"], cfg["loan_term_years"])
        principal += p; total += pay * 12 * cfg["loan_term_years"]
        last_payment_month = max(last_payment_month, 12 * t + 12 * cfg["loan_term_years"])
    # peak monthly instalment = overlapping loans
    peak = 0.0
    for m in range(last_payment_month):
        s = 0.0
        for t in range(years):
            if 12 * t <= m < 12 * t + 12 * cfg["loan_term_years"]:
                p = cfg["monthly_per_child"] * cfg["months_per_year"] * (1 + cfg["contribution_growth"]) ** t
                s += annuity_payment(p, cfg["loan_apr"], cfg["loan_term_years"])
        peak = max(peak, s)
    return {"borrowed": principal, "repaid": total, "interest": total - principal,
            "peak_monthly_instalment": peak, "debt_free_after_years": last_payment_month / 12}

# ----------------------------------------------------------------------------- paths
# Fees per child per school year at 2026/27 prices (EUR), by grade index 0=PG2 .. 12=grade 12.
def grades(*spec):
    fees = [None] * 13
    for (a, b, v) in spec:
        for g in range(a, b + 1):
            fees[g] = v
    return fees

T = "tutoring"
PATHS = {  # must match data/pathways/paths.yaml (the unit tests compare the totals)
    "state-smg": {"fees": grades((0, 12, 0.0)), "extras": grades((0, 2, 0.0), (3, 12, T)), "sibling": 0.0, "once": 0.0},
    "rodari-state-smg": {"fees": grades((0, 0, 4230.0), (1, 12, 0.0)), "extras": grades((0, 2, 0.0), (3, 12, T)), "sibling": 0.0, "once": 0.0},
    "drujba-smg": {"fees": grades((0, 0, 7865.0), (1, 4, 7865.0 * 0.9), (5, 12, 0.0)), "extras": grades((0, 2, 0.0), (3, 12, T)), "sibling": 0.10, "once": 0.0},
    "state-lang": {"fees": grades((0, 12, 0.0)), "extras": grades((0, 4, 0.0), (5, 7, T), (8, 12, 0.0)), "sibling": 0.0, "once": 0.0},
    "state-npmg": {"fees": grades((0, 12, 0.0)), "extras": grades((0, 2, 0.0), (3, 12, T)), "sibling": 0.0, "once": 0.0},
    "state-acs": {"fees": grades((0, 7, 0.0), (8, 12, 10540.0)), "extras": grades((0, 4, 0.0), (5, 7, T), (8, 12, 0.0)), "sibling": 0.0, "once": 0.0},
    "quest-acs": {"fees": grades((0, 0, 800.0 * 12), (1, 3, 6750.0 + 300.0), (4, 7, 7500.0 + 300.0), (8, 12, 10540.0)), "extras": grades((0, 12, 0.0)), "sibling": 0.05, "once": 0.0},
    "smg-acs": {"fees": grades((0, 0, 7865.0), (1, 4, 7865.0 * 0.9), (5, 7, 0.0), (8, 12, 10540.0)), "extras": grades((0, 2, 0.0), (3, 7, T), (8, 12, 0.0)), "sibling": 0.10, "once": 0.0},
    "drujba-stay": {"fees": grades((0, 0, 7865.0), (1, 12, 7865.0 * 0.9)), "extras": grades((0, 4, 0.0), (5, 12, T)), "sibling": 0.10, "once": 0.0},
    "bss-ib": {"fees": grades((0, 1, 13800.0), (2, 5, 15180.0), (6, 8, 16260.0), (9, 10, 17590.0), (11, 12, 18750.0)), "extras": grades((0, 12, 0.0)), "sibling": 0.0, "once": 1000.0},
    "aas-ib": {"fees": grades((0, 5, 22300.0 + 3402.0), (6, 8, 23983.0 + 3402.0), (9, 12, 25619.0 + 3402.0)), "extras": grades((0, 12, 0.0)), "sibling": 0.0, "once": 2809.0},
}

def path_costs(cfg, key, g):
    p = PATHS[key]
    budget_y = cfg["monthly_per_child"] * cfg["months_per_year"]
    rows = []
    for kid in range(cfg["kids"]):
        off = cfg["kid_offsets"][kid] if kid < len(cfg["kid_offsets"]) else 0
        for gi in range(13):
            year = cfg["start_year"] + off + gi
            esc = (1 + g) ** (year - 2026)
            fee = p["fees"][gi] * esc
            # sibling discount when the other child is in the same path's paid stage that year
            if kid > 0 and p["sibling"] and fee > 0:
                o_off = cfg["kid_offsets"][0]
                og = year - cfg["start_year"] - o_off
                if 0 <= og < 13 and p["fees"][og] > 0:
                    fee *= 1 - p["sibling"]
            ex = p["extras"][gi]
            extra = (cfg["tutoring_per_year"] if ex == "tutoring" else ex) * esc
            once = p["once"] * esc if gi == 0 else 0.0
            budget = budget_y * (1 + cfg["contribution_growth"]) ** gi
            rows.append({"path": key, "kid": kid + 1, "grade_index": gi, "school_year": f"{year}/{year+1}",
                         "fee": round(fee), "extras": round(extra), "once": round(once),
                         "total": round(fee + extra + once), "budget": round(budget),
                         "leftover": round(budget - fee - extra - once)})
    return rows

# ----------------------------------------------------------------------------- universities
UNIS = [  # must match data/finance/assumptions.yaml
    {"id": "tu-delft", "tuition": (2694, 2694, "EUR"), "living": (909 * 12, 909 * 12, "EUR")},
    {"id": "tum", "tuition": (194, 194, "EUR"), "living": (1300 * 12, 2000 * 12, "EUR")},
    {"id": "ku-leuven", "tuition": (1181.40, 1181.40, "EUR"), "living": (1050 * 12, 1400 * 12, "EUR")},
    {"id": "eth-zurich", "tuition": (4528, 4528, "CHF"), "living": (23572, 23572, "CHF")},
    {"id": "bocconi", "tuition": (17000, 17000, "EUR"), "living": None},
    {"id": "oxford", "tuition": (37380, 62820, "GBP"), "living": (1405 * 9, 2105 * 9, "GBP")},
    {"id": "imperial", "tuition": (45500, 45500, "GBP"), "living": (1821 * 9, 1893 * 9, "GBP")},
    {"id": "mit", "tuition": (92760, 92760, "USD"), "living": (0, 0, "USD")},
]

def to_eur(cfg, amt, cur):
    return amt if cur == "EUR" else amt / cfg["fx"][cur]

def uni_table(cfg, uni_year):
    rows = []
    esc = (1 + cfg["uni_cost_growth"]) ** (uni_year - 2026)
    for u in UNIS:
        tmin, tmax, tc = u["tuition"]
        if u["living"] is None:
            lmin = lmax = None
        else:
            lmin, lmax, lc = u["living"]
            lmin, lmax = to_eur(cfg, lmin, lc), to_eur(cfg, lmax, lc)
        tmin, tmax = to_eur(cfg, tmin, tc), to_eur(cfg, tmax, tc)
        r = {"id": u["id"],
             "per_year_2026_min": round(tmin + (lmin or 0)), "per_year_2026_max": round(tmax + (lmax or 0)),
             "living_included": lmin is not None}
        for n in cfg["degree_years"]:
            r[f"degree_{n}y_min_at_{uni_year}"] = round(sum((tmin + (lmin or 0)) * esc * (1 + cfg["uni_cost_growth"]) ** k for k in range(n)))
            r[f"degree_{n}y_max_at_{uni_year}"] = round(sum((tmax + (lmax or 0)) * esc * (1 + cfg["uni_cost_growth"]) ** k for k in range(n)))
        rows.append(r)
    return rows


def main():
    cfg = DEFAULTS
    rets = return_scenarios(load_returns())
    U = cfg["uni_start_after_years"]; uni_year = cfg["start_year"] + U
    out = {"returns": {k: round(v["nominal_usd"], 6) for k, v in rets.items()}, "invest": [], "borrow": [], "paths": {}}
    for yrs in cfg["horizons"].values():
        row = {"years": yrs, "value_end": {}, "value_at_uni": {}}
        for sc in ("pessimistic", "cautious", "base", "optimistic"):
            paid, v_h = fv_invest(cfg, yrs, rets[sc]["nominal_usd"])
            _, v_u = fv_invest(cfg, yrs, rets[sc]["nominal_usd"], hold_until_years=U)
            row["paid"] = round(paid); row["value_end"][sc] = round(v_h); row["value_at_uni"][sc] = round(v_u)
        out["invest"].append(row)
        l = loan_scenario(cfg, yrs)
        out["borrow"].append({"years": yrs, **{k: round(v) for k, v in l.items()}})
    base_r = rets["base"]["nominal_usd"]; net = (1 + base_r) * (1 - cfg["ter"]) - 1
    for key in PATHS:
        rows = path_costs(cfg, key, cfg["fee_growth"]["base"])
        fv = sum(r["leftover"] * (1 + net) ** (U - r["grade_index"] - 0.5) for r in rows)
        out["paths"][key] = {"cost": sum(r["total"] for r in rows), "budget": sum(r["budget"] for r in rows),
                             "over_budget_kid_years": len([r for r in rows if r["leftover"] < 0]),
                             "max_shortfall": min([r["leftover"] for r in rows] + [0]), "net_surplus_at_uni": round(fv)}
    out["universities"] = {u["id"]: [u["per_year_2026_min"], u["per_year_2026_max"], u[f"degree_4y_min_at_{uni_year}"], u[f"degree_4y_max_at_{uni_year}"]] for u in uni_table(cfg, uni_year)}
    fam_year = cfg["monthly_per_child"] * cfg["months_per_year"] * cfg["kids"]
    i = cfg["mortgage_apr"] / 12; n = 12 * cfg["mortgage_term_years"]
    principal = fam_year / 12 * (1 - (1 + i) ** -n) / i
    out["apartment"] = {"principal": round(principal), "sqm": round(principal / cfg["sofia_eur_per_m2"], 1), "wage_months_13y": round(fam_year * 13 / cfg["avg_gross_wage_eur"])}
    print(json.dumps(out, indent=1))

if __name__ == "__main__":
    main()
