/*
  Offline check of the ReliefWeb fetcher: replaces fetch() with a sample ReliefWeb v2 response
  and prints what the backend would extract. Needs `npm run build` first.
    node scripts/test-reliefweb.js
  The sample follows ReliefWeb's documented response shape ({ data: [{ id, fields }] }); confirm the
  field names against a real response once you have an approved appname.
*/
const { fetchReliefWeb } = require("../dist/ingest/fetchers");

const sample = {
  data: [
    { id: "52401", fields: {
      name: "Sri Lanka: Cyclone Ditwah - Nov 2025",
      url: "https://reliefweb.int/disaster/tc-2025-000001-lka",
      date: { event: "2025-11-27T00:00:00+00:00" },
      type: [{ name: "Tropical Cyclone" }, { name: "Flood" }],
      description: "Severe flooding and landslides in Kandy, Badulla and Nuwara Eliya districts. 1,200,000 people affected.",
    } },
    { id: "52402", fields: {
      name: "Sri Lanka: Drought - 2026",
      date: { event: "2026-03-01T00:00:00+00:00" },
      type: [{ name: "Drought" }],
      description: "Dry weather affecting paddy cultivation in Anuradhapura and Polonnaruwa.",
    } },
    { id: "52403", fields: { name: "Sri Lanka: Epidemic - 2026", type: [{ name: "Epidemic" }] } },
  ],
};

let sentBody;
global.fetch = async (url, init) => {
  sentBody = JSON.parse(init.body);
  console.log("POST", url);
  return new Response(JSON.stringify(sample), { status: 200, headers: { "content-type": "application/json" } });
};

fetchReliefWeb("my-app-name", new Date("2025-11-01")).then((items) => {
  console.log("filter sent:", JSON.stringify(sentBody.filter));
  for (const it of items) {
    const x = it.extracted;
    console.log(`\n#${it.externalId}`, x
      ? `-> ${x.hazard} | ${x.severity} | ${x.districts.join(", ")} | people ${x.peopleAffected ?? "-"} | ${x.issuedAt}`
      : "-> skipped (no hazard or district found)");
  }
});
