"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Mail, Plus, Trash2 } from "lucide-react";
import { Button, Card, EmptyState, Field, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { CollectorInvite, api } from "@/lib/api";
import { errorText } from "@/lib/auth";
import { DISTRICTS, DropoffPoint, VEHICLES } from "@/lib/data";
import { useApp } from "@/lib/store";

const EMPTY = {
  name: "", email: "", org: "", district: DISTRICTS[0], phone: "",
  vehicleType: VEHICLES[3] as string, vehicleNo: "",
};
const DONE = ["Delivered", "Dispatched to area", "Reached area"];

export default function Collectors() {
  const { collectors, reloadCollectors, donations } = useApp();
  const [points, setPoints] = useState<DropoffPoint[] | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [invite, setInvite] = useState<CollectorInvite | null>(null);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  useEffect(() => {
    api.dropoffPoints().then(setPoints).catch((e) => setError(errorText(e)));
  }, []);


  const activeJobs = (name: string) => donations.filter((d) => d.collector === name && !DONE.includes(d.status)).length;

  return (
    <>
      <PageHeader
        title="Collectors"
        subtitle="Collection teams in each district. A collector picks up from donors in their district and brings the items to the nearest drop-off point."
      />

      <Card title="Add a collector" className="mb-6">
        {points && !points.length ? (
          <p className="p-5 text-sm text-ink-soft">
            Add a{" "}
            <Link href="/coordinator/dropoff" className="font-medium text-brand-700 hover:underline">drop-off point</Link>{" "}
            first. Every collector needs a place to bring the items they collect.
          </p>
        ) : (
          <form
            className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                setInvite(null);
                setInvite(await api.createCollector(form));
                await reloadCollectors();
                setForm({ ...EMPTY, org: form.org, district: form.district });
              } catch (err) {
                setError(errorText(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="Collector name">
              <Input placeholder="Kasun Silva" value={form.name} onChange={set("name")} required />
            </Field>
            <Field label="Organisation">
              <Input placeholder="Red Cross - Colombo" value={form.org} onChange={set("org")} required />
            </Field>
            <Field label="Phone">
              <Input type="tel" placeholder="077 400 1001" value={form.phone} onChange={set("phone")} required />
            </Field>
            <Field label="Email" hint="The sign-in link and a temporary password are emailed here.">
              <Input type="email" placeholder="kasun@example.com" autoComplete="off" value={form.email} onChange={set("email")} required />
            </Field>
            <Field label="District they collect in">
              <Select value={form.district} onChange={set("district")}>
                {DISTRICTS.map((d) => <option key={d}>{d}</option>)}
              </Select>
            </Field>
            <Field label="Vehicle type">
              <Select value={form.vehicleType} onChange={set("vehicleType")}>
                {VEHICLES.map((v) => <option key={v}>{v}</option>)}
              </Select>
            </Field>
            <Field label="Vehicle number (optional)">
              <Input placeholder="WP LB 4521" value={form.vehicleNo} onChange={set("vehicleNo")} />
            </Field>

            <div className="sm:col-span-2 lg:col-span-3">
              <Button type="submit" disabled={busy}><Plus size={16} /> {busy ? "Saving..." : "Add collector"}</Button>
            </div>
          </form>
        )}
      </Card>

      {error && <p role="alert" className="mb-4 rounded-lg bg-danger-50 px-4 py-3 text-sm text-danger-700">{error}</p>}

      {invite && (invite.emailSent ? (
        <p role="status" className="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          The sign-in link and a temporary password for {invite.collector.name} were emailed to <b>{invite.email}</b>.
          It works for {invite.validHours} hours; they choose their own password when they sign in.
        </p>
      ) : (
        <div role="status" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p>
            The invitation email for {invite.collector.name} to <b>{invite.email}</b> could not be sent.
            Give them this temporary password yourself. It is shown only once and works for {invite.validHours} hours.
          </p>
          <p className="mt-2">
            Temporary password: <code className="rounded bg-white px-2 py-1 text-base font-semibold tracking-wide text-ink">{invite.tempPassword}</code>
          </p>
        </div>
      ))}

      <Card title={`Collectors (${collectors.length})`}>
        <Table>
          <thead>
            <tr><Th>Collector</Th><Th>Organisation</Th><Th>District</Th><Th>Phone</Th><Th>Vehicle</Th><Th>Delivers to</Th><Th className="text-right">Active jobs</Th><Th /></tr>
          </thead>
          <tbody>
            {collectors.map((c) => (
              <tr key={c.id}>
                <Td className="font-medium text-ink">{c.name}</Td>
                <Td>{c.org}</Td>
                <Td>{c.district}</Td>
                <Td className="tabular-nums">{c.phone}</Td>
                <Td>{c.vehicleType}{c.vehicleNo && <span className="block text-xs text-ink-muted">{c.vehicleNo}</span>}</Td>
                <Td>{c.dropoff ? <>{c.dropoff.name}<span className="block text-xs text-ink-muted">{c.dropoff.address}</span></> : "-"}</Td>
                <Td className="text-right tabular-nums">{activeJobs(c.name)}</Td>
                <Td className="whitespace-nowrap text-right">
                  <Button
                    size="sm" variant="ghost" aria-label={`Send the invitation to ${c.name} again`}
                    onClick={() => {
                      setError("");
                      setInvite(null);
                      api.reinviteCollector(c.id).then(setInvite).catch((e) => setError(errorText(e)));
                    }}
                  >
                    <Mail size={15} /> Resend invite
                  </Button>
                  <Button
                    size="sm" variant="ghost" aria-label={`Remove ${c.name}`}
                    onClick={() => {
                      setError("");
                      api.deleteCollector(c.id).then(reloadCollectors).catch((e) => setError(errorText(e)));
                    }}
                  >
                    <Trash2 size={15} /> Remove
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {!collectors.length && <EmptyState text="No collectors yet. Until you add one, donors can only use a drop-off point." />}
      </Card>
    </>
  );
}
