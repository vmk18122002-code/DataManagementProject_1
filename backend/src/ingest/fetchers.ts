import { XMLParser } from "fast-xml-parser";
import https from "node:https";
import { ExtractedAlert } from "../types";
import { GdacsFeature, fromGdacs, fromText } from "./extract";

export interface FetchedItem {
  externalId: string;
  url?: string;
  payload: unknown;               // stored as-is in raw_items
  extracted: ExtractedAlert | null;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

async function getJson(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** GDACS events for Sri Lanka (floods, cyclones, droughts, earthquakes). Free, no key. */
export async function fetchGdacs(from: Date, to: Date): Promise<FetchedItem[]> {
  const url = "https://www.gdacs.org/gdacsapi/api/Events/geteventlist/SEARCH"
    + `?eventlist=FL;TC;DR;EQ&country=Sri%20Lanka&fromdate=${day(from)}&todate=${day(to)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (res.status === 204) return []; // no events in the window
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const text = await res.text();
  if (!text.trim()) return [];
  const data = JSON.parse(text) as { features?: GdacsFeature[] };
  return (data.features ?? []).map((f) => {
    const p = f.properties;
    return {
      externalId: `${p.eventtype}-${p.eventid}-${p.episodeid}`,
      url: p.url?.report,
      payload: f,
      extracted: fromGdacs(f),
    };
  });
}

const RELIEFWEB_HAZARD: Record<string, string> = {
  "Tropical Cyclone": "Cyclone / wind", "Severe Local Storm": "Cyclone / wind", "Flood": "Flood",
  "Flash Flood": "Flood", "Land Slide": "Landslide", "Mud Slide": "Landslide", "Drought": "Drought",
  "Tsunami": "Tsunami / coastal", "Storm Surge": "Tsunami / coastal",
};

/**
 * ReliefWeb (UN OCHA) disasters for Sri Lanka. API v2 needs an approved appname
 * (RELIEFWEB_APPNAME); without one it is skipped. Not yet tested against the live API.
 */
export async function fetchReliefWeb(appname: string, from: Date): Promise<FetchedItem[]> {
  const data = await getJson(`https://api.reliefweb.int/v2/disasters?appname=${encodeURIComponent(appname)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      filter: { operator: "AND", conditions: [
        { field: "country.iso3", value: "LKA" },
        { field: "date.event", value: { from: from.toISOString() } },
      ] },
      fields: { include: ["name", "date.event", "type.name", "status", "url", "description"] },
      sort: ["date.event:desc"],
      limit: 50,
    }),
  }) as { data?: { id: string; fields: { name: string; url?: string; description?: string; date?: { event?: string }; type?: { name: string }[] } }[] };

  return (data.data ?? []).map((d) => {
    const f = d.fields;
    const types = (f.type ?? []).map((t) => t.name);
    const text = `${f.name}. ${types.join(", ")}. ${f.description ?? ""}`;
    // ReliefWeb lists the disaster types (main one first); use them before keyword matching
    const hazard = types.map((t) => RELIEFWEB_HAZARD[t]).find(Boolean);
    return { externalId: d.id, url: f.url, payload: d,
             extracted: fromText("ReliefWeb", d.id, text, f.date?.event, f.url, hazard) };
  });
}

// ---------------------------------------------------------------- ReliefWeb RSS (no appname needed)
interface RssItem { title: string; link: string; guid?: string | { "#text": string }; pubDate: string; description?: string }

const xml = new XMLParser({ ignoreAttributes: true });
const stripHtml = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&[a-z]+;/g, " ")
  .replace(/\s+/g, " ").trim();

// ReliefWeb answers Node's built-in fetch() with 406 but accepts node:https, so the feeds use https.get
function getText(url: string, redirects = 3): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "user-agent": "ReliefHub/1.0" }, timeout: 30_000 }, (res) => {
      const code = res.statusCode ?? 0;
      if (code >= 300 && code < 400 && res.headers.location && redirects > 0) {
        res.resume();
        // ReliefWeb redirects to plain http; stay on https
        const next = new URL(res.headers.location, url);
        next.protocol = "https:";
        return resolve(getText(next.href, redirects - 1));
      }
      if (code !== 200) {
        res.resume();
        return reject(new Error(`${code} ${res.statusMessage} (${url})`));
      }
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve(body));
    });
    req.on("timeout", () => req.destroy(new Error(`timeout (${url})`)));
    req.on("error", reject);
  });
}

async function rss(url: string): Promise<RssItem[]> {
  const items = xml.parse(await getText(url))?.rss?.channel?.item ?? [];
  return Array.isArray(items) ? items : [items];
}

/**
 * ReliefWeb through its public RSS feeds, used when no API appname is set.
 *  - disasters feed (Sri Lanka): declared disasters; kept even without district names (national level)
 *  - Sri Lanka updates feed: situation reports; kept only when a hazard AND a district are found
 * Feeds hold the latest items only (about 20), so `from` / `to` filter what they return.
 */
export async function fetchReliefWebRss(from: Date, to: Date): Promise<FetchedItem[]> {
  const feeds: [string, boolean][] = [
    ["https://reliefweb.int/disasters/rss.xml?search=country.exact:%22Sri%20Lanka%22", true],
    ["https://reliefweb.int/country/lka/rss.xml", false],
  ];
  const out: FetchedItem[] = [];
  for (const [url, isDisaster] of feeds) {
    for (const it of await rss(url)) {
      const date = new Date(it.pubDate);
      if (isNaN(+date) || date < from || date > to) continue;
      const id = (typeof it.guid === "object" ? it.guid["#text"] : it.guid) ?? it.link;
      const text = `${it.title}. ${stripHtml(it.description ?? "")}`;
      const hazard = isDisaster ? HAZARD_FROM_TITLE.find(([re]) => re.test(it.title))?.[1] : undefined;
      if (isDisaster && !hazard) continue; // epidemics, conflict etc. are not relief alerts here
      out.push({
        externalId: id, url: it.link, payload: it,
        extracted: fromText("ReliefWeb", id, text, date.toISOString(), it.link, hazard, isDisaster),
      });
    }
  }
  return out;
}

// ReliefWeb disaster titles look like "Sri Lanka: Floods and Landslides - Nov 2025" / "Tropical Cyclone Ditwah - Nov 2025"
const HAZARD_FROM_TITLE: [RegExp, string][] = [
  [/cyclone|storm/i, "Cyclone / wind"], [/flood/i, "Flood"], [/landslide/i, "Landslide"],
  [/drought/i, "Drought"], [/tsunami/i, "Tsunami / coastal"],
];
