"use client";

import { useEffect, useState } from "react";
import { MapPin, Plus, Trash2 } from "lucide-react";
import { Button, Card, EmptyState, Field, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { api } from "@/lib/api";
import { errorText } from "@/lib/auth";
import { DISTRICTS, DropoffPoint } from "@/lib/data";

const EMPTY = { name: "", address: "", district: DISTRICTS[0], phone: "", hours: "" };

export default function DropoffPoints() {
  const [points, setPoints] = useState<DropoffPoint[] | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  useEffect(() => {
    api.dropoffPoints().then(setPoints).catch((e) => setError(errorText(e)));
  }, []);

  const covered = new Set(points?.map((p) => p.district));
  const missing = DISTRICTS.filter((d) => !covered.has(d));

  return (
    <>
      <PageHeader
        title="Drop-off Points"
        subtitle="Places where donors can hand in their items themselves instead of waiting for a collector."
      />

      <Card title="Add a drop-off point" className="mb-6">
        <form
          className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const saved = await api.createDropoffPoint(form);
              setPoints((l) => [...(l ?? []), saved].sort((a, b) => a.district.localeCompare(b.district) || a.name.localeCompare(b.name)));
              setForm({ ...EMPTY, district: form.district });
            } catch (err) {
              setError(errorText(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Name">
            <Input placeholder="Kandy Divisional Secretariat" value={form.name} onChange={set("name")} required />
          </Field>
          <Field label="District">
            <Select value={form.district} onChange={set("district")}>
              {DISTRICTS.map((d) => <option key={d}>{d}</option>)}
            </Select>
          </Field>
          <Field label="Phone (optional)">
            <Input type="tel" placeholder="081 222 3344" value={form.phone} onChange={set("phone")} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Address">
              <Input placeholder="12 Yatinuwara Veediya, Kandy" value={form.address} onChange={set("address")} required />
            </Field>
          </div>
          <Field label="Opening hours (optional)">
            <Input placeholder="Mon - Sat, 8am - 5pm" value={form.hours} onChange={set("hours")} />
          </Field>
          <div className="sm:col-span-2 lg:col-span-3">
            <Button type="submit" disabled={busy}><Plus size={16} /> {busy ? "Saving..." : "Add drop-off point"}</Button>
          </div>
        </form>
      </Card>

      {error && <p role="alert" className="mb-4 rounded-lg bg-danger-50 px-4 py-3 text-sm text-danger-700">{error}</p>}

      <Card title={`Drop-off points${points ? ` (${points.length})` : ""}`}>
        <Table>
          <thead><tr><Th>Name</Th><Th>District</Th><Th>Address</Th><Th>Phone</Th><Th>Hours</Th><Th /></tr></thead>
          <tbody>
            {points?.map((p) => (
              <tr key={p.id}>
                <Td className="font-medium text-ink">{p.name}</Td>
                <Td>{p.district}</Td>
                <Td><span className="flex items-center gap-1.5"><MapPin size={14} className="shrink-0 text-ink-muted" />{p.address}</span></Td>
                <Td className="tabular-nums">{p.phone ?? "-"}</Td>
                <Td>{p.hours ?? "-"}</Td>
                <Td className="text-right">
                  <Button
                    size="sm" variant="ghost" aria-label={`Remove ${p.name}`}
                    onClick={() => {
                      setError("");
                      api.deleteDropoffPoint(p.id).then(() => setPoints((l) => l?.filter((x) => x.id !== p.id) ?? null))
                        .catch((e) => setError(errorText(e)));
                    }}
                  >
                    <Trash2 size={15} /> Remove
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {points && !points.length && <EmptyState text="No drop-off points yet. Until you add one, donors can only ask for a collector pickup." />}
        {points && points.length > 0 && missing.length > 0 && (
          <p className="border-t border-line px-4 py-3 text-sm text-ink-soft">
            No drop-off point yet in: {missing.join(", ")}. Donors there are shown the nearest points in other districts.
          </p>
        )}
      </Card>
    </>
  );
}
