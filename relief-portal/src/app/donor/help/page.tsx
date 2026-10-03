"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronDown, Clock, MapPin, Phone, Truck } from "lucide-react";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { useDonor } from "@/lib/auth";
import { DropoffPoint, STATUS_FLOW, DonationStatus, distanceKm } from "@/lib/data";
import { useApp } from "@/lib/store";

const STEP: Record<DonationStatus, string> = {
  "Submitted": "You fill in the donate form: what you give, how much, and the area it should go to.",
  "Allocated": "Your donation is matched to an area that still needs those items.",
  "Collector assigned": "A collector from your district is assigned and contacts you to arrange the pickup.",
  "Picked up": "The collector picks the items up from your address.",
  "Delivered": "The items arrive at the organization's store room. You see a photo as proof.",
  "Dispatched to area": "The organization sends the items on to the area.",
  "Reached area": "The arrival is confirmed with a photo taken in the area. You see it under Donation status and My impact.",
};

const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: "What can I donate?",
    a: "Food packs, clothes, and books and school supplies. The donate form shows what counts as one pack or set.",
  },
  {
    q: "Do I have to wait for a collector?",
    a: "No. On the donate form you can choose to bring the items to a drop-off point yourself. Give your donation number at the desk; the collector steps are skipped.",
  },
  {
    q: "How do I know my items arrived?",
    a: <>Open <Link href="/donor/donations" className="font-medium text-brand-700 hover:underline">Donation status</Link>. When the items reach the area you see a photo, a note, who confirmed it and when. Every step also appears under <Link href="/donor/notifications" className="font-medium text-brand-700 hover:underline">Notifications</Link>.</>,
  },
  {
    q: "Why are my items going to a different area than the one I chose?",
    a: "Needs change, mostly during a disaster. The organization can send a donation to an area that needs it more. You are told which area it went to instead and the reason, on the donation itself and in your notifications.",
  },
  {
    q: "Can I change or cancel a donation after submitting it?",
    a: "Not in the portal. Call your collector, or the drop-off point you chose, before the items are handed over. Their numbers are below.",
  },
  {
    q: "I forgot my password.",
    a: "Use \"Forgot password?\" on the donor sign-in page. A temporary password is emailed to you; after signing in with it you choose a new one.",
  },
];

export default function DonorHelp() {
  const { donations, collectors } = useApp();
  const me = useDonor();
  const [points, setPoints] = useState<DropoffPoint[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.dropoffPoints().then((l) => !cancelled && setPoints(l)).catch(() => !cancelled && setPoints([]));
    return () => {
      cancelled = true;
    };
  }, []);

  // collectors handling a donation of this donor that has not reached its area yet
  const active = donations.filter((d) => d.donorId === me.id && d.collector && d.status !== "Reached area");
  const myCollectors = collectors.filter((c) => active.some((d) => d.collector === c.name));
  const near = [...(points ?? [])].sort((a, b) =>
    distanceKm(me.district, a.district) - distanceKm(me.district, b.district) || a.name.localeCompare(b.name));

  return (
    <>
      <PageHeader title="Help & Contact" subtitle="How donating works, common questions, and who to call." />

      <Card title="How a donation travels" className="mb-6">
        <ol className="divide-y divide-line">
          {STATUS_FLOW.map((s, i) => (
            <li key={s} className="flex gap-4 px-5 py-3.5">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-medium text-white">{i + 1}</span>
              <div>
                <p className="font-medium text-ink">{s}</p>
                <p className="text-sm text-ink-soft">{STEP[s]}</p>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      <Card title="Common questions" className="mb-6">
        <div className="divide-y divide-line">
          {FAQ.map((f) => (
            <details key={f.q} className="group px-5 py-3.5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-medium text-ink">
                {f.q}
                <ChevronDown size={18} className="shrink-0 text-ink-muted transition-transform group-open:rotate-180" />
              </summary>
              <p className="mt-2 text-sm text-ink-soft">{f.a}</p>
            </details>
          ))}
        </div>
      </Card>

      {myCollectors.length > 0 && (
        <Card title="Your collector" className="mb-6">
          <ul className="divide-y divide-line">
            {myCollectors.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 text-sm">
                <div>
                  <p className="flex items-center gap-1.5 font-medium text-ink"><Truck size={14} />{c.name}{c.org && ` · ${c.org}`}</p>
                  <p className="text-ink-muted">
                    {active.filter((d) => d.collector === c.name).map((d) => d.id).join(", ")}
                  </p>
                </div>
                {c.phone && (
                  <a href={`tel:${c.phone.replace(/\s/g, "")}`} className="inline-flex items-center gap-1.5 font-medium text-brand-700 hover:underline">
                    <Phone size={14} />{c.phone}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Contact a drop-off point">
        <p className="border-b border-line px-5 py-3 text-sm text-ink-soft">
          Drop-off points are run by the organization. Nearest to {me.district} first.
        </p>
        <ul className="divide-y divide-line">
          {near.map((p) => (
            <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5 text-sm">
              <div>
                <p className="font-medium text-ink">{p.name}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-ink-soft"><MapPin size={14} />{p.address}, {p.district}</p>
                {p.hours && <p className="mt-0.5 flex items-center gap-1.5 text-ink-muted"><Clock size={14} />{p.hours}</p>}
              </div>
              {p.phone
                ? (
                  <a href={`tel:${p.phone.replace(/\s/g, "")}`} className="inline-flex items-center gap-1.5 font-medium text-brand-700 hover:underline">
                    <Phone size={14} />{p.phone}
                  </a>
                )
                : <span className="text-ink-muted">No phone listed</span>}
            </li>
          ))}
        </ul>
        {points === null && <EmptyState text="Loading drop-off points..." />}
        {points?.length === 0 && <EmptyState text="No drop-off points are listed yet." />}
      </Card>
    </>
  );
}
