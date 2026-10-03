"""LangGraph multi-agent donation system.

Agents
  Coordinator agent   - takes the donor's input (item, quantity, location, chosen area),
                        keeps each area's limit and remaining room, allocates the packs
                        and updates the remaining allocation after every donation.
  Relief center agent - sets each area's limit from population, poverty and records,
                        and multiplies it for affected areas in disaster time.
  Disaster agent      - runs only while a disaster alert is active: checks the past records
                        of the same disaster type in the affected areas and prioritises them.

Flow
  normal time   : coordinator (intake) -> relief center -> coordinator (allocate)
  disaster time : coordinator (intake) -> disaster -> relief center -> coordinator (allocate)

Usage
  python agents.py donate --item Food --qty 500 --location Kandy
  python agents.py donate --item Food --qty 300 --location Kandy --choose Udapalatha
  python agents.py status --item Food --district Kandy
  python agents.py alert  --hazard Flood --ds Kolonnawa Kaduwela --reported Kolonnawa=2000
  python agents.py clear-alert
"""
import argparse
import json
import operator
from typing import Annotated, Any, TypedDict

import joblib
import numpy as np
import pandas as pd
from langgraph.graph import END, START, StateGraph

import common as c
from train_normal import build_area_items

pd.set_option("display.width", 250)
pd.set_option("display.max_columns", 30)

ALERT_FILE = c.BASE / "active_alert.json"
LEDGER_FILE = c.BASE / "donations_ledger.csv"
LEDGER_COLS = ["Date", "District", "DS_Division", "Item", "Packs", "Mode", "Donor_Location"]


class State(TypedDict, total=False):
    request: dict                 # item, qty, location, choose, save
    today: Any
    alert: dict                   # active disaster alert, missing in normal time
    donor_district: str
    areas: Any                    # one row per DS division, filled in by the agents
    plan: Any                     # areas that receive packs from this donation
    unplaced: float
    error: str
    log: Annotated[list, operator.add]


def load_ledger():
    if LEDGER_FILE.exists():
        return pd.read_csv(LEDGER_FILE, parse_dates=["Date"])
    return pd.DataFrame(columns=LEDGER_COLS)


def given_this_month(item, today):
    """Packs of the item already given to each area this month: past records plus the ledger."""
    month = today.to_period("M")
    rec = c.load_distribution()
    rec = rec[(rec["Date"].dt.to_period("M") == month)
              & rec["Item_Type"].map(lambda t: item in c.ITEM_MAP[t])]
    rec = rec.rename(columns={"Packs_Given": "Packs"})[c.KEY + ["Packs"]]
    led = load_ledger()
    led = led[(led["Item"] == item) & (pd.to_datetime(led["Date"]).dt.to_period("M") == month)]
    both = pd.concat([rec, led[c.KEY + ["Packs"]]]) if len(led) else rec
    return both.groupby(c.KEY)["Packs"].sum().astype(float).rename("Given").reset_index()


def pct_rank(values, population):
    """Share of all areas with a value at or below each given value (0 when there is no history)."""
    population = np.asarray(population)
    return np.array([(population <= v).mean() if v > 0 and len(population) else 0.0 for v in values])


# ----------------------------------------------------------------------------- agents

def coordinator_intake(state: State):
    """Coordinator: read the donor's input and check whether a disaster alert is active."""
    req = state["request"]
    today = pd.Timestamp.today().normalize()
    item = req["item"]

    saved = joblib.load(c.MODEL_DIR / "normal_model.joblib")
    areas = build_area_items(c.load_distribution(), c.load_ds_features(), c.load_disasters())
    areas = areas[areas["Item"] == item].reset_index(drop=True)
    areas["Need_Probability"] = saved["model"].predict_proba(areas[saved["features"]])[:, 1].round(3)
    areas = areas.merge(given_this_month(item, today), on=c.KEY, how="left").fillna({"Given": 0})

    loc = req.get("location")
    own = areas[areas["DS_Division"] == loc]
    district = own["District"].iloc[0] if len(own) else loc if loc in c.DISTRICT_COORDS else None
    unknown = set(req.get("choose") or []) - set(areas["DS_Division"])
    if loc and district is None:
        return {"error": f"Location '{loc}' not found - give a district or DS division name."}
    if unknown:
        return {"error": "Chosen area not found: " + ", ".join(sorted(unknown))}

    out = {"today": today, "areas": areas, "donor_district": district}
    if ALERT_FILE.exists():
        out["alert"] = json.loads(ALERT_FILE.read_text())
        mode = f"DISASTER time ({out['alert']['hazard']} alert active)"
    else:
        mode = "NORMAL time (no active alert)"
    out["log"] = [f"Coordinator agent : donor gives {req['qty']} {item} packs"
                  + (f" from {loc}" if loc else "") + f" - {mode}"]
    return out


def route_after_intake(state: State):
    if state.get("error"):
        return END
    return "disaster_agent" if state.get("alert") else "relief_center_agent"


def disaster_agent(state: State):
    """Disaster agent: prioritise the affected areas from past records of the same hazard."""
    alert, areas = state["alert"], state["areas"].copy()
    hazard = alert["hazard"]
    saved = joblib.load(c.MODEL_DIR / "disaster_model.joblib")
    hist = saved["history"]

    areas["Affected"] = areas["District"].isin(alert["districts"]) | areas["DS_Division"].isin(alert["ds"])
    hit = areas[areas["Affected"]].copy()
    if hit.empty:
        return {"areas": areas, "log": ["Disaster agent    : alert has no matching areas"]}

    # past records of this hazard in each affected area
    hit["Hazard"] = hazard
    hit["Month"] = state["today"].month
    hit = (hit.merge(hist["hazard"], on=c.KEY + ["Hazard"], how="left")
              .merge(hist["all"], on=c.KEY, how="left")
              .merge(hist["district"], on=["District", "Hazard"], how="left"))
    past_cols = ["Prev_Events_Hazard", "Prev_Events_All", "Past_People", "Past_Deaths", "Past_Houses_Destroyed"]
    hit[past_cols] = hit[past_cols].fillna(0)
    hit["Hazard"] = pd.Categorical(hit["Hazard"], categories=c.HAZARDS)

    # families affected now: the figure in the alert, otherwise the XGBoost prediction
    people = np.expm1(saved["model"].predict(hit[saved["features"]]))
    hit["Affected_Families"] = hit["DS_Division"].map(alert.get("reported", {})).fillna(
        pd.Series(np.ceil(people / c.HOUSEHOLD_SIZE), index=hit.index))

    same = hist["hazard"][hist["hazard"]["Hazard"] == hazard]
    hit["Past_Score"] = (
        pct_rank(hit["Prev_Events_Hazard"], same["Prev_Events_Hazard"])
        + pct_rank(hit["Past_People"], same["Past_People"])
        + pct_rank(hit["Past_Deaths"] + hit["Past_Houses_Destroyed"],
                   same["Past_Deaths"] + same["Past_Houses_Destroyed"])) / 3
    w = c.PRIORITY_WEIGHTS
    hit["Priority"] = (w["affected_now"] * hit["Affected_Families"] / hit["Affected_Families"].max()
                       + w["past_history"] * hit["Past_Score"]
                       + w["poverty"] * hit["Need_Score"]).round(3)
    cuts = [hit["Priority"] >= t for t, _, _ in c.DISASTER_MULTIPLIERS]
    hit["Priority_Level"] = np.select(cuts, [n for _, n, _ in c.DISASTER_MULTIPLIERS], "Low")

    hit = hit.rename(columns={"Prev_Events_Hazard": "Past_Events"})
    cols = ["Affected_Families", "Past_Events", "Past_People", "Priority", "Priority_Level"]
    areas = areas.merge(hit[c.KEY + cols], on=c.KEY, how="left")
    levels = hit["Priority_Level"].value_counts().to_dict()
    return {"areas": areas, "log": [f"Disaster agent    : {len(hit)} affected areas checked against past "
                                    f"{hazard} records and prioritised {levels}"]}


def relief_center_agent(state: State):
    """Relief center: set every area's limit, multiplied for affected areas in disaster time."""
    areas = state["areas"].copy()
    item = state["request"]["item"]
    areas["Normal_Limit"] = c.monthly_limit(areas, item)
    areas["Multiplier"] = 1.0
    msg = f"Relief center agent: limits set for {len(areas)} areas from population and poverty"
    if "Priority_Level" in areas:
        mult = {name: m for _, name, m in c.DISASTER_MULTIPLIERS}
        areas["Multiplier"] = areas["Priority_Level"].map(mult).fillna(1.0)
        msg += f"; limits multiplied for {int(areas['Affected'].sum())} affected areas"
    areas["Limit"] = (areas["Normal_Limit"] * areas["Multiplier"]).round()
    return {"areas": areas, "log": [msg]}


def coordinator_allocate(state: State):
    """Coordinator: place the donor's packs within each area's remaining room and record them."""
    req, areas = state["request"], state["areas"].copy()
    qty, choose = req["qty"], req.get("choose") or []
    disaster = "Priority" in areas
    areas["Remaining"] = (areas["Limit"] - areas["Given"]).clip(lower=0)
    areas["Chosen"] = areas["DS_Division"].isin(choose)

    if disaster:
        # in disaster time packs go only to affected areas, highest priority first
        cand = areas[areas["Affected"]].sort_values(["Chosen", "Priority"], ascending=False)
    else:
        district = state.get("donor_district")
        areas["Distance_km"] = areas["District"].map(
            lambda d: c.district_distance_km(district, d)) if district else 0.0
        areas["Own_Area"] = areas["DS_Division"] == req.get("location")
        # the donor's chosen areas first, then areas predicted to need the item, nearest first
        cand = areas[areas["Chosen"] | (areas["Need_Probability"] >= 0.5)].sort_values(
            ["Chosen", "Own_Area", "Distance_km", "Need_Probability"], ascending=[False, False, True, False])

    cand = cand.copy()
    give, left = np.zeros(len(cand)), qty
    for i, room in enumerate(cand["Remaining"].to_numpy()):
        give[i] = min(left, room)
        left -= give[i]
    cand["Suggested_Packs"] = give
    cand["Remaining_After"] = cand["Remaining"] - give
    cand["Fill_After"] = ((cand["Given"] + give) / cand["Limit"]).round(2)
    cand["Status_After"] = c.status(cand["Fill_After"])
    plan = cand[cand["Suggested_Packs"] > 0]

    full = [a for a in choose if a not in set(plan["DS_Division"])]
    msg = f"Coordinator agent : {qty - left:.0f} of {qty} packs placed in {len(plan)} areas"
    if full and qty:
        msg += f"; chosen area with no room or not affected: {', '.join(full)}"
    if req.get("save") and len(plan):
        rows = plan[c.KEY].assign(Date=state["today"].date(), Item=req["item"], Packs=plan["Suggested_Packs"],
                                  Mode="Disaster" if disaster else "Normal",
                                  Donor_Location=req.get("location") or "")
        rows[LEDGER_COLS].to_csv(LEDGER_FILE, mode="a", index=False, header=not LEDGER_FILE.exists())
        msg += "; remaining allocation updated"
    return {"areas": areas, "plan": plan, "unplaced": left, "log": [msg]}


def build_graph():
    g = StateGraph(State)
    g.add_node("coordinator_intake", coordinator_intake)
    g.add_node("disaster_agent", disaster_agent)
    g.add_node("relief_center_agent", relief_center_agent)
    g.add_node("coordinator_allocate", coordinator_allocate)
    g.add_edge(START, "coordinator_intake")
    # the disaster agent is only reached while an alert is active
    g.add_conditional_edges("coordinator_intake", route_after_intake,
                            ["disaster_agent", "relief_center_agent", END])
    g.add_edge("disaster_agent", "relief_center_agent")
    g.add_edge("relief_center_agent", "coordinator_allocate")
    g.add_edge("coordinator_allocate", END)
    return g.compile()


# ----------------------------------------------------------------------------- command line

def show(state, table, cols):
    print("\n".join(state["log"]) + "\n")
    cols = [col for col in cols if col in table]
    print(table[cols].to_string(index=False) if len(table) else "No areas to show.")


def cmd_donate(a):
    state = build_graph().invoke({"request": {"item": a.item, "qty": a.qty, "location": a.location,
                                              "choose": a.choose, "save": not a.dry_run}})
    if state.get("error"):
        return print(state["error"])
    show(state, state["plan"], c.KEY + ["Distance_km", "Need_Probability", "Affected_Families", "Past_Events",
                                        "Priority_Level", "Normal_Limit", "Multiplier", "Limit", "Given",
                                        "Suggested_Packs", "Remaining_After", "Status_After"])
    if state["unplaced"]:
        print(f"\n{state['unplaced']:.0f} packs could not be placed - the areas are at their limit.")


def cmd_status(a):
    state = build_graph().invoke({"request": {"item": a.item, "qty": 0, "location": None, "save": False}})
    areas = state["areas"]
    if a.district:
        areas = areas[areas["District"].isin(a.district)]
    elif "Affected" in areas:
        areas = areas[areas["Affected"]]
    areas = areas.assign(Status=c.status(areas["Given"] / areas["Limit"]))
    show(state, areas.sort_values(c.KEY), c.KEY + ["Need_Level", "Priority_Level", "Normal_Limit",
                                                    "Multiplier", "Limit", "Given", "Remaining", "Status"])


def cmd_alert(a):
    ds = c.load_ds_features()
    unknown = (set(a.district) - set(ds["District"])) | (set(a.ds) - set(ds["DS_Division"]))
    if unknown or not (a.district or a.ds):
        return print("Give affected areas with --district or --ds. Not found: " + ", ".join(sorted(unknown)))
    alert = {"hazard": a.hazard, "districts": a.district, "ds": a.ds,
             "reported": {k: float(v) for k, v in (r.split("=") for r in a.reported)},
             "started": str(pd.Timestamp.today().date())}
    ALERT_FILE.write_text(json.dumps(alert, indent=2))
    print(f"{a.hazard} alert is now active. The disaster agent will run until 'clear-alert'.")


def cmd_clear(a):
    ALERT_FILE.unlink(missing_ok=True)
    print("Alert cleared. The system is back in normal time.")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("donate", help="a donor gives packs")
    d.add_argument("--item", choices=c.ITEMS, required=True)
    d.add_argument("--qty", type=int, required=True)
    d.add_argument("--location", help="donor's district or DS division (used in normal time)")
    d.add_argument("--choose", nargs="*", help="DS divisions the donor wants to give to first")
    d.add_argument("--dry-run", action="store_true", help="show the plan without recording it")
    d.set_defaults(func=cmd_donate)
    s = sub.add_parser("status", help="show limits and remaining room")
    s.add_argument("--item", choices=c.ITEMS, required=True)
    s.add_argument("--district", nargs="*")
    s.set_defaults(func=cmd_status)
    al = sub.add_parser("alert", help="start disaster time")
    al.add_argument("--hazard", choices=c.HAZARDS, required=True)
    al.add_argument("--district", nargs="*", default=[])
    al.add_argument("--ds", nargs="*", default=[])
    al.add_argument("--reported", nargs="*", default=[], metavar="DS=FAMILIES")
    al.set_defaults(func=cmd_alert)
    sub.add_parser("clear-alert", help="end disaster time").set_defaults(func=cmd_clear)
    a = p.parse_args()
    if a.cmd == "donate" and not a.location and not ALERT_FILE.exists():
        p.error("--location is required in normal time")
    a.func(a)


if __name__ == "__main__":
    main()
