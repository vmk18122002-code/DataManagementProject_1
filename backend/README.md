# ReliefHub backend: disaster alert ingestion

Fetches disaster alerts for Sri Lanka, merges duplicates and serves them to the portal.
A person still has to confirm each alert in the portal. Nothing here changes limits on its own.

```
cp .env.example .env
npm install
npm run dev            # builds, then serves http://localhost:4000
```

Then run the portal (`relief-portal`, `npm run dev`). It reads `NEXT_PUBLIC_API_URL` (default `http://localhost:4000`)
and falls back to its sample alerts when this API is not running.

## Sources

| Source | How | Status |
|---|---|---|
| GDACS | JSON API, `country=Sri Lanka`, every `FETCH_EVERY_MIN` minutes | working |
| ReliefWeb | public RSS feeds (Sri Lanka disasters + Sri Lanka updates); API v2 instead when `RELIEFWEB_APPNAME` is set | RSS working; API not tested live |
| DMC / Met Department / NBRO / RISE | external worker POSTs report text to `/raw-items` | endpoint ready, workers not written yet |

The RSS feeds only hold the latest items, so back-filling an old window works for the disasters feed but not for older
situation reports. GDACS gives a point, not districts. Districts within 90 km (flood) or 200 km (cyclone) of it are listed for the coordinator to check.

## API

| Method | Path | |
|---|---|---|
| GET | `/alerts?status=New` | list alerts |
| GET | `/alerts/stream` | server-sent events, one `alert` event per create / update |
| PATCH | `/alerts/:id/status` | `{ "status": "Confirmed" \| "Dismissed" \| "New" }` |
| GET | `/sources` | last run, ok / error per source |
| POST | `/ingest/run` | fetch now; optional `{ "from": "2025-11-15", "to": "2025-12-15" }` to back-fill |
| POST | `/raw-items` | header `x-api-key: INGEST_API_KEY`; `{ source, externalId, text, issuedAt?, url? }` |

Duplicates: an item seen before (same source + id) is ignored. A new item with the same hazard, an overlapping
district and a date within 7 days joins the existing alert (districts merged, highest severity kept).

Alert storage is SQLite (`node:sqlite`, `DB_FILE`). The tables match the PostgreSQL
design. Replace `src/db.service.ts` to move to PostgreSQL.

## Accounts and donor data (MongoDB)

Needs a MongoDB server (`MONGODB_URI`, database `MONGODB_DB`) and a `JWT_SECRET` of 32+ characters; the API will not
start without them. Passwords are stored as bcrypt hashes. Login returns `{ token, user }`; send the token as
`Authorization: Bearer <token>`. Tokens last `JWT_EXPIRES_IN` (default 7 days).

Collections: `donors` (account + profile), `org_users` (organization admins and collectors), `donations`, `counters`.
The first organization admin is created from `ORG_ADMIN_EMAIL` / `ORG_ADMIN_PASSWORD` while `org_users` is empty.

| Method | Path | Who | |
|---|---|---|---|
| POST | `/auth/donor/register` | anyone | `{ name, email, password, phone, address, district }` |
| POST | `/auth/donor/login` | anyone | `{ email, password }` |
| POST | `/auth/org/login` | anyone | `{ email, password }` |
| GET | `/auth/me` | signed in | current account |
| POST | `/auth/org/users` | admin | add a member: `{ name, email, password, role: "admin" \| "collector", org?, district? }` |
| GET / PATCH | `/donors/me` | donor | own profile; PATCH any of `{ name, phone, address, district }` |
| GET | `/donors` | admin | all donors |
| GET | `/donations` | signed in | a donor gets their own, organization members get all |
| POST | `/donations` | donor | `{ donor, phone, email, address, district, items, targetDs, targetDistrict, date }` |
| PATCH | `/donations/:id` | admin, collector | any of `{ status, collector, targetDs, targetDistrict, proof, areaProof }` |

`PATCH /alerts/:id/status` and `POST /ingest/run` now need an admin token.

## Need model (normal time)

GET /predict/normal?item=Food&qty=500&location=Kandy and GET /predict/needs?location=Kandy (signed in) serve the
normal-time model from 	rain_normal.py. The backend runs python predict.py table in MODEL_PROJECT_DIR (default ..)
with PYTHON (default python, needs pandas, xgboost, joblib), keeps the scores for an hour and ranks areas for each
donor with the same rules as predict.py normal: areas the model predicts as needing the item, nearest first, each
filled up to its monthly limit. The donate page uses it in Normal Mode and falls back to its built-in rules if it fails.

Among areas at the same distance, the order is the normal model's probability combined 50/50 with the need model v2
score from `Need_Model_Results_v2.xlsx` (Living for food and clothes, Education for books; `V2_WEIGHT` in `common.py`).

## Drop-off points

Places where a donor hands in items themselves instead of a collector pickup (collection `dropoff_points`).

| Method | Path | Who | |
|---|---|---|---|
| GET | `/dropoff-points?district=Kandy` | signed in | all points, or one district |
| POST | `/dropoff-points` | admin | `{ name, address, district, phone?, hours? }` |
| DELETE | `/dropoff-points/:id` | admin | donations keep their own copy of the point |

`POST /donations` takes either `address` (collector pickup) or `dropoffId`. A drop-off donation needs no collector:
an admin marks it received, which moves it to `Delivered`.

## Collectors

Collector accounts (`org_users` with role `collector`), each with a district, vehicle and the drop-off point they deliver to.

| Method | Path | Who | |
|---|---|---|---|
| GET | `/collectors` | signed in | name, organisation, district, phone, vehicle, drop-off point |
| POST | `/collectors` | admin | `{ name, email, org, district, phone, vehicleType, vehicleNo? }` |
| DELETE | `/collectors/:id` | admin | removes the account |

Adding a collector creates a temporary password and emails it with the sign-in link (`SMTP_*`, `MAIL_FROM`, `PORTAL_URL`).
Without `SMTP_HOST`, or if sending fails, the response carries `tempPassword` for the admin to pass on. Until the
collector sets their own password (`POST /auth/password { newPassword }`) their token only works for `/auth/me` and
`/auth/password`. Anyone else changing a password also sends `currentPassword`.

Temporary passwords work beside the real one for `TEMP_PASSWORD_HOURS` (default 48) and are cancelled by a normal
sign-in or by choosing a new password. `POST /auth/donor/forgot` and `POST /auth/org/forgot` (`{ email }`) email one
and always answer `{ ok: true }`; at most one a minute per account. `POST /collectors/:id/invite` (admin) sends a
collector a fresh one.
