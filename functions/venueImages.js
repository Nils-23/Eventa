const fetch = require('node-fetch');
const admin = require('firebase-admin');

// Matches Google Places photo URLs we store in googleImageUrl/imageUrl. These
// embed the Maps API key, so every key rotation kills every stored URL at once
// (403) — that is the main failure mode this module heals.
const GOOGLE_PHOTO_URL_RE = /maps\.googleapis\.com\/maps\/api\/place\/photo/;

// A venue Google confirmed has no photos is only re-checked weekly. API
// outages/errors never write this stamp, so they retry on the next run.
const NO_PHOTOS_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;

// How long a URL we have actually seen serve an image is trusted before being
// probed again. See `needsVerify` for why inferring health from the embedded
// key is not enough.
//
// This is a backstop for a photo dying *early* (a place deletes or replaces its
// photo). It deliberately sits well below PHOTO_REFERENCE_MAX_AGE_MS: a probe
// only proves the URL was alive at that instant, so any trust window is time a
// URL can spend dead and unnoticed. Routine expiry is handled by age, not here.
const VERIFY_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

// A photo_reference has its own lifetime, independent of the API key and of
// whether the place still exists. Observed: references issued 2026-07-17 all
// began returning HTTP 400 around 2026-08-16 — roughly 30 days — and did so as
// one cohort, because they had been fetched in one batch.
//
// Probing alone cannot fix this. A probe says "alive right now"; it can't say
// "alive tomorrow", so a reference that dies the day after a probe stays dead
// for the whole trust window. The only stable fix is to rotate references
// *before* Google expires them, so the age of the reference — not its observed
// health — is what triggers a re-fetch. Kept comfortably under the ~30-day
// observed lifetime so a run that fails or is skipped still has slack.
//
// Cost is trivial: one Place Details call per venue per three weeks (~3/day at
// 100 venues), and it replaces probes that were being spent on the same URLs.
const PHOTO_REFERENCE_MAX_AGE_MS = 21 * 24 * 60 * 60 * 1000;

// A photo probe is a billed Places request, so the first run after deploy (when
// nothing carries a verification stamp) is spread over several runs instead of
// probing the whole collection at once. At every-6-hours this drains a ~100
// venue backlog inside a day.
const MAX_VERIFY_PER_RUN = 25;

// Age-based rotation retires URLs in whatever cohorts they were fetched in, so
// one run can legitimately want to refresh the entire collection at once. Cap
// the burst; at every-6-hours this still clears 120 venues a day, and anything
// deferred is picked up by the next run because nothing about it was written.
const MAX_REFRESH_PER_RUN = 30;

const API_DELAY_MS = 300;

function extractEmbeddedKey(url) {
  const m = /[?&]key=([^&]+)/.exec(url || '');
  return m ? decodeURIComponent(m[1]) : null;
}

function buildPhotoUrl(photoReference, apiKey) {
  return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${photoReference}&key=${apiKey}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retriable errors (outage, quota, network) throw; definitive "not found" /
// "no photos" answers return a status so callers can stamp a cooldown.
async function lookupPlacePhoto(venue, apiKey) {
  let placeId = venue.googlePlaceId || null;

  if (!placeId) {
    const query = venue.address ? `${venue.name}, ${venue.address}` : `${venue.name}, Nairobi`;
    let url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(query)}&inputtype=textquery&fields=place_id&key=${apiKey}`;
    if (typeof venue.latitude === 'number' && typeof venue.longitude === 'number') {
      url += `&locationbias=circle:5000@${venue.latitude},${venue.longitude}`;
    }
    const res = await fetch(url);
    const data = await res.json();
    if (data.status === 'ZERO_RESULTS') return { status: 'not_found' };
    if (data.status !== 'OK' || !data.candidates || data.candidates.length === 0) {
      throw new Error(`findplacefromtext failed for "${venue.name}": ${data.status} ${data.error_message || ''}`);
    }
    placeId = data.candidates[0].place_id;
    await sleep(API_DELAY_MS);
  }

  const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=photos&key=${apiKey}`;
  const detailsRes = await fetch(detailsUrl);
  const detailsData = await detailsRes.json();
  if (detailsData.status === 'NOT_FOUND' || detailsData.status === 'INVALID_REQUEST') {
    // A stored placeId can go stale; retry once from a fresh text search.
    if (venue.googlePlaceId) {
      await sleep(API_DELAY_MS);
      return lookupPlacePhoto({ ...venue, googlePlaceId: null }, apiKey);
    }
    return { status: 'not_found' };
  }
  if (detailsData.status !== 'OK' || !detailsData.result) {
    throw new Error(`place details failed for "${venue.name}": ${detailsData.status} ${detailsData.error_message || ''}`);
  }

  const photos = detailsData.result.photos;
  if (!photos || photos.length === 0) return { status: 'no_photos', placeId };
  return { status: 'ok', placeId, photoUrl: buildPhotoUrl(photos[0].photo_reference, apiKey) };
}

function needsRefresh(venue, apiKey, now) {
  // Admin custom image always wins in the app; nothing to refresh.
  if (venue.customImageUrl) return false;
  if (venue.type === 'Event' && venue.img) return false;

  // Events are never refreshed here. A name lookup for "Detox Fridays" attaches
  // some random business's photo, and that applies just as much to an event
  // whose stored Google URL has gone stale: lookupPlacePhoto would re-search by
  // the *event's* name, not the venue's. Refreshing the host venue is what
  // matters — the client resolves an imageless event to whatever its host is
  // showing right now (see buildImageResolver in LiveVenuesContext), so a dead
  // event URL heals as soon as the host's does.
  if (venue.type === 'Event') return false;

  const googleUrl = storedGoogleUrl(venue);
  if (googleUrl) {
    // URL embedding the current key is the one the Places API accepts today.
    if (extractEmbeddedKey(googleUrl) !== apiKey) return true;

    // Key is current, but the photo_reference inside the URL ages out on its
    // own (~30 days). googleImageCheckedAt is stamped in the same write that
    // stores the URL, so it dates the reference. Rotate before it expires
    // rather than waiting for a probe to find it dead.
    //
    // A missing stamp means the URL came from a seed script or admin tooling
    // and its age is unknown — treat it as due, since an unknown-age reference
    // is exactly the kind that turns out to be long expired.
    return now - toMillis(venue.googleImageCheckedAt) >= PHOTO_REFERENCE_MAX_AGE_MS;
  }

  // Google said "no photos for this place" recently — don't burn quota re-asking.
  if (venue.googleImageStatus === 'no_photos' || venue.googleImageStatus === 'not_found') {
    const checkedAt = venue.googleImageCheckedAt && venue.googleImageCheckedAt.toMillis
      ? venue.googleImageCheckedAt.toMillis()
      : 0;
    if (now - checkedAt < NO_PHOTOS_RECHECK_MS) return false;
  }
  return true;
}

function storedGoogleUrl(venue) {
  return [venue.googleImageUrl, venue.imageUrl].find((u) => u && GOOGLE_PHOTO_URL_RE.test(u)) || null;
}

function toMillis(ts) {
  return ts && ts.toMillis ? ts.toMillis() : 0;
}

/**
 * True when a URL that `needsRefresh` considers healthy should still be probed.
 *
 * The key check above is necessary but not sufficient: it only catches the
 * failure mode where a key rotation invalidates every URL at once. A stored URL
 * can embed the *current* key and still be dead, because the `photo_reference`
 * inside it has its own lifetime — Google expires them, and a place that
 * re-uploads or removes its photos invalidates them immediately. Those URLs
 * return 400 forever while looking perfectly healthy to a key comparison, so
 * without an actual probe they are never repaired. That is exactly how the
 * seeded food venues ended up serving 400s for months while the healer reported
 * them "healthy/skipped".
 *
 * Venues written outside this module (seed scripts, admin tooling) carry no
 * stamp at all, so they are probed on the first run that sees them.
 */
function needsVerify(venue, apiKey, now) {
  if (venue.customImageUrl) return false;
  if (venue.type === 'Event') return false;

  const googleUrl = storedGoogleUrl(venue);
  if (!googleUrl) return false;
  if (extractEmbeddedKey(googleUrl) !== apiKey) return false; // needsRefresh owns this

  return now - toMillis(venue.googleImageVerifiedAt) >= VERIFY_INTERVAL_MS;
}

/**
 * Probes a stored photo URL without downloading the image.
 *
 * Returns 'alive' | 'dead' | 'unknown'. Only a definitive client error means
 * dead — a 5xx, a timeout or a network blip is 'unknown' and leaves the venue
 * untouched so a Google outage can never wipe every stored URL in one run.
 */
async function verifyPhotoUrl(url) {
  let res;
  try {
    res = await fetch(url, { method: 'GET', redirect: 'manual', timeout: 10000 });
  } catch (e) {
    return 'unknown';
  }
  // The photo endpoint answers with a redirect to the actual image bytes.
  if (res.status >= 200 && res.status < 400) return 'alive';
  if (res.status === 400 || res.status === 403 || res.status === 404) return 'dead';
  return 'unknown';
}

/**
 * Scan all venues and (re)fetch Google Maps photos where the stored URL is
 * missing, embeds a stale API key, or no longer serves an image.
 *
 * Steady state is a handful of cheap liveness probes per run (each venue is
 * re-probed at most every VERIFY_INTERVAL_MS) and zero Places lookups.
 */
async function refreshVenueImages(db, apiKey, log = console.log) {
  const snap = await db.collection('venues').get();
  const now = Date.now();
  const summary = {
    total: snap.size,
    refreshed: 0,
    noPhotos: 0,
    failed: 0,
    skipped: 0,
    eventUrlsCleared: 0,
    verified: 0,
    verifyDead: 0,
    verifyDeferred: 0,
    expired: 0,
    refreshDeferred: 0,
  };
  let verifiedThisRun = 0;
  let refreshedThisRun = 0;

  for (const doc of snap.docs) {
    const venue = { id: doc.id, ...doc.data() };

    // Events get no Places lookup (see needsRefresh), but one can still be
    // holding a Google photo URL an admin attached, and those die at key
    // rotation. Drop the dead URL — costs no API call, and lets the client fall
    // through to the host venue's live photo instead of rendering a 403.
    //
    // A stale key is not the only way they die: an event URL carries a
    // photo_reference that expires like any other, so a URL embedding the
    // current key can still be dead. Since an event can never be re-fetched,
    // the only repair available is removing the URL so the host venue's photo
    // shows through — which means health has to be observed here too, exactly
    // as it is for places. Probing is budgeted alongside the place probes and
    // stamped, so a healthy event costs one request per VERIFY_INTERVAL_MS.
    if (venue.type === 'Event') {
      const update = {};
      let deadByProbe = false;
      const eventUrl = storedGoogleUrl(venue);

      if (
        eventUrl &&
        extractEmbeddedKey(eventUrl) === apiKey &&
        now - toMillis(venue.googleImageVerifiedAt) >= VERIFY_INTERVAL_MS
      ) {
        if (verifiedThisRun >= MAX_VERIFY_PER_RUN) {
          summary.verifyDeferred++;
          summary.skipped++;
          continue;
        }
        verifiedThisRun++;
        const health = await verifyPhotoUrl(eventUrl);
        await sleep(API_DELAY_MS);

        if (health === 'alive') {
          await doc.ref.update({
            googleImageVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          summary.verified++;
          summary.skipped++;
          continue;
        }
        if (health === 'dead') {
          deadByProbe = true;
          summary.verifyDead++;
        } else {
          // Transient — leave it alone and retry next run.
          summary.skipped++;
          continue;
        }
      }

      for (const field of ['googleImageUrl', 'imageUrl']) {
        const url = venue[field];
        if (url && GOOGLE_PHOTO_URL_RE.test(url) && (deadByProbe || extractEmbeddedKey(url) !== apiKey)) {
          update[field] = admin.firestore.FieldValue.delete();
        }
      }
      if (Object.keys(update).length > 0) {
        await doc.ref.update(update);
        summary.eventUrlsCleared++;
        log(`[VenueImages] 🧹 Cleared stale Google URL on event ${venue.id} (${venue.name})`);
      } else {
        summary.skipped++;
      }
      continue;
    }

    let mustRefresh = needsRefresh(venue, apiKey, now);

    // Distinguish routine age-out from a stale key purely for the log — both
    // take the same path from here.
    if (mustRefresh && storedGoogleUrl(venue) && extractEmbeddedKey(storedGoogleUrl(venue)) === apiKey) {
      summary.expired++;
    }

    // The URL looks healthy by key. Confirm it actually serves an image before
    // trusting it for another VERIFY_INTERVAL_MS — a live 400 is the only way to
    // catch an expired photo_reference.
    if (!mustRefresh && needsVerify(venue, apiKey, now)) {
      if (verifiedThisRun >= MAX_VERIFY_PER_RUN) {
        summary.verifyDeferred++;
        summary.skipped++;
        continue;
      }
      verifiedThisRun++;
      const health = await verifyPhotoUrl(storedGoogleUrl(venue));
      await sleep(API_DELAY_MS);

      if (health === 'alive') {
        await doc.ref.update({
          googleImageVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        summary.verified++;
        summary.skipped++;
        continue;
      }
      if (health === 'dead') {
        summary.verifyDead++;
        log(`[VenueImages] 💀 Stored photo URL dead for ${venue.id} (${venue.name}); re-fetching`);
        mustRefresh = true;
      } else {
        // Transient — leave the venue exactly as it is and retry next run.
        summary.skipped++;
        continue;
      }
    }

    if (!mustRefresh) {
      summary.skipped++;
      continue;
    }

    // Over budget for this run. Nothing is written, so needsRefresh reaches the
    // same verdict next run and the backlog drains in order.
    if (refreshedThisRun >= MAX_REFRESH_PER_RUN) {
      summary.refreshDeferred++;
      summary.skipped++;
      continue;
    }
    refreshedThisRun++;

    try {
      const found = await lookupPlacePhoto(venue, apiKey);
      const update = { googleImageCheckedAt: admin.firestore.FieldValue.serverTimestamp() };
      if (found.placeId) update.googlePlaceId = found.placeId;

      if (found.status === 'ok') {
        update.googleImageStatus = 'ok';
        update.googleImageUrl = found.photoUrl;
        // Straight from the Places API, so it is verified by construction — no
        // need to spend a probe on it until the next interval comes round.
        update.googleImageVerifiedAt = admin.firestore.FieldValue.serverTimestamp();
        // Legacy venues carry the Google URL in imageUrl; keep it in sync so no
        // dead key-rotated URL survives as a "fallback".
        if (venue.imageUrl && GOOGLE_PHOTO_URL_RE.test(venue.imageUrl)) {
          update.imageUrl = found.photoUrl;
        }
        summary.refreshed++;
        log(`[VenueImages] ✅ Refreshed ${venue.id} (${venue.name})`);
      } else {
        update.googleImageStatus = found.status;
        // Drop dead Google URLs so the client falls back cleanly instead of
        // rendering a 403.
        if (venue.googleImageUrl && GOOGLE_PHOTO_URL_RE.test(venue.googleImageUrl)) {
          update.googleImageUrl = admin.firestore.FieldValue.delete();
        }
        if (venue.imageUrl && GOOGLE_PHOTO_URL_RE.test(venue.imageUrl)) {
          update.imageUrl = admin.firestore.FieldValue.delete();
        }
        summary.noPhotos++;
        log(`[VenueImages] ⚠️ ${found.status} for ${venue.id} (${venue.name}); re-check in 7 days`);
      }
      await doc.ref.update(update);
    } catch (err) {
      // Outage / quota / network: write nothing so the next run retries.
      summary.failed++;
      log(`[VenueImages] ❌ ${venue.id} (${venue.name}): ${err.message}`);
    }
    await sleep(API_DELAY_MS);
  }

  log(
    `[VenueImages] Done: ${summary.refreshed} refreshed ` +
    `(${summary.expired} due to reference age), ${summary.noPhotos} without photos, ` +
    `${summary.failed} failed, ${summary.eventUrlsCleared} stale event URLs cleared, ` +
    `${summary.verified} verified alive, ${summary.verifyDead} found dead, ` +
    `${summary.verifyDeferred} verifications and ${summary.refreshDeferred} refreshes ` +
    `deferred to next run, ${summary.skipped} healthy/skipped of ${summary.total}.`
  );
  return summary;
}

module.exports = {
  refreshVenueImages,
  needsRefresh,
  needsVerify,
  verifyPhotoUrl,
  storedGoogleUrl,
  GOOGLE_PHOTO_URL_RE,
  VERIFY_INTERVAL_MS,
  MAX_VERIFY_PER_RUN,
  PHOTO_REFERENCE_MAX_AGE_MS,
  MAX_REFRESH_PER_RUN,
};
