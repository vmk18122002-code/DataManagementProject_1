"use client";

import Link from "next/link";
import { CheckCircle2, HandHeart, MapPinned, PackageCheck, Truck } from "lucide-react";
import { Badge, Card, EmptyState, PageHeader, StatCard, Table, Td, Th } from "@/components/ui";
import { useDonor } from "@/lib/auth";
import { Donation, ITEMS, ITEM_KEYS } from "@/lib/data";
import { fmt } from "@/lib/needs";
import { useApp } from "@/lib/store";

const qty = (list: Donation[]) => list.reduce((s, d) => s + d.items.reduce((a, i) => a + i.qty, 0), 0);

export default function DonorImpact() {
  const { donations } = useApp();
  const me = useDonor();
  const mine = donations.filter((d) => d.donorId === me.id);
  const reached = mine.filter((d) => d.status === "Reached area");
  const onTheWay = mine.filter((d) => d.status !== "Reached area");

  // one row per area the donor's items have arrived in
  const areas = Object.values(reached.reduce((acc, d) => {
    const key = `${d.targetDs}||${d.targetDistrict}`;
    (acc[key] ??= { ds: d.targetDs, district: d.targetDistrict, list: [] }).list.push(d);
    return acc;
  }, {} as Record<string, { ds: string; district: string; list: Donation[] }>))
    .sort((a, b) => qty(b.list) - qty(a.list));

  const proofs = reached.filter((d) => d.areaProof)
    .sort((a, b) => b.areaProof!.time.localeCompare(a.areaProof!.time));

  return (
    <>
      <PageHeader title="My Impact" subtitle="Where your donations ended up, with the confirmation from each area." />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Donations made" value={mine.length} icon={<HandHeart size={18} />} />
        <StatCard label="Items that reached an area" value={fmt(qty(reached))} icon={<PackageCheck size={18} />} />
        <StatCard label="Areas reached" value={areas.length} icon={<MapPinned size={18} />} />
        <StatCard label="Still on the way" value={onTheWay.length} hint={onTheWay.length ? `${fmt(qty(onTheWay))} items` : undefined} icon={<Truck size={18} />} />
      </div>

      <Card title="Areas your items reached" className="mb-6">
        <Table>
          <thead>
            <tr>
              <Th>Area (DS division)</Th>
              <Th className="text-right">Donations</Th>
              {ITEM_KEYS.map((k) => <Th key={k} className="text-right">{ITEMS[k].label}</Th>)}
            </tr>
          </thead>
          <tbody>
            {areas.map((a) => (
              <tr key={`${a.ds}||${a.district}`}>
                <Td>
                  <p className="font-medium text-ink">{a.ds}</p>
                  <p className="text-xs text-ink-muted">{a.district} district</p>
                </Td>
                <Td className="text-right tabular-nums">{a.list.length}</Td>
                {ITEM_KEYS.map((k) => {
                  const n = a.list.flatMap((d) => d.items).filter((i) => i.item === k).reduce((s, i) => s + i.qty, 0);
                  return <Td key={k} className="text-right tabular-nums">{n ? `${fmt(n)} ${ITEMS[k].unit}` : "-"}</Td>;
                })}
              </tr>
            ))}
          </tbody>
        </Table>
        {!areas.length && (
          <EmptyState text={mine.length
            ? "None of your donations has reached its area yet. They appear here once the arrival is confirmed."
            : "No donations yet."} />
        )}
      </Card>

      <h2 className="mb-3 font-semibold text-ink">Arrival confirmations ({proofs.length})</h2>
      {proofs.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {proofs.map((d) => (
            <Card key={d.id} className="overflow-hidden">
              {d.areaProof!.photoUrl && (
                <img src={d.areaProof!.photoUrl} alt={`Items at ${d.targetDs}`} className="h-44 w-full object-cover" />
              )}
              <div className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-ink">{d.targetDs}, {d.targetDistrict}</p>
                  <Badge tone="green"><CheckCircle2 size={11} /> Reached</Badge>
                </div>
                <p className="mt-1 text-sm text-ink-soft">{d.items.map((i) => `${fmt(i.qty)} ${ITEMS[i.item].noun}`).join(" · ")}</p>
                <p className="mt-2 text-sm italic text-ink-soft">{d.areaProof!.note}</p>
                <p className="mt-2 text-xs text-ink-muted">
                  {d.id} · confirmed by {d.areaProof!.by || "the organization"} · {new Date(d.areaProof!.time).toLocaleString()}
                </p>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState text="No confirmations yet. A photo from the area appears here when your items arrive." />
          <p className="pb-8 text-center">
            <Link href={mine.length ? "/donor/donations" : "/donor/donate"} className="font-medium text-brand-700 hover:underline">
              {mine.length ? "Follow your donations" : "Make your first donation"}
            </Link>
          </p>
        </Card>
      )}
    </>
  );
}
