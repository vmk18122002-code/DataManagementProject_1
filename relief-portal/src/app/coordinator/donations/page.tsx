"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Button, Card, EmptyState, Input, PageHeader, Select, StatusBadge, Table, Td, Th } from "@/components/ui";
import { ITEMS, STATUS_FLOW, distanceKm } from "@/lib/data";
import { fmt } from "@/lib/needs";
import { useApp } from "@/lib/store";

export default function DonorData() {
  const { donations, updateDonation, collectors } = useApp();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");

  const rows = useMemo(() => donations.filter((d) =>
    (!status || d.status === status) &&
    (!q || `${d.id} ${d.donor} ${d.district} ${d.targetDs}`.toLowerCase().includes(q.toLowerCase()))), [donations, q, status]);

  return (
    <>
      <PageHeader title="Donor Data" subtitle="All donations, pickup details and the area each one is allocated to." />
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
          <Input placeholder="Search by donation ID, donor or area" value={q} onChange={(e) => setQ(e.target.value)} className="pl-10" />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto min-w-[180px]">
          <option value="">All status</option>
          {STATUS_FLOW.map((s) => <option key={s}>{s}</option>)}
        </Select>
      </div>
      <Card>
        <Table>
          <thead>
            <tr><Th>Donation</Th><Th>Donor</Th><Th>Items</Th><Th>Pickup / drop-off</Th><Th>Allocated to</Th><Th>Collector</Th><Th>Status</Th></tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              // collectors in the donor's district first, then the nearest districts
              const options = [...collectors].sort((a, b) => distanceKm(d.district, a.district) - distanceKm(d.district, b.district));
              return (
                <tr key={d.id} className="hover:bg-gray-50/60">
                  <Td><p className="font-medium text-ink">{d.id}</p><p className="text-xs tabular-nums text-ink-muted">{d.date}</p></Td>
                  <Td><p className="text-ink">{d.donor}</p><p className="text-xs text-ink-muted">{d.phone}</p></Td>
                  <Td>{d.items.map((i) => <p key={i.item} className="tabular-nums">{fmt(i.qty)} {ITEMS[i.item].unit}</p>)}</Td>
                  <Td>
                    {d.dropoff
                      ? <><p>Donor brings to {d.dropoff.name}</p><p className="text-xs text-ink-muted">{d.dropoff.address}, {d.dropoff.district}</p></>
                      : <><p>{d.address}</p><p className="text-xs text-ink-muted">{d.district}</p></>}
                  </Td>
                  <Td><p className="text-ink">{d.targetDs}</p><p className="text-xs text-ink-muted">{d.targetDistrict}</p></Td>
                  <Td>
                    {d.dropoff ? (
                      d.status === "Submitted" || d.status === "Allocated" ? (
                        <Button size="sm" variant="secondary" onClick={() => updateDonation(d.id, {
                          status: "Delivered",
                          proof: { photoUrl: "", note: `Handed in by the donor at ${d.dropoff!.name}.`, time: new Date().toISOString(), org: d.dropoff!.name },
                        })}>
                          Mark received
                        </Button>
                      ) : <span className="text-ink-muted">Dropped off</span>
                    ) : d.collector ?? (
                      <Select className="h-9 w-44 py-1 text-sm" defaultValue=""
                        onChange={(e) => e.target.value && updateDonation(d.id, { collector: e.target.value, status: "Collector assigned" })}>
                        <option value="">{options.length ? "Assign collector" : "No collectors yet"}</option>
                        {options.map((c) => <option key={c.id} value={c.name}>{c.name} ({c.district}, {c.vehicleType})</option>)}
                      </Select>
                    )}
                  </Td>
                  <Td><StatusBadge status={d.status} /></Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        {!rows.length && <EmptyState text="No results found." />}
        <p className="border-t border-line px-4 py-3 text-sm text-ink-soft">Showing {rows.length} of {donations.length} donations</p>
      </Card>
    </>
  );
}
