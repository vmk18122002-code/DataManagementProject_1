// Shapes shared with the portal (relief-portal/src/lib/data.ts `Alert`).
export type Severity = "Red" | "Amber" | "Yellow";
export type AlertStatus = "New" | "Confirmed" | "Dismissed";
export type SourceName = "GDACS" | "ReliefWeb" | "DMC" | "Met Department" | "NBRO" | "RISE Sri Lanka";

/** What every source is turned into before it becomes (or joins) an alert. */
export interface ExtractedAlert {
  source: SourceName;
  externalId: string;
  hazard: string;
  severity: Severity;
  title: string;
  districts: string[];
  issuedAt: string; // ISO
  peopleAffected?: number;
  url?: string;
}

export interface Alert {
  id: string;
  source: SourceName;      // first source that reported it
  sources: SourceName[];   // every source linked to it
  hazard: string;
  title: string;
  districts: string[];
  issued: string;          // "YYYY-MM-DD HH:mm" (Sri Lanka time)
  severity: Severity;
  status: AlertStatus;
  peopleAffected?: number;
  url?: string;
  autoExtracted: true;
}

// ---- accounts and donor data (MongoDB). Shapes match relief-portal/src/lib/data.ts `Donation`.
export type OrgRole = "admin" | "collector";
export type Role = "donor" | OrgRole;

/** Signed-in user as the portal sees it (never includes the password hash). */
export interface AuthUser {
  id: string;
  role: Role;
  name: string;
  email: string;
  phone?: string;
  address?: string;
  district?: string;
  org?: string;
  // collectors: their vehicle and the drop-off point they deliver to
  vehicleType?: string;
  vehicleNo?: string;
  dropoff?: { id: string; name: string; address: string; district: string };
  /** true when this sign-in used a temporary password: the account must choose its own before using the portal */
  mustChangePassword?: boolean;
}

export type ItemKey = "food" | "clothes" | "books";
export interface DonationItem {
  item: ItemKey;
  qty: number;
}
export type DonationStatus =
  | "Submitted" | "Allocated" | "Collector assigned" | "Picked up" | "Delivered" | "Dispatched to area" | "Reached area";
/** One step in a donation's journey, kept so the donor portal can show it as a notification. */
export interface DonationEvent {
  kind: DonationStatus | "Re-routed";
  time: string;     // ISO
  text: string;     // what the donor reads
}
export interface Proof {
  photoUrl: string; // base64 data URL
  note: string;
  time: string;     // ISO
}

export interface SourceStatus {
  source: SourceName;
  enabled: boolean;
  via?: string; // "API" | "RSS"
  lastRun?: string;
  ok?: boolean;
  newItems?: number;
  error?: string;
}
