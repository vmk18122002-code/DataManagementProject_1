import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";
import { AlertsService } from "../alerts/alerts.service";
import { DbService } from "../db.service";
import { ExtractedAlert, SourceName, SourceStatus } from "../types";
import { FetchedItem, fetchGdacs, fetchReliefWeb, fetchReliefWebRss } from "./fetchers";

export interface RunResult {
  from: string;
  to: string;
  sources: SourceStatus[];
  alertsCreated: number;
  alertsUpdated: number;
  busy?: boolean; // a fetch was already running; nothing was done
}

@Injectable()
export class IngestService implements OnModuleInit {
  private readonly log = new Logger(IngestService.name);
  private running = false;
  private readonly status = new Map<SourceName, SourceStatus>();

  constructor(private readonly dbs: DbService, private readonly alerts: AlertsService,
              private readonly scheduler: SchedulerRegistry) {}

  private fetchers(): { source: SourceName; enabled: boolean; via: string;
                        run: (from: Date, to: Date) => Promise<FetchedItem[]> }[] {
    const appname = process.env.RELIEFWEB_APPNAME;
    return [
      { source: "GDACS", enabled: true, via: "API", run: fetchGdacs },
      // the API needs an approved appname; the public RSS feeds do not
      appname
        ? { source: "ReliefWeb", enabled: true, via: "API", run: (from) => fetchReliefWeb(appname, from) }
        : { source: "ReliefWeb", enabled: true, via: "RSS", run: fetchReliefWebRss },
    ];
  }

  onModuleInit() {
    for (const f of this.fetchers()) this.status.set(f.source, { source: f.source, enabled: f.enabled, via: f.via });
    const minutes = Number(process.env.FETCH_EVERY_MIN ?? 15);
    this.scheduler.addInterval("fetch-alerts", setInterval(() => void this.run(), minutes * 60_000));
    void this.run();
  }

  sourceStatus(): SourceStatus[] {
    return [...this.status.values()];
  }

  /** Fetch every enabled source for [from, to] (default: last 3 days) and turn new items into alerts. */
  async run(from = new Date(Date.now() - 3 * 864e5), to = new Date()): Promise<RunResult> {
    const result: RunResult = { from: from.toISOString(), to: to.toISOString(), sources: [], alertsCreated: 0, alertsUpdated: 0 };
    if (this.running) return { ...result, sources: this.sourceStatus(), busy: true };
    this.running = true;
    try {
      for (const f of this.fetchers()) {
        const st: SourceStatus = { source: f.source, enabled: f.enabled, via: f.via, lastRun: new Date().toISOString() };
        if (f.enabled) {
          try {
            const items = await f.run(from, to);
            let fresh = 0;
            for (const it of items) {
              const rawId = this.saveRaw(f.source, it);
              if (rawId === null) continue; // seen before
              fresh++;
              if (it.extracted) this.count(result, this.alerts.upsert(it.extracted, rawId).created);
            }
            Object.assign(st, { ok: true, newItems: fresh });
          } catch (e) {
            // keep going with the other sources; the portal shows the source as failing
            Object.assign(st, { ok: false, error: (e as Error).message });
            this.log.warn(`${f.source} fetch failed: ${(e as Error).message}`);
          }
        }
        this.status.set(f.source, st);
        result.sources.push(st);
      }
    } finally {
      this.running = false;
    }
    this.log.log(`fetch done: ${result.alertsCreated} new alerts, ${result.alertsUpdated} updated`);
    return result;
  }

  /** Item pushed by an external worker (DMC PDF parser, Met / NBRO scraper). */
  ingestExternal(source: SourceName, externalId: string, payload: unknown, extracted: ExtractedAlert | null, url?: string) {
    const rawId = this.saveRaw(source, { externalId, url, payload, extracted });
    if (rawId === null) return { duplicate: true };
    if (!extracted) return { duplicate: false, alert: null, reason: "no hazard or district found in text" };
    const { alert, created } = this.alerts.upsert(extracted, rawId);
    return { duplicate: false, created, alert };
  }

  private count(r: RunResult, created: boolean) {
    if (created) r.alertsCreated++;
    else r.alertsUpdated++;
  }

  /** Stores the raw item; returns its id, or null when this source item was already stored. */
  private saveRaw(source: SourceName, it: FetchedItem): number | null {
    const res = this.dbs.db.prepare(
      "INSERT OR IGNORE INTO raw_items (source, external_id, url, payload, fetched_at) VALUES (?, ?, ?, ?, ?)",
    ).run(source, it.externalId, it.url ?? null, JSON.stringify(it.payload), new Date().toISOString());
    return res.changes ? Number(res.lastInsertRowid) : null;
  }
}
