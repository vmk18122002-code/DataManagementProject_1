"""Shared settings and data loading for the donation recommendation models."""
import difflib
import re
from pathlib import Path

import numpy as np
import pandas as pd

BASE = Path(__file__).parent
DIST_FILE = BASE / "ds_division_distribution_dataset.xlsx"
DISASTER_FILE = BASE / "Sri_Lanka_Disaster_Records_2004_2026.xlsx"
POVERTY_FILE = BASE / "DS_Poverty_2012_13.csv"
NEED_V2_FILE = BASE / "Need_Model_Results_v2.xlsx"   # output of need_model_v2.py
MODEL_DIR = BASE / "models"

# ---- Configurable parameters (assumptions, change these to suit the project) ----
HOUSEHOLD_SIZE = 3.8          # average people per family
COVERAGE = 0.10               # share of poor families the donor network aims to reach per month
PACKS_PER_FAMILY = {"Food": 1.0, "Clothes": 1.0, "Books": 1.0}
NEARLY_FULL = 0.70            # fill ratio where an area becomes "Nearly full"
CLOSED = 1.00                 # fill ratio where an area is closed and donors are redirected
# disaster priority = how many are affected now + how badly the area was hit in past records + poverty
PRIORITY_WEIGHTS = {"affected_now": 0.4, "past_history": 0.4, "poverty": 0.2}
# in disaster time the normal monthly limit is multiplied according to the priority score
DISASTER_MULTIPLIERS = [(0.66, "High", 3.0), (0.33, "Medium", 2.0), (0.0, "Low", 1.5)]

ITEMS = ["Food", "Clothes", "Books"]
# which donor item each recorded Item_Type counts towards (a combo bundle counts for both)
ITEM_MAP = {"Dry Food": ["Food"], "Dry Food + Clothes": ["Food", "Clothes"], "Books": ["Books"]}
HAZARDS = ["Cyclone / wind", "Flood", "Animal attack", "Landslide", "Heavy rain",
           "Fire", "Drought", "Lightning", "Other", "Tsunami / coastal"]
KEY = ["District", "DS_Division"]


def _cached(source_files):
    """Keep a loader's result on disk and reuse it until one of its source files changes."""
    def wrap(fn):
        def inner():
            path = BASE / ".cache" / f"{fn.__name__}.pkl"
            newest = max(f.stat().st_mtime for f in source_files + [Path(__file__)])
            if path.exists() and path.stat().st_mtime > newest:
                return pd.read_pickle(path)
            df = fn()
            path.parent.mkdir(exist_ok=True)
            df.to_pickle(path)
            return df
        inner.__doc__ = fn.__doc__
        return inner
    return wrap


def _norm(s):
    return re.sub(r"[^a-z]", "", str(s).lower())


@_cached([DIST_FILE, POVERTY_FILE])
def load_ds_features():
    """One row per DS division: population, poverty and need indicators."""
    ds = pd.read_excel(DIST_FILE, sheet_name="DS_Division_Needs")
    ds["Population_2024"] = ds["Population_2024"].fillna(
        ds.groupby("District")["Population_2024"].transform("median"))

    # DS names are spelled differently in the 2012/13 poverty file, so match on a
    # normalised name and fall back to a close match within the same district.
    pov = pd.read_csv(POVERTY_FILE)
    lookup = {(_norm(d), _norm(n)): (h, p) for d, n, h, p in
              zip(pov["District"], pov["DS Division"], pov["HCI_2012_13"], pov["Poor_people"])}
    hci, poor = [], []
    for d, n in zip(ds["District"], ds["DS_Division"]):
        k = (_norm(d), _norm(n))
        if k not in lookup:
            cands = [b for a, b in lookup if a == k[0]]
            m = difflib.get_close_matches(k[1], cands, n=1, cutoff=0.85)
            k = (k[0], m[0]) if m else None
        h, p = lookup.get(k, (np.nan, np.nan))
        hci.append(h)
        poor.append(p)
    ds["HCI_2012_13"], ds["Poor_people"] = hci, poor
    ds["HCI_matched"] = ds["HCI_2012_13"].notna()
    ds["HCI_2012_13"] = ds["HCI_2012_13"].fillna(
        ds.groupby("District")["HCI_2012_13"].transform("median"))
    ds["Poor_people"] = ds["Poor_people"].fillna(ds["Population_2024"] * ds["HCI_2012_13"] / 100)
    ds["Target_Families"] = ds["Poor_people"] / HOUSEHOLD_SIZE
    return ds[KEY + ["Population_2024", "District_MPI_Poor_Pct", "Need_Score", "Need_Level",
                     "HCI_2012_13", "HCI_matched", "Poor_people", "Target_Families"]]


@_cached([DIST_FILE])
def load_distribution():
    df = pd.read_excel(DIST_FILE, sheet_name="Distribution_Records")
    df["Date"] = pd.to_datetime(df["Date"])
    return df


@_cached([DISASTER_FILE])
def load_disasters():
    """Real disaster records, aggregated to one row per DS division, date and hazard."""
    df = pd.read_excel(DISASTER_FILE).rename(columns={
        "DS Division": "DS_Division", "Hazard group": "Hazard", "People affected": "People",
        "Houses destroyed / fully damaged": "Houses_Destroyed",
        "Houses damaged / partially damaged": "Houses_Damaged"})
    df = df.dropna(subset=KEY)
    df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
    df["Month"] = df["Date"].dt.month
    # records without a date keep a missing month and are ordered at mid-year
    df["Date"] = df["Date"].fillna(pd.to_datetime(df["Year"].astype(str) + "-07-01"))
    return (df.groupby(KEY + ["Date", "Hazard"], as_index=False)
              .agg(Year=("Year", "first"), Month=("Month", "first"), People=("People", "sum"),
                   Deaths=("Deaths", "sum"), Houses_Destroyed=("Houses_Destroyed", "sum"),
                   Houses_Damaged=("Houses_Damaged", "sum"))
              .sort_values("Date").reset_index(drop=True))


# which need model v2 score applies to each donor item
V2_NEED = {"Food": "Living", "Clothes": "Living", "Books": "Education"}
# normal-time priority of an area = this share from need model v2, the rest from the normal model's probability
V2_WEIGHT = 0.5


def load_need_v2():
    """Need model v2 (census-based): Living and Education need of every DS division as a 0-100 percentile and a level."""
    if not NEED_V2_FILE.exists():
        return pd.DataFrame(columns=KEY + ["Living_Score", "Living_Level", "Education_Score", "Education_Level"])
    df = pd.read_excel(NEED_V2_FILE, sheet_name="DS Need Scores")
    return df.rename(columns={
        "DS Division": "DS_Division", "Living (Food & Clothes) score": "Living_Score", "Living level": "Living_Level",
        "Education (Books) score": "Education_Score", "Education level": "Education_Level",
    })[KEY + ["Living_Score", "Living_Level", "Education_Score", "Education_Level"]]


def monthly_limit(ds, item):
    """Normal-time monthly pack limit per DS division for one item."""
    return (ds["Target_Families"] * PACKS_PER_FAMILY[item] * COVERAGE).round().clip(lower=1)


def status(fill):
    return np.select([fill >= CLOSED, fill >= NEARLY_FULL], ["Closed", "Nearly full"], "Open")


# Approximate centre of each district (latitude, longitude), used to find areas near a donor.
# The data has no coordinates for DS divisions, so nearness is measured between districts.
DISTRICT_COORDS = {
    "Colombo": (6.87, 80.02), "Gampaha": (7.09, 80.00), "Kalutara": (6.58, 80.10),
    "Kandy": (7.29, 80.64), "Matale": (7.65, 80.70), "Nuwara Eliya": (6.97, 80.77),
    "Galle": (6.15, 80.25), "Matara": (6.05, 80.55), "Hambantota": (6.25, 81.10),
    "Jaffna": (9.66, 80.02), "Kilinochchi": (9.38, 80.40), "Mannar": (8.85, 80.07),
    "Vavuniya": (8.75, 80.50), "Mullaitivu": (9.20, 80.65), "Batticaloa": (7.75, 81.60),
    "Ampara": (7.20, 81.65), "Trincomalee": (8.57, 81.10), "Kurunegala": (7.60, 80.25),
    "Puttalam": (8.03, 79.90), "Anuradhapura": (8.35, 80.50), "Polonnaruwa": (7.95, 81.00),
    "Badulla": (6.99, 81.06), "Monaragala": (6.75, 81.30), "Ratnapura": (6.60, 80.50),
    "Kegalle": (7.12, 80.35)}


def district_distance_km(a, b):
    """Straight-line distance between two district centres."""
    (la1, lo1), (la2, lo2) = np.radians(DISTRICT_COORDS[a]), np.radians(DISTRICT_COORDS[b])
    h = np.sin((la2 - la1) / 2) ** 2 + np.cos(la1) * np.cos(la2) * np.sin((lo2 - lo1) / 2) ** 2
    return float(round(6371 * 2 * np.arcsin(np.sqrt(h))))
