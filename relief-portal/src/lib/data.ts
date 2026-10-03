/*
  Reference data and sample data for the portal.
  - ds.json    : real DS divisions, need scores and limits from need_model_v2.py
  - alert.json : real Nov-2024 flood alert with XGBoost predictions from disaster_model.py
  Limit changes and the fallback alerts are sample data. Accounts, donor profiles, donations, collectors and drop-off points come from the backend (lib/api.ts, MongoDB).
  Replace these exports with API calls when the NestJS / LangGraph backend is ready.
*/
import dsRaw from "@/data/ds.json";
import alertRaw from "@/data/alert.json";

export type ItemKey = "food" | "clothes" | "books";
export type Mode = "normal" | "disaster";
export type Level = "High" | "Medium" | "Low";
export type DisasterLevel = "Critical" | "High" | "Medium";

export const ITEMS: Record<ItemKey, { label: string; unit: string; noun: string; need: "living" | "education" }> = {
  food: { label: "Food packs", unit: "packs", noun: "food packs", need: "living" },
  clothes: { label: "Clothes", unit: "sets", noun: "clothing sets", need: "living" },
  books: { label: "Books & school supplies", unit: "books", noun: "books", need: "education" },
};
export const ITEM_KEYS = Object.keys(ITEMS) as ItemKey[];

export interface DSArea {
  id: number;
  district: string;
  ds: string;
  population: number;
  poverty: number;
  living: number;
  education: number;
  livingLevel: Level;
  educationLevel: Level;
  group: string;
  limit: Record<ItemKey, number>;
  used: Record<ItemKey, number>;
}
export const DS_AREAS = dsRaw as DSArea[];
export const DISTRICTS = [...new Set(DS_AREAS.map((d) => d.district))].sort();

// approximate district centres - used for "closest area to the donor"
export const DISTRICT_XY: Record<string, [number, number]> = {
  Colombo: [6.93, 79.86], Gampaha: [7.09, 80.0], Kalutara: [6.58, 79.96], Kandy: [7.29, 80.63],
  Matale: [7.47, 80.62], "Nuwara Eliya": [6.97, 80.77], Galle: [6.05, 80.22], Matara: [5.95, 80.54],
  Hambantota: [6.12, 81.12], Jaffna: [9.66, 80.02], Kilinochchi: [9.38, 80.4], Mannar: [8.98, 79.9],
  Vavuniya: [8.75, 80.5], Mullaitivu: [9.27, 80.81], Batticaloa: [7.73, 81.7], Ampara: [7.3, 81.67],
  Trincomalee: [8.59, 81.21], Kurunegala: [7.49, 80.36], Puttalam: [8.04, 79.84],
  Anuradhapura: [8.31, 80.4], Polonnaruwa: [7.94, 81.0], Badulla: [6.99, 81.06],
  Monaragala: [6.87, 81.35], Ratnapura: [6.68, 80.4], Kegalle: [7.25, 80.35],
};

export function distanceKm(a: string, b: string) {
  const [la1, lo1] = DISTRICT_XY[a] ?? [7.8, 80.7];
  const [la2, lo2] = DISTRICT_XY[b] ?? [7.8, 80.7];
  const dx = (lo2 - lo1) * 111 * Math.cos(((la1 + la2) / 2) * (Math.PI / 180));
  const dy = (la2 - la1) * 111;
  return Math.round(Math.sqrt(dx * dx + dy * dy));
}

// ---------------------------------------------------------------- disaster alert (real model output)
export interface AffectedArea {
  district: string;
  ds: string;
  hazard: string;
  start: string;
  predicted: number;
  level: "High" | "Medium";
  // set by build_alert_history.py from the disaster records: an earlier disaster (>=100 people or
  // >=10 houses) ended 7-90 days before this alert started
  alreadyAffected: boolean;
  prevHazard?: string;
  prevEnd?: string;
  prevPeople?: number;
  prevHouses?: number;
  daysSincePrev?: number;
  priority: DisasterLevel;
}
// already affected -> one level up (Medium -> High, High -> Critical), so size still counts
export const AFFECTED: AffectedArea[] = (alertRaw as Omit<AffectedArea, "priority">[]).map((a) => {
  const base: DisasterLevel = a.level === "High" ? "High" : "Medium";
  const priority: DisasterLevel = !a.alreadyAffected ? base : base === "High" ? "Critical" : "High";
  return { ...a, priority };
});
const SURGE: Record<DisasterLevel, number> = { Critical: 1.5, High: 1.2, Medium: 1.0 };
const PER_PERSON: Record<ItemKey, number> = { food: 1 / 3.7, clothes: 0.5, books: 0.23 * 8 };

export function disasterExtra(area: AffectedArea, item: ItemKey) {
  return Math.round(area.predicted * PER_PERSON[item] * SURGE[area.priority]);
}

export interface Alert {
  id: string;
  source: "DMC" | "NBRO" | "Met Department" | "GDACS" | "RISE Sri Lanka" | "ReliefWeb";
  hazard: string;
  title: string;
  districts: string[];
  issued: string;
  severity: "Red" | "Amber" | "Yellow";
  status: "New" | "Confirmed" | "Dismissed";
  // set on alerts from the backend (see lib/api.ts)
  sources?: Alert["source"][];
  peopleAffected?: number;
  url?: string;
  autoExtracted?: boolean;
}
export const ALERTS: Alert[] = [
  { id: "AL-2411-07", source: "DMC", hazard: "Flood", title: "Flood situation report - heavy flooding in Eastern & Northern provinces",
    districts: ["Ampara", "Trincomalee", "Mullaitivu", "Vavuniya"], issued: "2024-11-26 06:30", severity: "Red", status: "New" },
  { id: "AL-2411-06", source: "Met Department", hazard: "Heavy rain", title: "Heavy rainfall warning (>150 mm) for Eastern, Uva and North-Central provinces",
    districts: ["Ampara", "Batticaloa", "Badulla", "Polonnaruwa"], issued: "2024-11-25 16:00", severity: "Amber", status: "New" },
  { id: "AL-2411-05", source: "NBRO", hazard: "Landslide", title: "Landslide early warning - Level 2 (Be alert)",
    districts: ["Badulla", "Nuwara Eliya"], issued: "2024-11-25 12:15", severity: "Amber", status: "New" },
  { id: "AL-2411-04", source: "GDACS", hazard: "Cyclone / wind", title: "Tropical depression over south-west Bay of Bengal",
    districts: ["Trincomalee", "Batticaloa", "Jaffna"], issued: "2024-11-24 21:00", severity: "Yellow", status: "New" },
  { id: "AL-2411-03", source: "RISE Sri Lanka", hazard: "Flood", title: "Community reports: roads flooded near Kinniya",
    districts: ["Trincomalee"], issued: "2024-11-24 18:40", severity: "Yellow", status: "Dismissed" },
];

// ---------------------------------------------------------------- donors, donations, collectors
export type DonationStatus = "Submitted" | "Allocated" | "Collector assigned" | "Picked up" | "Delivered" | "Dispatched to area" | "Reached area";
export const STATUS_FLOW: DonationStatus[] = ["Submitted", "Allocated", "Collector assigned", "Picked up", "Delivered", "Dispatched to area", "Reached area"];

/** A place run by the organisation where donors can hand in items themselves. Managed in the organization portal. */
export interface DropoffPoint {
  id: string;
  name: string;
  address: string;
  district: string;
  phone?: string;
  hours?: string;
}

/** What the donate form sends: the backend adds the id, owner and status. */
export type NewDonation = Omit<Donation, "id" | "donorId" | "status" | "dropoff"> & { dropoffId?: string };

/** One step in a donation's journey, recorded by the backend and shown to the donor as a notification. */
export interface DonationEvent {
  kind: DonationStatus | "Re-routed";
  time: string;   // ISO
  text: string;
}

/** What can be changed on a donation; rerouteReason goes with a new target area and is shown to the donor. */
export type DonationPatch = Partial<Donation> & { rerouteReason?: string };

export interface Donation {
  id: string;
  donorId?: string;    // account that made it (set by the backend)
  donor: string;
  phone: string;
  email: string;
  address: string;
  district: string;
  items: { item: ItemKey; qty: number }[];
  targetDs: string;
  targetDistrict: string;
  // set by the backend when the organization sends the donation to another area than the one the donor chose
  rerouted?: { fromDs: string; fromDistrict: string; reason: string; time: string };
  date: string;
  notes?: string;
  // set when the donor brings the items to a drop-off point themselves instead of a collector pickup
  dropoff?: { id: string; name: string; address: string; district: string };
  status: DonationStatus;
  collector?: string;
  proof?: {
    photoUrl: string;   // base64 data URL of the delivery photo
    note: string;       // collector's delivery note / voucher comment
    time: string;       // ISO timestamp when proof was submitted
    org: string;        // name of the collecting organisation
  };
  areaProof?: {
    photoUrl: string;   // photo proof that items reached the target DS area
    note: string;       // field agent confirmation note
    time: string;       // ISO timestamp
    by: string;         // name of field agent / org who confirmed
  };
  events?: DonationEvent[]; // oldest first; donations made before this was recorded have none

}

// the organization member / admin who is "logged in" to the organization portal. Confirming an alert or switching modes
// changes limits in every district, so only an organization admin may do it (a real role once auth exists).
export const CURRENT_COORDINATOR = {
  name: "Organization Member", email: "admin@reliefhub.lk", canActivateDisaster: true,
};

// the donor who is "logged in" to the donor portal
export const CURRENT_DONOR = {
  name: "Nimal Perera", email: "nimal@example.com", phone: "077 123 4567",
  address: "24 Temple Rd, Maharagama", district: "Colombo",
};

/** A collector account, added by an organization admin (backend /collectors). */
export interface Collector {
  id: string;
  name: string;
  org: string;
  district: string;
  phone: string;
  vehicleType: string;
  vehicleNo: string;
  dropoff?: { id: string; name: string; address: string; district: string }; // where they bring collected items
}
export const VEHICLES = ["Motorbike", "Three-wheeler", "Car", "Van", "Lorry", "Tractor"] as const;

// ---------------------------------------------------------------- limit changes & field reports
export interface LimitAdjustment {
  ds: string;
  district: string;
  item: ItemKey;
  change: number;
  reason: string;
  by: "Coordinator" | "Organization Member" | "Field report";
  time: string;
}
export const LIMIT_ADJUSTMENTS: LimitAdjustment[] = [
  { ds: "Ayagama", district: "Ratnapura", item: "food", change: 200, reason: "Collector field report - landslide-damaged homes", by: "Field report", time: "08:50" },
  { ds: "Koralai Pattu North", district: "Batticaloa", item: "books", change: 350, reason: "School re-opening; 2 schools without supplies", by: "Coordinator", time: "Yesterday" },
];

export interface FieldFeedback {
  ds: string;
  district: string;
  item: ItemKey;
  qty: number;
  urgency: "Urgent" | "Soon" | "Normal";
  note: string;
  by: string;
  time: string;
}
