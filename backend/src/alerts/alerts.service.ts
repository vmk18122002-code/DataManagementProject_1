import { Injectable, NotFoundException } from "@nestjs/common";
import { Subject } from "rxjs";
import { DbService } from "../db.service";
import { Alert, AlertStatus, ExtractedAlert, Severity, SourceName } from "../types";

const SAME_ALERT_DAYS = 7; // same hazard + overlapping district within 7 days = one alert (as disaster_model.py)
const SEV_RANK: Record<Severity, number> = { Yellow: 0, Amber: 1, Red: 2 };

interface AlertRow {
  id: string; hazard: string; severity: Severity; title: string; districts: string; issued_at: string;
  people_affected: number | null; url: string | null; status: AlertStatus;
}

const lkTime = (iso: string) =>
  new Date(new Date(iso).getTime() + 5.5 * 3600e3).toISOString().slice(0, 16).replace("T", " ");

@Injectable()
export class AlertsService {
  /** Every created / updated alert is pushed here; the SSE endpoint streams it to the portal. */
  readonly changes = new Subject<Alert>();

  constructor(private readonly dbs: DbService) {}

  private get db() {
    return this.dbs.db;
  }

  private toAlert(r: AlertRow): Alert {
    const src = this.db.prepare(
      "SELECT DISTINCT s.source FROM alert_sources s JOIN raw_items r ON r.id = s.raw_item_id WHERE s.alert_id = ? ORDER BY r.fetched_at",
    ).all(r.id) as { source: SourceName }[];
    const sources = src.map((s) => s.source);
    return {
      id: r.id, source: sources[0] ?? "GDACS", sources, hazard: r.hazard, title: r.title,
      districts: JSON.parse(r.districts), issued: lkTime(r.issued_at), severity: r.severity, status: r.status,
      peopleAffected: r.people_affected ?? undefined, url: r.url ?? undefined, autoExtracted: true,
    };
  }

  list(status?: AlertStatus): Alert[] {
    const rows = (status
      ? this.db.prepare("SELECT * FROM alerts WHERE status = ? ORDER BY issued_at DESC").all(status)
      : this.db.prepare("SELECT * FROM alerts ORDER BY issued_at DESC").all()) as unknown as AlertRow[];
    return rows.map((r) => this.toAlert(r));
  }

  get(id: string): Alert {
    const r = this.db.prepare("SELECT * FROM alerts WHERE id = ?").get(id) as AlertRow | undefined;
    if (!r) throw new NotFoundException(`Alert ${id} not found`);
    return this.toAlert(r);
  }

  /** Human decision from the portal. Only a person moves an alert out of "New". */
  setStatus(id: string, status: AlertStatus, by = "Disaster coordinator"): Alert {
    this.get(id);
    this.db.prepare("UPDATE alerts SET status = ?, status_by = ?, status_at = ? WHERE id = ?")
      .run(status, by, new Date().toISOString(), id);
    const a = this.get(id);
    this.changes.next(a);
    return a;
  }

  /**
   * Dedupe: join an open alert with the same hazard, an overlapping district and an issue time within
   * SAME_ALERT_DAYS; otherwise create a new "New" alert. Returns the alert and whether it is new.
   */
  upsert(x: ExtractedAlert, rawItemId: number): { alert: Alert; created: boolean } {
    const t = new Date(x.issuedAt).getTime();
    const open = this.db.prepare("SELECT * FROM alerts WHERE hazard = ? AND status != 'Dismissed'")
      .all(x.hazard) as unknown as AlertRow[];
    const match = open.find((r) => {
      const days = Math.abs(new Date(r.issued_at).getTime() - t) / 864e5;
      const ds: string[] = JSON.parse(r.districts);
      // a national-level report (no districts) joins an open alert of the same hazard
      return days <= SAME_ALERT_DAYS && (!x.districts.length || ds.some((d) => x.districts.includes(d)));
    });

    if (match) {
      const districts = [...new Set([...JSON.parse(match.districts), ...x.districts])];
      const severity = SEV_RANK[x.severity] > SEV_RANK[match.severity] ? x.severity : match.severity;
      const people = Math.max(match.people_affected ?? 0, x.peopleAffected ?? 0) || null;
      this.db.prepare("UPDATE alerts SET districts = ?, severity = ?, people_affected = ? WHERE id = ?")
        .run(JSON.stringify(districts), severity, people, match.id);
      this.link(match.id, rawItemId, x.source);
      const alert = this.get(match.id);
      this.changes.next(alert);
      return { alert, created: false };
    }

    const d = new Date(x.issuedAt);
    const prefix = `AL-${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const n = (this.db.prepare("SELECT COUNT(*) AS n FROM alerts WHERE id LIKE ?").get(`${prefix}-%`) as { n: number }).n;
    const id = `${prefix}-${String(n + 1).padStart(2, "0")}`;
    this.db.prepare(`INSERT INTO alerts (id, hazard, severity, title, districts, issued_at, people_affected, url, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, x.hazard, x.severity, x.title, JSON.stringify(x.districts), x.issuedAt, x.peopleAffected ?? null,
        x.url ?? null, new Date().toISOString());
    this.link(id, rawItemId, x.source);
    const alert = this.get(id);
    this.changes.next(alert);
    return { alert, created: true };
  }

  private link(alertId: string, rawItemId: number, source: SourceName) {
    this.db.prepare("INSERT OR IGNORE INTO alert_sources (alert_id, raw_item_id, source) VALUES (?, ?, ?)")
      .run(alertId, rawItemId, source);
  }
}
