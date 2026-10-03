// Approximate district centres (same values as relief-portal/src/lib/data.ts DISTRICT_XY).
export const DISTRICT_XY: Record<string, [number, number]> = {
  Colombo: [6.93, 79.86], Gampaha: [7.09, 80.0], Kalutara: [6.58, 79.96], Kandy: [7.29, 80.63],
  Matale: [7.47, 80.62], "Nuwara Eliya": [6.97, 80.77], Galle: [6.05, 80.22], Matara: [5.95, 80.54],
  Hambantota: [6.12, 81.12], Jaffna: [9.66, 80.02], Kilinochchi: [9.38, 80.4], Mannar: [8.98, 79.9],
  Vavuniya: [8.75, 80.5], Mullaitivu: [9.27, 80.81], Batticaloa: [7.73, 81.7], Ampara: [7.3, 81.67],
  Trincomalee: [8.59, 81.21], Kurunegala: [7.49, 80.36], Puttalam: [8.04, 79.84],
  Anuradhapura: [8.31, 80.4], Polonnaruwa: [7.94, 81.0], Badulla: [6.99, 81.06],
  Monaragala: [6.87, 81.35], Ratnapura: [6.68, 80.4], Kegalle: [7.25, 80.35],
};
export const DISTRICTS = Object.keys(DISTRICT_XY);

// spellings seen in DMC / Met reports -> district name used here
const DISTRICT_ALIAS: Record<string, string> = {
  rathnapura: "Ratnapura", moneragala: "Monaragala", batticoloa: "Batticaloa", vavunia: "Vavuniya",
  anuradapura: "Anuradhapura", nuwaraeliya: "Nuwara Eliya", trinco: "Trincomalee", mulativu: "Mullaitivu",
};

export function km(lat1: number, lon1: number, lat2: number, lon2: number) {
  const dx = (lon2 - lon1) * 111 * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  const dy = (lat2 - lat1) * 111;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Districts whose centre lies within `radiusKm` of a point; the closest one if none does. */
export function districtsNear(lat: number, lon: number, radiusKm: number): string[] {
  const d = DISTRICTS.map((n) => ({ n, k: km(lat, lon, ...DISTRICT_XY[n]) })).sort((a, b) => a.k - b.k);
  const near = d.filter((x) => x.k <= radiusKm).map((x) => x.n);
  return near.length ? near : [d[0].n];
}

/** District names mentioned in free text (reports, warnings). */
export function districtsInText(text: string): string[] {
  const found = new Set<string>();
  const flat = text.toLowerCase().replace(/[^a-z]/g, "");
  for (const d of DISTRICTS) {
    if (new RegExp(`\\b${d.replace(" ", "\\s*")}\\b`, "i").test(text)) found.add(d);
  }
  for (const [alias, d] of Object.entries(DISTRICT_ALIAS)) if (flat.includes(alias)) found.add(d);
  return [...found];
}
