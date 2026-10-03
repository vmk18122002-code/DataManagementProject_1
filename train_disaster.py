"""Disaster-time model: predicts how many people a disaster alert will affect in a DS division.

Trained on the real 2004-2026 disaster records. Only uses information known when an alert
arrives (hazard, month, area profile and that area's past events), not damage counts.
"""
import joblib
import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.metrics import mean_absolute_error, r2_score
from xgboost import XGBRegressor

from common import HAZARDS, KEY, MODEL_DIR, load_disasters, load_ds_features

FEATURES = ["Hazard", "Month", "Population_2024", "HCI_2012_13", "Need_Score",
            "District_MPI_Poor_Pct", "Prev_Events_Hazard", "Prev_Mean_Log_Hazard",
            "Prev_Max_Log_Hazard", "Prev_Events_All", "Prev_Mean_Log_All",
            "District_Prev_Mean_Log_Hazard"]
TEST_START_YEAR = 2023


def add_history(ev):
    """Past-event features for each event, built only from earlier events."""
    ev = ev.sort_values("Date").reset_index(drop=True)
    ev["Log_People"] = np.log1p(ev["People"])
    h = ev.groupby(KEY + ["Hazard"])["Log_People"]
    ev["Prev_Events_Hazard"] = h.cumcount()
    ev["Prev_Mean_Log_Hazard"] = h.transform(lambda s: s.shift(1).expanding().mean())
    ev["Prev_Max_Log_Hazard"] = h.transform(lambda s: s.shift(1).expanding().max())
    a = ev.groupby(KEY)["Log_People"]
    ev["Prev_Events_All"] = a.cumcount()
    ev["Prev_Mean_Log_All"] = a.transform(lambda s: s.shift(1).expanding().mean())
    ev["District_Prev_Mean_Log_Hazard"] = ev.groupby(["District", "Hazard"])["Log_People"].transform(
        lambda s: s.shift(1).expanding().mean())
    return ev


def current_history(ev):
    """The same history features as they stand today, for scoring a new alert."""
    ev = ev.assign(Log_People=np.log1p(ev["People"]))
    hz = ev.groupby(KEY + ["Hazard"]).agg(
        Prev_Events_Hazard=("Log_People", "size"), Prev_Mean_Log_Hazard=("Log_People", "mean"),
        Prev_Max_Log_Hazard=("Log_People", "max"), Past_People=("People", "sum"), Past_Deaths=("Deaths", "sum"),
        Past_Houses_Destroyed=("Houses_Destroyed", "sum")).reset_index()
    al = ev.groupby(KEY).agg(Prev_Events_All=("Log_People", "size"),
                             Prev_Mean_Log_All=("Log_People", "mean")).reset_index()
    di = ev.groupby(["District", "Hazard"])["Log_People"].mean().rename(
        "District_Prev_Mean_Log_Hazard").reset_index()
    return {"hazard": hz, "all": al, "district": di}


def make_model():
    return XGBRegressor(n_estimators=400, learning_rate=0.05, max_depth=6, min_child_weight=5,
                        subsample=0.8, colsample_bytree=0.8, enable_categorical=True, random_state=42)


def main():
    ds = load_ds_features()
    raw = load_disasters()
    ev = add_history(raw).merge(ds, on=KEY, how="inner")
    ev["Hazard"] = pd.Categorical(ev["Hazard"], categories=HAZARDS)

    train, test = ev[ev["Year"] < TEST_START_YEAR], ev[ev["Year"] >= TEST_START_YEAR]
    model = make_model().fit(train[FEATURES], train["Log_People"])
    pred = model.predict(test[FEATURES])
    base = test["Prev_Mean_Log_Hazard"].fillna(train["Log_People"].mean())

    print(f"Train events {len(train)} (2004-{TEST_START_YEAR - 1}), test events {len(test)} ({TEST_START_YEAR}-2026)")
    print("                         model   baseline (area's past mean for the hazard)")
    print(f"MAE (log people)        {mean_absolute_error(test['Log_People'], pred):6.3f}   {mean_absolute_error(test['Log_People'], base):6.3f}")
    print(f"R2  (log people)        {r2_score(test['Log_People'], pred):6.3f}   {r2_score(test['Log_People'], base):6.3f}")
    print(f"Spearman rank corr      {spearmanr(test['Log_People'], pred)[0]:6.3f}   {spearmanr(test['Log_People'], base)[0]:6.3f}")
    print(f"Median abs error (people)  {np.median(np.abs(np.expm1(pred) - test['People'])):.0f}")
    imp = pd.Series(model.feature_importances_, FEATURES).sort_values(ascending=False)
    print("Feature importance:\n" + imp.round(3).to_string())

    final = make_model().fit(ev[FEATURES], ev["Log_People"])
    MODEL_DIR.mkdir(exist_ok=True)
    joblib.dump({"model": final, "features": FEATURES, "history": current_history(raw)},
                MODEL_DIR / "disaster_model.joblib")
    print("Saved models/disaster_model.joblib")


if __name__ == "__main__":
    main()
