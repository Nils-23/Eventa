/**
 * curatorWriteProposals.js  (NO Anthropic API — write only)
 * Ingests an events JSON array (produced by the Cowork task's own web search)
 * and writes them to Firestore `pendingEvents` as pending Curations proposals.
 *
 * Usage:  node scripts/curatorWriteProposals.js <path-to-events.json>
 *
 * Each event object must have:
 *   name, venue, date (DD/MM/YYYY), time, category (Club|Bar|Event),
 *   description, ticketLink (url|null), sourceLink (url), img (url|null)
 *
 * Applies the same dedup + date logic as the deployed curator, then writes with
 * curatedBy:'claude', status:'pending'. Prints a JSON summary. Approval stays in
 * the Admin dashboard Curations tab.
 *
 * IMAGE RE-HOSTING:
 *   For each event that passes the dedup/date checks, if it has an `img` URL the
 *   script downloads that poster and re-uploads it to Firebase Storage under
 *   curator/pending/, then stores a stable Firebase download URL in `img`. This
 *   captures organizer posters (incl. expiring Instagram/Facebook CDN links) at
 *   write time so the app never renders a broken image later.
 *   Best-effort: on any download/upload failure it falls back to the original
 *   `img` URL (never worse than before). Disable with env CURATOR_REHOST=0.
 */

const fs = require('fs');
const crypto = require('crypto');
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

const STORAGE_BUCKET = 'eventa-211fb.firebasestorage.app';
const REHOST_ENABLED = process.env.CURATOR_REHOST !== '0';

if (admin.apps.length === 0) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: STORAGE_BUCKET,
  });
}
const db = admin.firestore();
const bucket = admin.storage().bucket();

function nairobiTodayStartMs() {
  const now = new Date();
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Nairobi', year: 'numeric', month: 'numeric', day: 'numeric' });
  const m = {};
  f.formatToParts(now).forEach((p) => { m[p.type] = p.value; });
  return new Date(Date.UTC(+m.year, +m.month - 1, +m.day, 0, 0, 0) - (3 * 60 * 60 * 1000)).getTime();
}
function eventDateStartMs(dateStr) {
  const p = String(dateStr).split('/');
  if (p.length !== 3) return NaN;
  const [d, mo, y] = [parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10)];
  if (isNaN(d) || isNaN(mo) || isNaN(y)) return NaN;
  return new Date(Date.UTC(y, mo, d, 0, 0, 0) - (3 * 60 * 60 * 1000)).getTime();
}
function isPastEvent(dateStr) {
  const t = eventDateStartMs(dateStr);
  return isNaN(t) ? true : t < nairobiTodayStartMs();
}
function isWithinWindow(dateStr, minDays = 7, maxDays = 14) {
  const t = eventDateStartMs(dateStr);
  if (isNaN(t)) return false;
  const diff = Math.round((t - nairobiTodayStartMs()) / (24 * 60 * 60 * 1000));
  return diff >= minDays && diff <= maxDays;
}
function parseDateTime(dateStr, timeStr) {
  const parts = dateStr.split('/');
  if (parts.length !== 3) throw new Error(`Invalid date: ${dateStr}`);
  const day = parseInt(parts[0], 10), month = parseInt(parts[1], 10) - 1, year = parseInt(parts[2], 10);
  let hour = 18, minute = 0;
  const tm = timeStr && timeStr.match(/(\d+):(\d+)\s*(pm|am)?/i);
  if (tm) {
    hour = parseInt(tm[1], 10); minute = parseInt(tm[2], 10);
    if (tm[3]) { if (/pm/i.test(tm[3]) && hour < 12) hour += 12; if (/am/i.test(tm[3]) && hour === 12) hour = 0; }
  }
  const pad = (n) => String(n).padStart(2, '0');
  const startDate = new Date(`${year}-${pad(month + 1)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00+03:00`).getTime();
  return { startDate, expirationDate: startDate + 6 * 60 * 60 * 1000 };
}

function slugify(s) {
  return String(s || 'event').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'event';
}
function extFromContentType(ct) {
  const t = String(ct || '').toLowerCase();
  if (t.includes('png')) return 'png';
  if (t.includes('webp')) return 'webp';
  if (t.includes('gif')) return 'gif';
  if (t.includes('svg')) return 'svg';
  return 'jpg';
}

/**
 * Download `srcUrl` and re-upload to Firebase Storage; return a stable Firebase
 * download URL. Returns null on any failure so the caller can fall back.
 */
async function rehostImage(srcUrl, eventName) {
  if (!REHOST_ENABLED) return null;
  if (typeof srcUrl !== 'string' || !/^https?:\/\//i.test(srcUrl)) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(srcUrl, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        // Some organizer/social CDNs reject requests without a browser-like UA/Referer.
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
    });
    if (!res.ok) { console.warn(`   ↳ image fetch ${res.status} for ${eventName}`); return null; }

    const ct = res.headers.get('content-type') || '';
    if (!/^image\//i.test(ct)) { console.warn(`   ↳ non-image content-type (${ct}) for ${eventName}`); return null; }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) { console.warn(`   ↳ empty image for ${eventName}`); return null; }
    if (buf.length > 15 * 1024 * 1024) { console.warn(`   ↳ image too large (${buf.length}b) for ${eventName}`); return null; }

    const ext = extFromContentType(ct);
    const hash = crypto.createHash('md5').update(srcUrl).digest('hex').slice(0, 8);
    const objectPath = `curator/pending/${slugify(eventName)}-${hash}.${ext}`;
    const token = crypto.randomUUID();

    await bucket.file(objectPath).save(buf, {
      resumable: false,
      contentType: ct,
      metadata: { metadata: { firebaseStorageDownloadTokens: token } },
    });

    const encoded = encodeURIComponent(objectPath);
    return `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encoded}?alt=media&token=${token}`;
  } catch (e) {
    console.warn(`   ↳ rehost failed for ${eventName}: ${e.message}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const file = process.argv[2];
  if (!file) { console.error('Usage: node scripts/curatorWriteProposals.js <events.json>'); process.exit(1); }
  const events = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(events)) { console.error('Input must be a JSON array of events.'); process.exit(1); }

  let added = 0, skipped = 0, rehosted = 0;
  for (const event of events) {
    if (!event.date || isPastEvent(event.date)) { skipped++; continue; }
    if (!isWithinWindow(event.date)) { skipped++; continue; }

    const pendingSnap = await db.collection('pendingEvents')
      .where('name', '==', event.name || '').where('date', '==', event.date || '').where('venue', '==', event.venue || '').get();
    if (!pendingSnap.empty) { skipped++; continue; }

    let startDate = null, expirationDate = null, liveDup = false;
    try {
      ({ startDate, expirationDate } = parseDateTime(event.date, event.time || '18:00'));
      const liveSnap = await db.collection('venues')
        .where('type', '==', 'Event').where('name', '==', event.name || '').where('startDate', '==', startDate).get();
      if (!liveSnap.empty) liveDup = true;
    } catch (e) { console.warn(`parse error for ${event.name}: ${e.message}`); }
    if (liveDup) { skipped++; continue; }

    // Resolve image: re-host to Firebase Storage; fall back to the source URL.
    const srcImg = (typeof event.img === 'string' && /^https?:\/\//i.test(event.img)) ? event.img.trim() : null;
    let imgUrl = srcImg;
    if (srcImg) {
      const hosted = await rehostImage(srcImg, event.name || 'event');
      if (hosted) { imgUrl = hosted; rehosted++; }
    }

    await db.collection('pendingEvents').add({
      name: event.name || '',
      venue: event.venue || '',
      date: event.date || '',
      time: event.time || '',
      category: event.category || 'Event',
      description: event.description || '',
      ticketLink: event.ticketLink || null,
      sourceLink: event.sourceLink || null,
      img: imgUrl,
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      curatedBy: 'claude',
      startDate, expirationDate,
    });
    added++;
    console.log(`✅ queued: ${event.name} (${event.date})${imgUrl && imgUrl !== srcImg ? ' [poster re-hosted]' : ''}`);
  }
  console.log(JSON.stringify({ added, skipped, rehosted }));
  process.exit(0);
}
main().catch((e) => { console.error('❌ write failed:', e); process.exit(1); });
