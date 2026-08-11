# Event Curator & Cleanup — Automation Reference

Source of truth: `functions/index.js`, `screens/AdminAICuratorScreen.tsx`. Captured 2026-08-06.

## Data model

Both the "Curations" and "Cleanups" dashboard spaces are the **same** Firestore
collection, `pendingEvents`, distinguished by the `curatedBy` field:

| Dashboard tab | Filter |
|---|---|
| **Curations** | `pendingEvents` where `curatedBy == 'claude'` AND `status == 'pending'` |
| **Cleanups**  | `pendingEvents` where `curatedBy == 'claude_cleanup'` AND `status == 'pending'` |

`status`: `'pending' | 'approved' | 'rejected'`. On admin approval a curated event
is written into the `venues` collection (`type: 'Event'`) and its `pendingEvents`
doc is set to `status: 'approved'`.

### Curation doc fields (`curatedBy: 'claude'`)
`name, venue, date, time, category, description, ticketLink|null, sourceLink|null,
img (https url|null), status:'pending', createdAt (serverTimestamp),
curatedBy:'claude', startDate, expirationDate`.
Category is one of: `Bar, Club, Food, Activity, Event`.
Dedup before insert: skip if `name+date+venue` already in `pendingEvents`, or if
`name+startDate` already in live `venues` (type Event).

### Cleanup doc fields (`curatedBy: 'claude_cleanup'`)
Same display fields plus: `originalId` (the live event's id),
`action: 'KEEP' | 'REMOVE' | 'NEEDS EDIT'`, `updatedEvent | null`.
Each run first deletes all existing pending `claude_cleanup` docs, then re-adds.

## Existing server-side implementation (already deployed)

- `curateEventsWithClaudeCallable` (https.onCall) → runs `curateNairobiEvents()`:
  web search + dedup + write to Curations. **Admin-auth gated** (`isAdmin`).
- `runEventCleanup` (https.onCall): scans live events, Claude classifies
  KEEP/REMOVE/NEEDS EDIT, writes to Cleanups. **Admin-auth gated**.
- `curateEventsWithClaudeScheduled` (pubsub `0 9 1 * *`, tz Africa/Nairobi):
  **commented out / disabled** — "triggered manually by ADMIN via the Admin Dashboard."

## Automation options

1. **Server-side (recommended, single source of truth):** uncomment and re-cadence
   `curateEventsWithClaudeScheduled` to Monday (`0 9 * * 1`), add a parallel
   `runEventCleanupScheduled` pubsub for Wednesday (`0 9 * * 3`), deploy. Reuses
   tested logic + schema; results appear in the dashboard automatically.
2. **Cowork scheduled tasks (`eventas-curator-research` / `-cleanup`):** currently
   ACTIVE. To avoid re-implementing (and diverging from) the curator logic, each
   task just runs a repo script via node:
   - Monday `0 9 * * 1` → `node scripts/runCuratorJob.js`
   - Wednesday `0 9 * * 3` → `node scripts/runCleanupJob.js`

## Chosen setup (2026-08-06) — NO Anthropic API usage

The Cowork task does the model work (web search / verification) with its OWN Claude
resources — it does NOT call the Anthropic API, so it does not spend API credits.
The only scripts run are pure firebase-admin (service key), no API:

- **Monday** `eventas-curator-research`: task web-searches events 7-14 days out →
  writes `/tmp/eventas_curator_events.json` → `node scripts/curatorWriteProposals.js`
  → writes to `pendingEvents` (curatedBy:'claude') → Curations tab.
- **Wednesday** `eventas-curator-cleanup`: `node scripts/fetchLiveEvents.js` →
  task verifies each event itself → writes `/tmp/eventas_cleanup_verdicts.json` →
  `node scripts/cleanupWriteRecommendations.js` → writes to `pendingEvents`
  (curatedBy:'claude_cleanup') → Cleanups tab.

Scripts (all auth via `scripts/serviceAccountKey.json`, project eventa-211fb; NO API):
- `curatorWriteProposals.js` — write-only ingest of an events JSON array (dedup +
  parseDateTime + 7-14 day window).
- `fetchLiveEvents.js` — read-only dump of live events (venues type=='Event').
- `cleanupWriteRecommendations.js` — write-only ingest of {originalId, action,
  updatedEvent} verdicts.
- `runCuratorJob.js` was removed (it called the Anthropic API). The pre-existing
  `runCleanupJob.js` also calls the API and is NOT used by these tasks.

Neither auto-publishes or hard-deletes: approval (Curations) and removal (Cleanups)
stay one-tap admin actions in the Admin AI Curator screen.

### Open risk
- Tasks run in Cowork's sandbox; they need the Eventa_Ant folder connected at run
  time AND outbound network to Firestore (`googleapis.com`). No Anthropic reachability
  is needed (search is done by the task itself). Validate with a manual "Run now"
  before relying on the schedule.
