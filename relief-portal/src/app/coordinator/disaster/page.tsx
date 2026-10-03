"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, RefreshCw, XCircle } from "lucide-react";
import { ModeCard } from "@/components/ModeCard";
import { Badge, Button, Card, PageHeader, StatusBadge, cx } from "@/components/ui";
import { api, SourceStatus } from "@/lib/api";
import { fmt } from "@/lib/needs";
import { CURRENT_COORDINATOR } from "@/lib/data";
import { useApp } from "@/lib/store";

const DEMO_SOURCES = ["DMC", "NBRO", "Met Department", "GDACS", "RISE Sri Lanka"];
const hhmm = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

export default function Alerts() {
  const { alerts, alertFeed, reloadAlerts, setAlertStatus, activateDisaster } = useApp();
  const [checked, setChecked] = useState("06:32");
  const [loading, setLoading] = useState(false);
  const [sources, setSources] = useState<SourceStatus[] | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (alertFeed !== "live") return;
    api.sources().then((s) => {
      setSources(s);
      const last = s.map((x) => x.lastRun).filter(Boolean).sort().pop();
      if (last) setChecked(hhmm(new Date(last)));
    }).catch(() => {});
  }, [alertFeed]);

  const refresh = async () => {
    setLoading(true);
    setMessage("");
    try {
      const r = await api.fetchNow();
      setSources(r.sources);
      setMessage(r.busy ? "A fetch is already running - try again in a minute" : `${r.alertsCreated} new, ${r.alertsUpdated} updated`);
      await reloadAlerts();
    } catch {
      await reloadAlerts();
      setMessage("Backend not reachable - showing sample alerts");
    }
    setChecked(hhmm(new Date()));
    setLoading(false);
  };

  return (
    <>
      <PageHeader title="Disaster Alerts" subtitle="Alerts fetched from official sources every 15 minutes. An officer must confirm before Disaster Mode starts."
        actions={<Button variant="secondary" onClick={refresh} disabled={loading}><RefreshCw size={16} className={cx(loading && "animate-spin")} />Fetch alerts</Button>} />
      <ModeCard />

      <div className="mb-6 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-ink-soft">Sources · last checked {checked}:</span>
        {sources
          ? sources.map((s) => (
            <Badge key={s.source} tone={!s.enabled ? "gray" : s.ok === false ? "red" : "green"}>
              <span className={cx("h-1.5 w-1.5 rounded-full", !s.enabled ? "bg-gray-400" : s.ok === false ? "bg-red-500" : "bg-emerald-500")} />
              <span title={s.error ?? (s.enabled ? "" : "Not configured")}>{s.source}{s.via === "RSS" && " · RSS"}{!s.enabled && " (off)"}{s.ok === false && " (failing)"}</span>
            </Badge>
          ))
          : DEMO_SOURCES.map((s) => <Badge key={s} tone="green"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{s}</Badge>)}
        {alertFeed === "demo" && <Badge tone="amber">Sample data - backend offline</Badge>}
        {message && <span className="text-ink-muted">· {message}</span>}
      </div>

      <div className="space-y-4">
        {alerts.map((a) => (
          <Card key={a.id} className={cx(a.status === "Dismissed" && "opacity-60")}>
            <div className="flex flex-wrap items-start justify-between gap-4 p-5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={a.severity === "Red" ? "red" : a.severity === "Amber" ? "amber" : "gray"}>{a.severity}</Badge>
                  <Badge tone="blue">{a.hazard}</Badge>
                  <span className="text-sm text-ink-muted">{(a.sources ?? [a.source]).join(" + ")} · {a.issued} · {a.id}</span>
                  {a.autoExtracted && <Badge tone="gray">Auto-extracted</Badge>}
                </div>
                <p className="mt-2 font-medium text-ink">{a.title}</p>
                <p className="mt-1 text-sm text-ink-soft">
                  Districts: {a.districts.length ? a.districts.join(", ") : "not stated - check the report"}
                  {a.peopleAffected ? ` · ${fmt(a.peopleAffected)} people affected (reported)` : ""}
                </p>
                {a.url && (
                  <a href={a.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-sm text-brand-700 hover:underline">
                    Source report<ExternalLink size={14} />
                  </a>
                )}
              </div>
              <div className="flex items-center gap-2">
                {a.status === "New" && !CURRENT_COORDINATOR.canActivateDisaster ? (
                  <span className="text-sm text-ink-muted">Waiting for an organization member to confirm</span>
                ) : a.status === "New" ? (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => setAlertStatus(a.id, "Dismissed")}><XCircle size={16} />Dismiss</Button>
                    <Button size="sm" variant="danger" onClick={() => { setAlertStatus(a.id, "Confirmed"); activateDisaster(); }}>
                      <CheckCircle2 size={16} />Confirm & activate
                    </Button>
                  </>
                ) : (
                  <>
                    <StatusBadge status={a.status} />
                    {a.status === "Confirmed" && <Link href="/coordinator/disaster/affected" className="text-sm font-medium text-brand-700 hover:underline">View affected areas</Link>}
                  </>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
