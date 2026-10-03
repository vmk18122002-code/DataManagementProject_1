"use client";

/*
  Client-side app state shared by all portals (stands in for the backend).
  Mode is remembered in localStorage so switching portals keeps Disaster Mode on.
*/
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { api } from "./api";
import { useAuth } from "./auth";
import {
  AFFECTED, ALERTS, Alert, Collector, Donation, DonationPatch, FieldFeedback, NewDonation, LIMIT_ADJUSTMENTS, LimitAdjustment, Mode,
} from "./data";

interface AppState {
  mode: Mode;
  activateDisaster: () => void;
  deactivateDisaster: () => void;
  alerts: Alert[];
  /** "live" = alerts come from the backend API, "demo" = backend not reachable, sample ALERTS shown */
  alertFeed: "live" | "demo";
  reloadAlerts: () => Promise<void>;
  setAlertStatus: (id: string, status: Alert["status"]) => void;
  confirmedAreas: Set<string>;
  setConfirmedAreas: (s: Set<string>) => void;
  donations: Donation[];
  /** Saves a donation for the signed-in donor and returns it with the id the backend gave it. */
  addDonation: (d: NewDonation) => Promise<Donation>;
  updateDonation: (id: string, patch: DonationPatch) => void;
  /** Fetches the donations again, to pick up what others changed since sign in. */
  reloadDonations: () => Promise<void>;
  adjustments: LimitAdjustment[];
  addAdjustment: (a: LimitAdjustment) => void;
  feedback: FieldFeedback[];
  addFeedback: (f: FieldFeedback) => void;
  /** Collector accounts added by the organization. */
  collectors: Collector[];
  reloadCollectors: () => Promise<void>;
}

const Ctx = createContext<AppState | null>(null);
const ALL_AFFECTED = new Set(AFFECTED.map((a) => `${a.district}|${a.ds}`));
const NONE = new Set<string>();

// Mode lives in a tiny external store backed by localStorage (falls back to memory if storage is blocked).
const MODE_KEY = "reliefhub-mode";
let memoryMode: Mode | null = null;
const listeners = new Set<() => void>();
function readMode(): Mode {
  if (memoryMode) return memoryMode;
  try {
    return localStorage.getItem(MODE_KEY) === "disaster" ? "disaster" : "normal";
  } catch {
    return "normal";
  }
}
function writeMode(m: Mode) {
  memoryMode = m;
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {}
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const mode = useSyncExternalStore(subscribe, readMode, () => "normal" as Mode);
  const [alerts, setAlerts] = useState(ALERTS);
  const [alertFeed, setAlertFeed] = useState<"live" | "demo">("demo");

  const reloadAlerts = async () => {
    try {
      setAlerts(await api.alerts());
      setAlertFeed("live");
    } catch {
      setAlertFeed("demo"); // keep whatever is shown (sample alerts on first load)
    }
  };

  // load alerts from the backend, then keep them updated through server-sent events
  useEffect(() => {
    let close: (() => void) | undefined;
    let cancelled = false;
    api.alerts().then((list) => {
      if (cancelled) return;
      setAlerts(list);
      setAlertFeed("live");
      close = api.subscribe((a) => setAlerts((l) => [a, ...l.filter((x) => x.id !== a.id)]
        .sort((x, y) => y.issued.localeCompare(x.issued))));
    }).catch(() => {});
    return () => {
      cancelled = true;
      close?.();
    };
  }, []);
  // null = default: every predicted area is confirmed while in Disaster Mode
  const [confirmedOverride, setConfirmedOverride] = useState<Set<string> | null>(null);
  const confirmedAreas = confirmedOverride ?? (mode === "disaster" ? ALL_AFFECTED : NONE);
  // donations live in MongoDB: a donor sees their own, organization members see all of them
  const { user } = useAuth();
  const userId = user?.id;
  const [donations, setDonations] = useState<Donation[]>([]);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    api.donations().then((list) => !cancelled && setDonations(list)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId]);
  const reloadDonations = () => api.donations().then(setDonations).catch(() => {});
  const [collectors, setCollectors] = useState<Collector[]>([]);
  const reloadCollectors = () => api.collectors().then(setCollectors).catch(() => {});
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    api.collectors().then((list) => !cancelled && setCollectors(list)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId]);
  const [adjustments, setAdjustments] = useState(LIMIT_ADJUSTMENTS);
  const [feedback, setFeedback] = useState<FieldFeedback[]>([]);

  const value = useMemo<AppState>(() => ({
    mode,
    activateDisaster: () => writeMode("disaster"),
    deactivateDisaster: () => {
      writeMode("normal");
      setConfirmedOverride(null);
    },
    alerts,
    alertFeed,
    reloadAlerts,
    setAlertStatus: (id, status) => {
      setAlerts((a) => a.map((x) => (x.id === id ? { ...x, status } : x)));
      if (alertFeed === "live") api.setStatus(id, status).catch(() => void reloadAlerts());
    },
    confirmedAreas,
    setConfirmedAreas: (s) => setConfirmedOverride(s),
    donations,
    addDonation: async (d) => {
      const saved = await api.createDonation(d);
      setDonations((l) => [saved, ...l]);
      return saved;
    },
    updateDonation: (id, { rerouteReason, ...patch }) => {
      setDonations((l) => l.map((x) => (x.id === id ? { ...x, ...patch } : x)));
      api.updateDonation(id, { ...patch, rerouteReason })
        // a new target area: the backend works out whether this is a re-route away from the donor's choice
        .then((saved) => patch.targetDs !== undefined && setDonations((l) => l.map((x) => (x.id === id ? saved : x))))
        // if the save fails, show what the backend really has
        .catch(() => api.donations().then(setDonations).catch(() => {}));
    },
    reloadDonations,
    adjustments,
    addAdjustment: (a) => setAdjustments((l) => [a, ...l]),
    feedback,
    addFeedback: (f) => setFeedback((l) => [f, ...l]),
    collectors,
    reloadCollectors,
  }), [mode, alerts, alertFeed, confirmedAreas, donations, adjustments, feedback, collectors]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used inside AppStateProvider");
  return v;
}
