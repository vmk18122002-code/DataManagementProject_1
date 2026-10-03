"""Tell a donor which areas should get the packs they want to give.

Normal time   : python predict.py normal --item Food --qty 500 --location Kandy
Disaster time : python predict.py disaster --item Food --qty 2000 --hazard Flood --district Ratnapura Kalutara
                python predict.py disaster --item Clothes --qty 800 --hazard Landslide --ds Haputale Bandarawela --reported Haputale=900
For the portal: python predict.py table
"""
import argparse
import json

import joblib
import numpy as np
import pandas as pd

import common as c
from train_normal import build_area_items

pd.set_option("display.width", 250)
pd.set_option("display.max_columns", 30)


def current_need(item):
    """Every DS division: need probability for the item, packs given this month and the limit."""
    saved = joblib.load(c.MODEL_DIR / "normal_model.joblib")
    dist = c.load_distribution()
    today = dist["Date"].max()
    table = build_area_items(dist, c.load_ds_features(), c.load_disasters())
    now = table[table["Item"] == item].copy()
    now["Need_Probability"] = saved["model"].predict_proba(now[saved["features"]])[:, 1].round(3)

    # packs given so far this month in either mode count towards the limit
    rec = dist[dist["Date"].dt.to_period("M") == today.to_period("M")]
    rec = rec[rec["Item_Type"].map(lambda t: item in c.ITEM_MAP[t])]
    given = rec.groupby(c.KEY)["Packs_Given"].sum().rename("Given").reset_index()
    now = now.merge(given, on=c.KEY, how="left").fillna({"Given": 0})
    now["Normal_Limit"] = c.monthly_limit(now, item)

    # need model v2 gives an independent, census-based need for the same areas. The normal model decides WHICH
    # areas need the item; the two together decide which of them comes first.
    need = c.V2_NEED[item]
    v2 = c.load_need_v2().rename(columns={f"{need}_Score": "V2_Score", f"{need}_Level": "V2_Level"})
    now = now.merge(v2[c.KEY + ["V2_Score", "V2_Level"]], on=c.KEY, how="left")
    now["Priority"] = ((1 - c.V2_WEIGHT) * now["Need_Probability"]
                       + c.V2_WEIGHT * (now["V2_Score"] / 100).fillna(now["Need_Probability"])).round(3)
    return now, today


def allocate(df, qty):
    """Give the donor's packs to areas in ranked order, each up to the room left under its limit."""
    room = (df["Limit"] - df["Given"]).clip(lower=0).to_numpy()
    give = np.zeros(len(df))
    for i in range(len(df)):
        give[i] = min(qty, room[i])
        qty -= give[i]
    df["Suggested_Packs"] = give
    df["Fill_After"] = ((df["Given"] + give) / df["Limit"]).round(2)
    df["Status_After"] = c.status(df["Fill_After"])
    return df[df["Suggested_Packs"] > 0], qty


def report(out, left, qty, item):
    print(out.to_string(index=False))
    print(f"\n{qty - left:.0f} of {qty} {item} packs placed in {len(out)} areas.", end=" ")
    print(f"{left:.0f} packs could not be placed - every listed area is at its limit." if left else "")


def predict_normal(item, qty, location):
    now, today = current_need(item)
    # the donor's location can be a DS division or a district
    own = now[now["DS_Division"] == location]
    if len(own):
        district = own["District"].iloc[0]
    elif location in c.DISTRICT_COORDS:
        district = location
    else:
        print(f"Location '{location}' not found - give a district or DS division name.")
        return None

    now["Limit"] = now["Normal_Limit"]
    now["Distance_km"] = now["District"].map(lambda d: c.district_distance_km(district, d))
    now["Own_Area"] = now["DS_Division"] == location
    # only areas the model predicts as needing the item, nearest to the donor first; among areas at the same
    # distance the higher priority (normal model probability + need model v2 score) is filled first
    needed = now[now["Need_Probability"] >= 0.5].sort_values(
        ["Own_Area", "Distance_km", "Priority"], ascending=[False, True, False])
    out, left = allocate(needed, qty)
    print(f"\nNormal time - donor in {location} ({district} district) giving {qty} {item} packs ({today.date()})")
    report(out[c.KEY + ["Distance_km", "V2_Level", "V2_Score", "Need_Probability", "Priority", "Given", "Limit",
                        "Suggested_Packs", "Fill_After", "Status_After"]], left, qty, item)
    return out


def need_table():
    """The normal model's output for every DS division and item, as JSON for the ReliefHub backend.

    The backend runs `python predict.py table`, keeps the result and does the per-donor ranking and
    allocation itself (same rules as predict_normal), so a donor does not wait for Python on every click.
    """
    rows, today = [], None
    for item in c.ITEMS:
        now, today = current_need(item)
        now = now.assign(Item=item)
        rows.append(now[c.KEY + ["Item", "Need_Level", "Need_Score", "Need_Probability", "V2_Score", "V2_Level",
                             "Priority", "Given", "Normal_Limit"]])
    table = pd.concat(rows).rename(columns={
        "District": "district", "DS_Division": "ds", "Item": "item", "Need_Level": "needLevel",
        "Need_Score": "needScore", "Need_Probability": "needProbability", "V2_Score": "v2Score", "V2_Level": "v2Level",
        "Priority": "priority", "Given": "given", "Normal_Limit": "limit"})
    return {"asOf": str(today.date()), "nearlyFull": c.NEARLY_FULL, "closed": c.CLOSED,
            "districtCoords": c.DISTRICT_COORDS, "rows": json.loads(table.to_json(orient="records"))}


def pct_rank(values, population):
    """Share of all areas with a value at or below each given value (0 when there is no history)."""
    population = np.asarray(population)
    return np.array([(population <= v).mean() if v > 0 and len(population) else 0.0 for v in values])


def predict_disaster(item, qty, hazard, districts, ds_names, reported):
    saved = joblib.load(c.MODEL_DIR / "disaster_model.joblib")
    hist = saved["history"]
    now, today = current_need(item)

    unknown = (set(districts) - set(now["District"])) | (set(ds_names) - set(now["DS_Division"]))
    if unknown:
        print("Not found (check spelling):", ", ".join(sorted(unknown)))
    area = now[now["District"].isin(districts) | now["DS_Division"].isin(ds_names)].copy()
    if area.empty:
        return area

    # look up how each affected area was hit by this hazard in the past records
    area["Hazard"] = hazard
    area["Month"] = today.month
    area = (area.merge(hist["hazard"], on=c.KEY + ["Hazard"], how="left")
                .merge(hist["all"], on=c.KEY, how="left")
                .merge(hist["district"], on=["District", "Hazard"], how="left"))
    past_cols = ["Prev_Events_Hazard", "Prev_Events_All", "Past_People", "Past_Deaths", "Past_Houses_Destroyed"]
    area[past_cols] = area[past_cols].fillna(0)
    area["Hazard"] = pd.Categorical(area["Hazard"], categories=c.HAZARDS)

    # families affected now: the figure in the alert, otherwise the model's prediction
    people = np.expm1(saved["model"].predict(area[saved["features"]]))
    area["Predicted_Families"] = np.ceil(people / c.HOUSEHOLD_SIZE)
    area["Reported_Families"] = area["DS_Division"].map(reported)
    area["Affected_Families"] = area["Reported_Families"].fillna(area["Predicted_Families"])

    same = hist["hazard"][hist["hazard"]["Hazard"] == hazard]
    area["Past_Score"] = (
        pct_rank(area["Prev_Events_Hazard"], same["Prev_Events_Hazard"])
        + pct_rank(area["Past_People"], same["Past_People"])
        + pct_rank(area["Past_Deaths"] + area["Past_Houses_Destroyed"],
                   same["Past_Deaths"] + same["Past_Houses_Destroyed"])) / 3

    w = c.PRIORITY_WEIGHTS
    area["Priority"] = (w["affected_now"] * area["Affected_Families"] / area["Affected_Families"].max()
                        + w["past_history"] * area["Past_Score"]
                        + w["poverty"] * area["Need_Score"]).round(3)
    cuts = [area["Priority"] >= t for t, _, _ in c.DISASTER_MULTIPLIERS]
    area["Priority_Level"] = np.select(cuts, [n for _, n, _ in c.DISASTER_MULTIPLIERS], "Low")
    area["Multiplier"] = np.select(cuts, [m for _, _, m in c.DISASTER_MULTIPLIERS], 1.0)
    area["Limit"] = (area["Normal_Limit"] * area["Multiplier"]).round()

    area = area.sort_values("Priority", ascending=False).rename(
        columns={"Prev_Events_Hazard": "Past_Events"})
    # highest priority areas are filled first, each up to its multiplied limit
    out, left = allocate(area, qty)
    print(f"\nDisaster time - {hazard} alert, where to send {qty} {item} packs ({today.date()})")
    report(out[c.KEY + ["Affected_Families", "Past_Events", "Past_People", "Priority", "Priority_Level",
                        "Normal_Limit", "Multiplier", "Limit", "Given", "Suggested_Packs",
                        "Status_After"]], left, qty, item)
    return out


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="mode", required=True)
    n = sub.add_parser("normal")
    d = sub.add_parser("disaster")
    for s in (n, d):
        s.add_argument("--item", choices=c.ITEMS, required=True, help="what the donor wants to give")
        s.add_argument("--qty", type=int, required=True, help="how many packs the donor wants to give")
    n.add_argument("--location", required=True, help="donor's district or DS division")
    d.add_argument("--hazard", choices=c.HAZARDS, required=True)
    d.add_argument("--district", nargs="*", default=[], help="districts affected now")
    d.add_argument("--ds", nargs="*", default=[], help="DS divisions affected now")
    d.add_argument("--reported", nargs="*", default=[], metavar="DS=FAMILIES",
                   help="affected families reported in the alert, used instead of the prediction")
    sub.add_parser("table", help="print the normal model's need table as JSON (used by the backend)")
    a = p.parse_args()

    if a.mode == "table":
        print(json.dumps(need_table()))
    elif a.mode == "normal":
        predict_normal(a.item, a.qty, a.location)
    else:
        reported = {k: float(v) for k, v in (r.split("=") for r in a.reported)}
        predict_disaster(a.item, a.qty, a.hazard, a.district, a.ds, reported)


if __name__ == "__main__":
    main()
