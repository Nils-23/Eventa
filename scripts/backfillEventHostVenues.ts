/**
 * backfillEventHostVenues.ts — link already-approved events to their host venue
 * and strip the placeholders that were baked into their venue docs.
 *
 * Events approved before the host-venue fallback landed carry three problems:
 *   1. no `hostVenueId`, so the client has to re-derive the host every session;
 *   2. no `category`, so it cannot pick a category-appropriate fallback;
 *   3. an `imageUrl` holding a stock category photo, written at approval time,
 *      which is indistinguishable from a real image by shape.
 *
 * The client tolerates all three (it detects known placeholder URLs and matches
 * the host by name at runtime), but legacy docs store the *host's street
 * address* in `address` rather than its name, so name matching alone often
 * misses. Coordinates are the reliable signal: approval copies the host venue's
 * exact lat/lng onto the event, so a venue within a few metres is the host.
 *
 * Usage:
 *   npx tsx scripts/backfillEventHostVenues.ts          # dry run, prints a plan
 *   npx tsx scripts/backfillEventHostVenues.ts --apply  # writes
 */
import fs from 'fs';
import path from 'path';
import admin from 'firebase-admin';
import { findHostVenue, venueNameScore } from '../utils/venueMatching';
import { isPlaceholderImage } from '../utils/venueImageUtils';

// Run from the repo root (see usage above) — the package is CommonJS, so this
// stays portable whether tsx loads the file as CJS or ESM.
const serviceAccount = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), 'scripts/serviceAccountKey.json'), 'utf8')
);

const APPLY = process.argv.includes('--apply');

// Approval copies the host's coordinates verbatim, so a true inherited match is
// 0m; anything further came from the curator's own geocode and is only evidence
// of proximity. 40m keeps same-building/compound hits and drops the 70m-ish ones
// that could just as easily be the bar next door — an event with no host falls
// back to a varied pooled image, which is a far better failure than showing
// another business's storefront under its name.
const SAME_PLACE_METERS = 40;

if (admin.apps.length === 0) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface Doc {
  id: string;
  name?: string;
  type?: string;
  venue?: string;
  address?: string;
  category?: string;
  latitude?: number;
  longitude?: number;
  imageUrl?: string;
  img?: string;
  customImageUrl?: string;
  googleImageUrl?: string;
  hostVenueId?: string;
  [k: string]: any;
}

// Approval falls back to Nairobi CBD when it cannot match a venue, so every
// unmatched event piles up on this exact point. Coordinate matching there would
// link them all to whichever venue happens to sit nearby — the opposite of what
// this backfill is for.
const CBD_DEFAULT = { latitude: -1.286389, longitude: 36.817223 };

function isDefaultCoordinate(event: Doc): boolean {
  return (
    typeof event.latitude === 'number' &&
    typeof event.longitude === 'number' &&
    haversineMeters(event.latitude, event.longitude, CBD_DEFAULT.latitude, CBD_DEFAULT.longitude) < 1
  );
}

/** Nearest place venue within SAME_PLACE_METERS, or null, with its distance. */
function nearestPlace(event: Doc, places: Doc[]): { venue: Doc; meters: number } | null {
  if (typeof event.latitude !== 'number' || typeof event.longitude !== 'number') return null;
  if (isDefaultCoordinate(event)) return null;
  let best: Doc | null = null;
  let bestDist = Infinity;
  for (const p of places) {
    if (typeof p.latitude !== 'number' || typeof p.longitude !== 'number') continue;
    const d = haversineMeters(event.latitude, event.longitude, p.latitude, p.longitude);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best && bestDist <= SAME_PLACE_METERS ? { venue: best, meters: bestDist } : null;
}

async function main() {
  const snap = await db.collection('venues').get();
  const all: Doc[] = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
  const events = all.filter((v) => v.type === 'Event');
  const places = all.filter((v) => v.type !== 'Event');

  // Curator categories live on pendingEvents, not on the published venue doc.
  const pending = await db.collection('pendingEvents').get();
  const categoryByName = new Map<string, string>();
  pending.docs.forEach((d: any) => {
    const p = d.data();
    if (p.name && p.category) categoryByName.set(String(p.name).toLowerCase().trim(), p.category);
  });

  const plan: Array<{ id: string; name: string; changes: Record<string, any>; note: string }> = [];
  const stats = { linkedByName: 0, linkedByCoords: 0, unlinked: 0, placeholdersCleared: 0, categorySet: 0 };

  for (const event of events) {
    const changes: Record<string, any> = {};
    let note = '';

    // ── Host venue ───────────────────────────────────────────────────────────
    if (!event.hostVenueId) {
      // Only ever match on a string that names a *venue*. Legacy docs predate
      // the `venue` field, so `address` is the only candidate — comparing the
      // event's own name against venue names is a category error and produced
      // matches like "Nairobi Street Food Festival" → "Nairobi Street Kitchen"
      // on the shared word "street" alone.
      const venueString = event.venue || event.address;
      let host = findHostVenue(venueString, places);
      if (host) {
        stats.linkedByName++;
        note = `name "${venueString}" → ${host.name}`;
      } else {
        const near = nearestPlace(event, places);
        if (near) {
          host = near.venue;
          stats.linkedByCoords++;
          const score = venueString ? venueNameScore(venueString, host.name || '') : 0;
          note = `coords→${host.name} (${near.meters.toFixed(0)}m, name score ${score})`;
        } else if (isDefaultCoordinate(event)) {
          note = 'at CBD default coordinate — not coordinate-matched';
        }
      }
      if (host) {
        changes.hostVenueId = host.id;
        // Keep the curated host name so runtime matching has something to work
        // with even if coordinates later drift.
        if (!event.venue && host.name) changes.venue = host.name;
      } else {
        stats.unlinked++;
        note = 'no host venue — will use a pooled fallback';
      }
    } else {
      note = 'already linked';
    }

    // ── Category ─────────────────────────────────────────────────────────────
    if (!event.category) {
      const fromPending = categoryByName.get(String(event.name || '').toLowerCase().trim());
      const category = fromPending || 'Event';
      changes.category = category;
      stats.categorySet++;
    }

    // ── Baked placeholder ────────────────────────────────────────────────────
    if (isPlaceholderImage(event.imageUrl)) {
      changes.imageUrl = admin.firestore.FieldValue.delete();
      stats.placeholdersCleared++;
      note += ' | cleared baked placeholder';
    }

    if (Object.keys(changes).length > 0) {
      plan.push({ id: event.id, name: event.name || '(unnamed)', changes, note });
    }
  }

  console.log(`\n${events.length} events, ${places.length} places.\n`);
  for (const p of plan) {
    const fields = Object.keys(p.changes)
      .map((k) => (k === 'imageUrl' ? 'imageUrl:DELETE' : `${k}=${p.changes[k]}`))
      .join(', ');
    console.log(`  ${p.name.slice(0, 42).padEnd(44)} ${fields}`);
    console.log(`  ${''.padEnd(44)} ${p.note}`);
  }

  console.log(
    `\nlinked by name: ${stats.linkedByName}, by coords: ${stats.linkedByCoords}, ` +
      `unlinked: ${stats.unlinked}, categories set: ${stats.categorySet}, ` +
      `placeholders cleared: ${stats.placeholdersCleared}`
  );
  console.log(`${plan.length} of ${events.length} events would change.`);

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply to write.');
    process.exit(0);
  }

  let written = 0;
  for (const p of plan) {
    await db.collection('venues').doc(p.id).update(p.changes);
    written++;
  }
  console.log(`\n✅ Updated ${written} event docs.`);
  process.exit(0);
}

main().catch((e) => {
  console.error('❌ backfill failed:', e);
  process.exit(1);
});
