import { districtsInText, districtsNear } from "../geo";
import { ExtractedAlert, Severity, SourceName } from "../types";

// ---------------------------------------------------------------- GDACS (JSON)
export interface GdacsFeature {
  geometry: { type: string; coordinates: [number, number] };
  properties: {
    eventtype: string; eventid: number; episodeid: number; name: string; htmldescription?: string;
    alertlevel: "Green" | "Orange" | "Red"; fromdate: string; todate: string;
    url?: { report?: string };
  };
}

const GDACS_HAZARD: Record<string, string> = {
  FL: "Flood", TC: "Cyclone / wind", DR: "Drought", EQ: "Earthquake / tsunami",
};
const GDACS_SEVERITY: Record<string, Severity> = { Red: "Red", Orange: "Amber", Green: "Yellow" };
// a cyclone centre affects a much wider area than a flood centroid
const GDACS_RADIUS_KM: Record<string, number> = { FL: 90, TC: 200, DR: 120, EQ: 150 };

export function fromGdacs(f: GdacsFeature): ExtractedAlert | null {
  const p = f.properties;
  const hazard = GDACS_HAZARD[p.eventtype];
  if (!hazard || f.geometry?.type !== "Point") return null;
  const [lon, lat] = f.geometry.coordinates;
  return {
    source: "GDACS",
    externalId: `${p.eventtype}-${p.eventid}-${p.episodeid}`,
    hazard,
    severity: GDACS_SEVERITY[p.alertlevel] ?? "Yellow",
    title: p.htmldescription || p.name,
    // GDACS gives a point, not districts: districts near it, for the coordinator to check
    districts: districtsNear(lat, lon, GDACS_RADIUS_KM[p.eventtype] ?? 100),
    issuedAt: new Date(`${p.fromdate}Z`).toISOString(),
    url: p.url?.report,
  };
}

// ---------------------------------------------------------------- free text (DMC / Met / NBRO / news)
const HAZARD_WORDS: [RegExp, string][] = [
  [/landslide|earth\s*slip|rock\s*fall/i, "Landslide"],
  [/cyclone|depression|storm|strong wind|gale/i, "Cyclone / wind"],
  [/tsunami|storm surge|sea level rise/i, "Tsunami / coastal"],
  [/drought|dry weather|water scarcity/i, "Drought"],
  [/flood|inundat|water level.*(rise|spill)|spill gates/i, "Flood"],
  [/heavy rain|\b1[5-9]\d\s*mm|\b[2-9]\d{2}\s*mm|thunder/i, "Heavy rain"],
];

function severityFromText(t: string): Severity {
  if (/\bred\b|level\s*3|evacuat|major flood|critical/i.test(t)) return "Red";
  if (/\bamber\b|orange|level\s*2|minor flood|be alert|warning/i.test(t)) return "Amber";
  return "Yellow";
}

/** Keyword / regex extraction for text sources. Returns null when no hazard or district is found. */
export function fromText(source: SourceName, externalId: string, text: string, issuedAt?: string, url?: string,
                         hazardHint?: string, allowNoDistrict = false): ExtractedAlert | null {
  const hazard = hazardHint ?? HAZARD_WORDS.find(([re]) => re.test(text))?.[1];
  const districts = districtsInText(text);
  if (!hazard || (!districts.length && !allowNoDistrict)) return null;
  const people = text.match(/([\d,]{2,})\s*(?:people|persons|individuals)/i);
  return {
    source, externalId, hazard, districts, url,
    severity: severityFromText(text),
    title: text.replace(/\s+/g, " ").trim().slice(0, 140),
    issuedAt: issuedAt ? new Date(issuedAt).toISOString() : new Date().toISOString(),
    peopleAffected: people ? Number(people[1].replace(/,/g, "")) : undefined,
  };
}
