const fetch = require('node-fetch');
const admin = require('firebase-admin');

// Matches Google Places photo URLs we store in googleImageUrl/imageUrl. These
// embed the Maps API key, so every key rotation kills every stored URL at once
// (403) — that is the main failure mode this module heals.
const GOOGLE_PHOTO_URL_RE = /maps\.googleapis\.com\/maps\/api\/place\/photo/;

// A venue Google confirmed has no photos is only re-checked weekly. API
// outages/errors never write this stamp, so they retry on the next run.
const NO_PHOTOS_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;

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

  const googleUrl = [venue.googleImageUrl, venue.imageUrl].find((u) => u && GOOGLE_PHOTO_URL_RE.test(u));
  if (googleUrl) {
    // URL embedding the current key is the one the Places API accepts today.
    return extractEmbeddedKey(googleUrl) !== apiKey;
  }

  // Events without a Google image never had one (posters/flyers, not places);
  // a name lookup would attach some random venue's photo.
  if (venue.type === 'Event') return false;

  // Google said "no photos for this place" recently — don't burn quota re-asking.
  if (venue.googleImageStatus === 'no_photos' || venue.googleImageStatus === 'not_found') {
    const checkedAt = venue.googleImageCheckedAt && venue.googleImageCheckedAt.toMillis
      ? venue.googleImageCheckedAt.toMillis()
      : 0;
    if (now - checkedAt < NO_PHOTOS_RECHECK_MS) return false;
  }
  return true;
}

/**
 * Scan all venues and (re)fetch Google Maps photos where the stored URL is
 * missing or embeds a stale API key. Zero API calls in the steady state.
 */
async function refreshVenueImages(db, apiKey, log = console.log) {
  const snap = await db.collection('venues').get();
  const now = Date.now();
  const summary = { total: snap.size, refreshed: 0, noPhotos: 0, failed: 0, skipped: 0 };

  for (const doc of snap.docs) {
    const venue = { id: doc.id, ...doc.data() };
    if (!needsRefresh(venue, apiKey, now)) {
      summary.skipped++;
      continue;
    }

    try {
      const found = await lookupPlacePhoto(venue, apiKey);
      const update = { googleImageCheckedAt: admin.firestore.FieldValue.serverTimestamp() };
      if (found.placeId) update.googlePlaceId = found.placeId;

      if (found.status === 'ok') {
        update.googleImageStatus = 'ok';
        update.googleImageUrl = found.photoUrl;
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

  log(`[VenueImages] Done: ${summary.refreshed} refreshed, ${summary.noPhotos} without photos, ${summary.failed} failed, ${summary.skipped} healthy/skipped of ${summary.total}.`);
  return summary;
}

module.exports = { refreshVenueImages, needsRefresh, GOOGLE_PHOTO_URL_RE };
