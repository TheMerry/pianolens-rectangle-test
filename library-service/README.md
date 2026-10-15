# PianoLens private MIDI library service

## Free hosting plan

Keep the existing Render static player at https://pianolens-standalone.onrender.com/.
Run this small Node 24 API on a **Free Render Web Service**, with **no Render disk**.
Store library metadata, hashed access keys and MIDI bytes in **Neon Free PostgreSQL**.
No live phone connection is required during glasses playback.

The user explicitly declined paid Render storage. Do not add a paid instance,
disk or database. As checked on 15 October 2026, Neon's published Free plan has
1 GB/project, 100 CU-hours/month and no credit card requirement:
https://neon.com/pricing . Retain the Free plan; quotas can interrupt service.
Free Render sleeps when idle; first access may take about a minute to wake.
Neon also suspends idle compute and wakes on demand. Neither affects already
loaded local playback. Original MIDI files remain the user's backup.

## Deployment

The live API is https://pianolens-midi-library.onrender.com/ and the upload page
is https://pianolens-standalone.onrender.com/upload.html . The dedicated Neon Free
project is `plain-tree-69145092` (Frankfurt); Free Render service is
`srv-db8h7gijnfac73fp23pg`. Reuse these resources; do not create duplicate services.
Server-only secrets are configured in Render. No paid instance or disk is used.
The following steps describe reproducible setup, not additional services to create.

1. Sign in to Neon, create a dedicated Free project (Frankfurt/EU where available),
   and obtain its TLS PostgreSQL connection URL. No upgrade or billing details.
2. Create a Render **Free** Web Service from the existing source repository,
   root directory `library-service`, Node 24. A template is in `render.yaml`.
   Build: `npm ci --include=dev && npm test && npm prune --omit=dev`.
   Start: `npm start`. Health: `/health`. No disk.
3. Configure server-only secret `DATABASE_URL` with the Neon connection string
   (including `sslmode=require`) and `PIANOLENS_CREATE_KEY` with a random 32-byte
   hex setup key. Do not put either secret in frontend code or Git.
   Optional `PIANOLENS_ORIGINS` is an exact comma-separated origin allowlist;
   default is `https://pianolens-standalone.onrender.com`.
4. Build the static player with `PIANOLENS_LIBRARY_API` set to the deployed
   HTTPS API origin, then publish those assets to the existing static service.
5. Open `/upload.html#setup=<private setup key>` once to create a library.
   Keep the generated owner/recovery link private. Save its separate read-only
   player link as the Meta Web App URL. The fragment is stripped on import and
   never sent as an HTTP URL. There are no cloud database credentials in it.
6. Upload a self-authored scale, verify download and playback, restart the API,
   and confirm the same library/file remain. Repeat on actual glasses.

Neon is accessed through its official `@neondatabase/serverless` HTTPS driver,
with parameterized SQL, bounded request deadlines and transaction locks around
mutations/quotas. There are no periodic database health polls keeping compute
awake. Startup creates only the two namespaced tables if absent. No destructive
migrations or automatic retry loops.

## Local build and tests

From PianoLens root: `node scripts/build-library-service.mjs` exports source to
`build/rectangle-render-source/library-service` (no credentials or song library).
In this folder: `npm ci --ignore-scripts`, then `npm test`.

The original SQLite adapter remains for local development and regression tests.
`PIANOLENS_DATA_DIR` must be explicit when used; it must never be described as
durable on a free Render instance. Hosted storage uses `DATABASE_URL` instead.

Fourteen backend tests pass: eight HTTP/SQLite regression tests and six new
PostgreSQL tests. PostgreSQL SQL executes in PGlite (real PostgreSQL compiled to
WASM, development dependency only). Tests cover byte-perfect download,
durability across local database restart, parameterized titles, hashed access,
permissions, deduplication, quotas, MIDI validation, concurrency and TLS config.
These automated tests verify SQL/API behavior locally, not distributed lock
contention or physical-glasses acceptance. The deployed API has additionally
passed a real hosted-Neon scale upload/readback and access-control checks. Live
browser playback completed with the uploader closed. Cloud restart acceptance is
recorded separately in the main project's `validation/library-cloud-*.json`.
Physical-glasses library and offline-storage acceptance remain outstanding.

## Data handling and limits

Only hashed read/write keys are stored. Read-only glasses links cannot upload.
API uses Authorization headers, exact CORS, no-store responses and no cookies;
neither names, MIDI contents nor credentials are logged. Files remain private
to possession of the library's access links. There is no account/email/mic data.
Browser IndexedDB caches selected songs where supported; the static service
worker excludes API responses. Offline persistence on actual glasses still
requires testing.

Limits: standard MIDI 0/1 with PPQ, 5 MB, 20,000 notes, 24 hours per song;
50 songs / 50 MB per library; 32 libraries / 250 MB total. Validation runs in
at most two 64 MB worker threads, with a three-second deadline. Duplicate content
deduplicates. No deletion UI or independent cloud backup in this milestone.

MIDI parser retains midi-file's MIT attribution. The Neon driver is Apache-2.0;
PGlite is Apache-2.0 and only used for tests. Native Android and hybrid fallback
remain unchanged.
