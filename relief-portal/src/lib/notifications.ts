"use client";

/*
  Donor notifications: every step of the donor's own donations, newest first.
  The backend records the steps (Donation.events). When each donor last opened the notifications page is kept in
  localStorage, so the sidebar can count what is new.
*/
import { useMemo, useSyncExternalStore } from "react";
import { Donation, DonationEvent } from "./data";
import { useApp } from "./store";

export interface Notice extends DonationEvent {
  donationId: string;
}

/** Steps of one donation. Donations older than the recorded steps get them from what was saved at the time. */
function eventsOf(d: Donation): DonationEvent[] {
  const events = [...(d.events ?? [])];
  const has = (kind: DonationEvent["kind"]) => events.some((e) => e.kind === kind);
  const area = `${d.targetDs}, ${d.targetDistrict}`;
  if (!has("Submitted")) events.push({ kind: "Submitted", time: d.date, text: "Your donation was received." });
  if (d.proof && !has("Delivered")) {
    events.push({ kind: "Delivered", time: d.proof.time, text: "Your items arrived at the organization's store room." });
  }
  if (d.areaProof && !has("Reached area")) {
    events.push({ kind: "Reached area", time: d.areaProof.time, text: `Your items reached ${area}.` });
  }
  if (d.rerouted && !has("Re-routed")) {
    const { fromDs, fromDistrict, reason, time } = d.rerouted;
    events.push({ kind: "Re-routed", time, text: `Now going to ${area} instead of ${fromDs}, ${fromDistrict}${reason ? `: ${reason}` : "."}` });
  }
  return events;
}

// when the notifications page was last opened, per donor (falls back to memory if storage is blocked)
const key = (donorId: string) => `reliefhub-notices-seen-${donorId}`;
const memory = new Map<string, string>();
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
function readSeen(donorId: string): string {
  const kept = memory.get(donorId);
  if (kept !== undefined) return kept;
  try {
    return localStorage.getItem(key(donorId)) ?? "";
  } catch {
    return "";
  }
}

/** Call when the donor has looked at their notifications: everything up to now counts as read. */
export function markNoticesSeen(donorId: string) {
  const now = new Date().toISOString();
  memory.set(donorId, now);
  try {
    localStorage.setItem(key(donorId), now);
  } catch {}
  listeners.forEach((l) => l());
}

/** The donor's notifications, newest first, and how many arrived since they last looked. */
export function useNotices(donorId: string) {
  const { donations } = useApp();
  const seen = useSyncExternalStore(subscribe, () => readSeen(donorId), () => "");
  return useMemo(() => {
    const notices: Notice[] = donations
      .filter((d) => d.donorId === donorId)
      .flatMap((d) => eventsOf(d).map((e) => ({ ...e, donationId: d.id })))
      .sort((a, b) => b.time.localeCompare(a.time));
    // "Submitted" is the donor's own action, not news
    const isNew = (n: Notice) => n.kind !== "Submitted" && n.time > seen;
    return { notices, seen, isNew, unread: notices.filter(isNew).length };
  }, [donations, donorId, seen]);
}
