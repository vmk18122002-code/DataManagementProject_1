"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRightLeft, CheckCircle2, ClipboardCheck, MapPin, PackageCheck, Send, Truck, UserCheck, Warehouse } from "lucide-react";
import { Badge, Card, EmptyState, PageHeader, cx } from "@/components/ui";
import { useDonor } from "@/lib/auth";
import { DonationEvent } from "@/lib/data";
import { markNoticesSeen, useNotices } from "@/lib/notifications";
import { useApp } from "@/lib/store";

const LOOK: Record<DonationEvent["kind"], { title: string; icon: React.ReactNode; tone: string }> = {
  "Submitted": { title: "Donation received", icon: <ClipboardCheck size={18} />, tone: "bg-gray-100 text-ink-soft" },
  "Allocated": { title: "Area allocated", icon: <MapPin size={18} />, tone: "bg-amber-50 text-amber-700" },
  "Collector assigned": { title: "Collector assigned", icon: <UserCheck size={18} />, tone: "bg-brand-50 text-brand-700" },
  "Picked up": { title: "Items picked up", icon: <Truck size={18} />, tone: "bg-sky-50 text-sky-700" },
  "Delivered": { title: "At the store room", icon: <Warehouse size={18} />, tone: "bg-emerald-50 text-emerald-700" },
  "Dispatched to area": { title: "On the way", icon: <Send size={18} />, tone: "bg-sky-50 text-sky-700" },
  "Reached area": { title: "Reached the area", icon: <CheckCircle2 size={18} />, tone: "bg-emerald-50 text-emerald-700" },
  "Re-routed": { title: "Area changed", icon: <ArrowRightLeft size={18} />, tone: "bg-amber-50 text-amber-700" },
};

// a donation made before steps were recorded only has the day it was submitted
const when = (time: string) => (time.length > 10 ? new Date(time).toLocaleString() : time);

export default function DonorNotifications() {
  const { reloadDonations } = useApp();
  const me = useDonor();
  const { notices, seen } = useNotices(me.id);
  const [before] = useState(seen); // what was already read when the page opened, so new ones stay marked while it is open

  useEffect(() => {
    markNoticesSeen(me.id);
    void reloadDonations();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per visit
  }, [me.id]);

  return (
    <>
      <PageHeader title="Notifications" subtitle="Every update on your donations, newest first." />
      <Card>
        <ul className="divide-y divide-line">
          {notices.map((n) => {
            const look = LOOK[n.kind];
            const fresh = n.kind !== "Submitted" && n.time > before;
            return (
              <li key={`${n.donationId}-${n.kind}-${n.time}`} className={cx("flex gap-4 px-5 py-4", fresh && "bg-brand-50/40")}>
                <span className={cx("grid h-10 w-10 shrink-0 place-items-center rounded-full", look.tone)}>{look.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-ink">{look.title}</p>
                    {fresh && <Badge tone="brand">New</Badge>}
                  </div>
                  <p className="mt-0.5 text-sm text-ink-soft">{n.text}</p>
                  <p className="mt-1 text-xs text-ink-muted">
                    <Link href="/donor/donations" className="font-medium text-brand-700 hover:underline">{n.donationId}</Link>
                    {" · "}{when(n.time)}
                  </p>
                </div>
                {n.kind === "Reached area" && <PackageCheck size={18} className="mt-1 shrink-0 text-emerald-600" aria-hidden />}
              </li>
            );
          })}
        </ul>
        {!notices.length && <EmptyState text="No notifications yet. Updates appear here once you donate." />}
      </Card>
    </>
  );
}
