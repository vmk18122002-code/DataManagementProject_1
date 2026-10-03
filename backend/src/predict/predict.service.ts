import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { execFile } from "node:child_process";
import { resolve } from "node:path";

export type ModelItem = "Food" | "Clothes" | "Books";
export const MODEL_ITEMS: ModelItem[] = ["Food", "Clothes", "Books"];

interface NeedRow {
  district: string;
  ds: string;
  item: ModelItem;
  needLevel: string;        // poverty-based level from the dataset: High | Medium | Low
  needScore: number;
  needProbability: number;  // normal model: probability that the area needs this item
  v2Score: number | null;   // need model v2: 0-100 percentile, Living for Food / Clothes, Education for Books
  v2Level: string | null;   // need model v2: High | Medium | Low
  priority: number;         // probability and v2 score combined (common.py V2_WEIGHT)
  given: number;            // packs given this month
  limit: number;            // monthly pack limit
}
interface NeedTable {
  asOf: string;
  nearlyFull: number;
  closed: number;
  districtCoords: Record<string, [number, number]>;
  rows: NeedRow[];
}

const NEEDED = 0.5;           // the model's cut-off: at or above this the area needs the item
const KEEP_MS = 60 * 60_000;  // the table only changes when the distribution records do

/*
  Normal-time need model (train_normal.py -> models/normal_model.joblib).
  `python predict.py table` scores every DS division for every item; this service keeps that table and does the
  per-donor part here, with the same rules as predict.py `predict_normal`: only areas the model predicts as
  needing the item, the donor's own area first, then nearest district, then highest priority (the model's
  probability combined with the need model v2 score), each filled up to the room left under its monthly limit.
*/
@Injectable()
export class PredictService {
  private readonly log = new Logger("Predict");
  private table?: Promise<NeedTable>;
  private loadedAt = 0;

  constructor() {
    this.load().catch(() => {}); // warm up; a failure is logged and retried on the first request
  }

  private load(): Promise<NeedTable> {
    if (this.table && Date.now() - this.loadedAt < KEEP_MS) return this.table;
    this.loadedAt = Date.now();
    const cwd = resolve(process.env.MODEL_PROJECT_DIR ?? "..");
    const table = new Promise<NeedTable>((ok, fail) => {
      execFile(process.env.PYTHON ?? "python", ["predict.py", "table"], { cwd, maxBuffer: 32 * 1024 * 1024, timeout: 120_000 },
        (err, stdout, stderr) => {
          try {
            if (err) throw new Error(stderr.trim().split("\n").pop() || err.message);
            const t = JSON.parse(stdout) as NeedTable;
            this.log.log(`normal model: ${t.rows.length} area x item scores, records up to ${t.asOf}`);
            ok(t);
          } catch (e) {
            this.log.error(`could not run the normal model in ${cwd}: ${(e as Error).message}`);
            if (this.table === table) this.table = undefined; // try again next time
            fail(new ServiceUnavailableException("the need model is not available"));
          }
        });
    });
    this.table = table;
    return table;
  }

  private static km(coords: NeedTable["districtCoords"], a: string, b: string) {
    const rad = (d: number) => (d * Math.PI) / 180;
    const [la1, lo1] = coords[a].map(rad), [la2, lo2] = coords[b].map(rad);
    const h = Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2;
    return Math.round(6371 * 2 * Math.asin(Math.sqrt(h)));
  }

  /** The donor's location can be a DS division or a district. */
  private static locate(t: NeedTable, location: string) {
    const own = t.rows.find((r) => r.ds === location);
    const district = own?.district ?? (t.districtCoords[location] ? location : undefined);
    if (!district) throw new BadRequestException(`location '${location}' is not a district or DS division`);
    return { district, ownDs: own ? location : undefined };
  }

  /** Where `qty` packs of `item` from a donor in `location` should go. */
  async normal(item: ModelItem, qty: number, location: string, maxAreas = 6) {
    const t = await this.load();
    const { district, ownDs } = PredictService.locate(t, location);
    const needed = t.rows
      .filter((r) => r.item === item && r.needProbability >= NEEDED)
      .map((r) => ({ ...r, distanceKm: PredictService.km(t.districtCoords, district, r.district), own: r.ds === ownDs }))
      .sort((a, b) => Number(b.own) - Number(a.own) || a.distanceKm - b.distanceKm || b.priority - a.priority);

    let left = qty;
    const areas = [];
    for (const r of needed) {
      if (left <= 0) break;
      const room = Math.max(0, r.limit - r.given);
      const suggested = Math.min(left, room);
      if (!suggested) continue;
      left -= suggested;
      const fillAfter = Math.round(((r.given + suggested) / r.limit) * 100) / 100;
      areas.push({
        district: r.district, ds: r.ds, distanceKm: r.distanceKm, needLevel: r.needLevel,
        needProbability: Math.round(r.needProbability * 1000) / 1000,
        v2Score: r.v2Score, v2Level: r.v2Level, priority: r.priority,
        given: r.given, limit: r.limit, room, suggested, fillAfter,
        statusAfter: fillAfter >= t.closed ? "Closed" : fillAfter >= t.nearlyFull ? "Nearly full" : "Open",
      });
    }
    return {
      model: "normal", asOf: t.asOf, item, qty, location, district,
      placed: qty - left, unplaced: left, areaCount: areas.length, areas: areas.slice(0, maxAreas),
    };
  }

  /** For each item: how many areas in the donor's district the model says need it, and the packs still wanted. */
  async needs(location: string) {
    const t = await this.load();
    const { district } = PredictService.locate(t, location);
    const items = MODEL_ITEMS.map((item) => {
      const open = t.rows.filter((r) => r.item === item && r.district === district
        && r.needProbability >= NEEDED && r.limit > r.given);
      return { item, areas: open.length, packsNeeded: open.reduce((s, r) => s + r.limit - r.given, 0) };
    });
    return { model: "normal", asOf: t.asOf, district, items };
  }
}
