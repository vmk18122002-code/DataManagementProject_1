/*
  Client for the ReliefHub backend (backend/). Accounts, donor profiles and donations are stored in MongoDB and need
  a login token (JWT); disaster alerts are public to read. Limits, collectors and field reports are still mock data.
  If the API is not running, the portal falls back to the sample ALERTS and nobody can sign in.
*/
import type { Alert, Collector, Donation, DonationPatch, DropoffPoint, NewDonation } from "./data";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export interface SourceStatus {
  source: string;
  enabled: boolean;
  via?: string;
  lastRun?: string;
  ok?: boolean;
  newItems?: number;
  error?: string;
}

export type Role = "donor" | "admin" | "collector";
export interface AuthUser {
  id: string;
  role: Role;
  name: string;
  email: string;
  phone?: string;
  address?: string;
  district?: string;
  org?: string;
  // collectors: their vehicle and the drop-off point they bring collected items to
  vehicleType?: string;
  vehicleNo?: string;
  dropoff?: { id: string; name: string; address: string; district: string };
  /** true when this sign-in used a temporary password: a new one must be chosen before using the portal */
  mustChangePassword?: boolean;
}
/** Result of adding a collector: whether the invitation email went out, and the temporary password if it did not. */
export interface CollectorInvite {
  collector: Collector;
  email: string;
  emailSent: boolean;
  validHours: number;
  tempPassword?: string;
}
export interface Session {
  token: string;
  user: AuthUser;
}
export interface DonorSignup {
  name: string;
  email: string;
  password: string;
  phone: string;
}

/** Output of the normal-time need model (backend /predict, predict.py). Quantities are in packs. */
export interface ModelArea {
  district: string;
  ds: string;
  distanceKm: number;
  needLevel: "High" | "Medium" | "Low";
  needProbability: number; // 0 - 1
  v2Score: number | null;  // need model v2 percentile (0 - 100) for this kind of item
  v2Level: "High" | "Medium" | "Low" | null;
  priority: number;        // probability and v2 score combined
  given: number;           // packs given this month
  limit: number;           // monthly limit
  room: number;            // limit - given
  suggested: number;       // packs of this donation that go here
  statusAfter: "Open" | "Nearly full" | "Closed";
}
export interface ModelPlan {
  asOf: string;
  district: string;
  placed: number;
  unplaced: number;
  areaCount: number;
  areas: ModelArea[];
}
export interface ModelNeeds {
  asOf: string;
  district: string;
  items: { item: "Food" | "Clothes" | "Books"; areas: number; packsNeeded: number }[];
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

// The session lives in a tiny external store backed by localStorage, so it survives a reload and is shared by tabs.
const SESSION_KEY = "reliefhub-session";
const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cached: Session | null = null;

export const session = {
  /** null = signed out. Returns the same object until the stored session changes. */
  get(): Session | null {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(SESSION_KEY);
    } catch {}
    if (raw !== cachedRaw) {
      cachedRaw = raw;
      try {
        cached = raw ? JSON.parse(raw) : null;
      } catch {
        cached = null;
      }
    }
    return cached;
  },
  set(s: Session | null) {
    try {
      if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else localStorage.removeItem(SESSION_KEY);
    } catch {}
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    window.addEventListener("storage", l);
    return () => {
      listeners.delete(l);
      window.removeEventListener("storage", l);
    };
  },
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const token = session.get()?.token;
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...init?.headers },
    signal: init?.signal ?? AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try {
      message = JSON.parse(text).message ?? text;
    } catch {}
    throw new ApiError(res.status, String(message));
  }
  return res.json();
}

const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
const patch = (body: unknown): RequestInit => ({ method: "PATCH", body: JSON.stringify(body) });

export const api = {
  alerts: () => call<Alert[]>("/alerts", { signal: AbortSignal.timeout(4_000) }),
  sources: () => call<SourceStatus[]>("/sources"),
  setStatus: (id: string, status: Alert["status"]) =>
    call<Alert>(`/alerts/${encodeURIComponent(id)}/status`, patch({ status })),
  fetchNow: () => call<{ alertsCreated: number; alertsUpdated: number; busy?: boolean; sources: SourceStatus[] }>(
    "/ingest/run", post({})),
  /** Live alert updates (server-sent events). Returns a function that closes the stream. */
  subscribe(onAlert: (a: Alert) => void) {
    const es = new EventSource(`${API_URL}/alerts/stream`);
    es.addEventListener("alert", (e) => onAlert(JSON.parse((e as MessageEvent).data)));
    return () => es.close();
  },

  registerDonor: (d: DonorSignup) => call<Session>("/auth/donor/register", post(d)),
  loginDonor: (email: string, password: string) => call<Session>("/auth/donor/login", post({ email, password })),
  loginOrg: (email: string, password: string) => call<Session>("/auth/org/login", post({ email, password })),
  me: () => call<AuthUser>("/auth/me"),
  /** Emails a temporary password if the account exists; the answer is the same either way. */
  forgotPassword: (kind: "donor" | "org", email: string) => call<{ ok: true }>(`/auth/${kind}/forgot`, post({ email })),
  changePassword: (newPassword: string, currentPassword?: string) =>
    call<Session>("/auth/password", post({ newPassword, currentPassword })),
  updateProfile: (p: Partial<Pick<AuthUser, "name" | "phone" | "address" | "district">>) =>
    call<AuthUser>("/donors/me", patch(p)),

  /** Normal model: the areas that need `qty` packs of `item` from a donor in `location` (district or DS division). */
  predictNormal: (item: string, qty: number, location: string, signal?: AbortSignal) =>
    call<ModelPlan>(`/predict/normal?${new URLSearchParams({ item, qty: String(qty), location })}`, { signal }),
  /** Normal model: which items the donor's district needs. */
  predictNeeds: (location: string, signal?: AbortSignal) =>
    call<ModelNeeds>(`/predict/needs?${new URLSearchParams({ location })}`, { signal }),

  /** A donor gets their own donations, organization members get all of them. */
  donations: () => call<Donation[]>("/donations"),
  createDonation: (d: NewDonation) => call<Donation>("/donations", post(d)),

  collectors: () => call<Collector[]>("/collectors"),
  createCollector: (c: Omit<Collector, "id" | "dropoff"> & { email: string }) =>
    call<CollectorInvite>("/collectors", post(c)),
  /** Sends the invitation again with a fresh temporary password. */
  reinviteCollector: (id: string) => call<CollectorInvite>(`/collectors/${encodeURIComponent(id)}/invite`, post({})),
  deleteCollector: (id: string) => call<{ id: string }>(`/collectors/${encodeURIComponent(id)}`, { method: "DELETE" }),

  dropoffPoints: () => call<DropoffPoint[]>("/dropoff-points"),
  createDropoffPoint: (p: Omit<DropoffPoint, "id">) => call<DropoffPoint>("/dropoff-points", post(p)),
  deleteDropoffPoint: (id: string) => call<{ id: string }>(`/dropoff-points/${encodeURIComponent(id)}`, { method: "DELETE" }),
  updateDonation: (id: string, p: DonationPatch) => call<Donation>(`/donations/${encodeURIComponent(id)}`, patch(p)),
};
