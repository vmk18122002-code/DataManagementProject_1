"""Normal-time model: predicts which DS divisions need an item (Food, Clothes or Books).

One row per DS division and item. An area is labelled as needing the item when it received
more packs of it than the typical (median) area in the Normal-mode distribution records.
The classifier learns that from the area's population, poverty and disaster history, and
gives every area a need probability for the item a donor chooses.
"""
import joblib
import pandas as pd
from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score, roc_auc_score
from sklearn.model_selection import GroupKFold, cross_val_predict
from xgboost import XGBClassifier

from common import ITEM_MAP, ITEMS, KEY, MODEL_DIR, load_disasters, load_distribution, load_ds_features

FEATURES = ["Item", "Population_2024", "HCI_2012_13", "Poor_people", "Need_Score",
            "District_MPI_Poor_Pct", "Disaster_Events_Per_Year"]


def build_area_items(dist, ds, disasters):
    """DS division x item table with the area features and the packs received in normal time."""
    rec = dist[dist["Mode"] == "Normal"].copy()
    rec["Item"] = rec["Item_Type"].map(ITEM_MAP)
    rec = rec.explode("Item")
    packs = rec.groupby(KEY + ["Item"])["Packs_Given"].sum().rename("Packs").reset_index()

    years = disasters["Year"].max() - disasters["Year"].min() + 1
    events = (disasters.groupby(KEY).size() / years).rename("Disaster_Events_Per_Year").reset_index()

    table = (ds.merge(pd.DataFrame({"Item": ITEMS}), how="cross")
               .merge(packs, on=KEY + ["Item"], how="left")
               .merge(events, on=KEY, how="left")
               .fillna({"Packs": 0, "Disaster_Events_Per_Year": 0}))
    table["Needed"] = (table["Packs"] > table.groupby("Item")["Packs"].transform("median")).astype(int)
    table["Item"] = pd.Categorical(table["Item"], categories=ITEMS)
    return table


def make_model():
    return XGBClassifier(n_estimators=200, learning_rate=0.05, max_depth=3, min_child_weight=3,
                         subsample=0.8, colsample_bytree=0.8, enable_categorical=True,
                         eval_metric="logloss", random_state=42)


def main():
    table = build_area_items(load_distribution(), load_ds_features(), load_disasters())
    y = table["Needed"]

    # 5-fold cross-validation, keeping all rows of a DS division in the same fold so the
    # model is always tested on areas it has not seen
    groups = table["District"] + "|" + table["DS_Division"]
    prob = cross_val_predict(make_model(), table[FEATURES], y, groups=groups,
                             cv=GroupKFold(5), method="predict_proba")[:, 1]
    pred = (prob >= 0.5).astype(int)
    print(f"{len(table)} rows ({table[KEY].drop_duplicates().shape[0]} DS divisions x {len(ITEMS)} items), "
          f"{y.mean():.1%} labelled 'needed'")
    print(f"Accuracy   {accuracy_score(y, pred):.3f}   (guessing the bigger class: {max(y.mean(), 1 - y.mean()):.3f})")
    print(f"Precision  {precision_score(y, pred):.3f}")
    print(f"Recall     {recall_score(y, pred):.3f}")
    print(f"F1         {f1_score(y, pred):.3f}")
    print(f"ROC AUC    {roc_auc_score(y, prob):.3f}")
    for item in ITEMS:
        m = table["Item"] == item
        print(f"  {item:8s} accuracy {accuracy_score(y[m], pred[m]):.3f}")

    final = make_model().fit(table[FEATURES], y)
    imp = pd.Series(final.feature_importances_, FEATURES).sort_values(ascending=False)
    print("Feature importance:\n" + imp.round(3).to_string())
    MODEL_DIR.mkdir(exist_ok=True)
    joblib.dump({"model": final, "features": FEATURES}, MODEL_DIR / "normal_model.joblib")
    print("Saved models/normal_model.joblib")


if __name__ == "__main__":
    main()
