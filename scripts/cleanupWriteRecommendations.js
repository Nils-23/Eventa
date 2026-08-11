/**
 * cleanupWriteRecommendations.js  (NO Anthropic API — write only)
 * Takes the Cowork task's cancellation verdicts and writes them to Firestore
 * `pendingEvents` as pending Cleanups recommendations for admin confirmation.
 *
 * Usage:  node scripts/cleanupWriteRecommendations.js <path-to-verdicts.json>
 *
 * Each verdict object: { originalId, action ('KEEP'|'REMOVE'|'NEEDS EDIT'), updatedEvent (obj|null) }
 * Mirrors the deployed runEventCleanup writer: first clears existing pending
 * claude_cleanup docs, then re-adds. Live events are NOT deleted here — the admin
 * confirms removal in the Cleanups tab.
 */

const fs = require('fs');
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

if (admin.apps.length === 0) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

function parseDateTime(dateStr, timeStr) {
  if (!dateStr) return { startDate: null, expirationDate: null };
  const parts = dateStr.split('/');
  if (parts.length !== 3) return { startDate: null, expirationDate: null };
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

async function liveEventsById() {
  const snap = await db.collection('venues').where('type', '==', 'Event').get();
  const map = {};
  snap.forEach((doc) => {
    const v = doc.data();
    let date = '', time = '';
    if (v.startDate) {
      const d = new Date(v.startDate);
      const o = { timeZone: 'Africa/Nairobi' };
      const g = (opt) => new Intl.DateTimeFormat('en-GB', { ...o, ...opt }).format(d);
      date = `${g({ day: '2-digit' })}/${g({ month: '2-digit' })}/${g({ year: 'numeric' })}`;
      time = `${g({ hour: '2-digit', hour12: false })}:${g({ minute: '2-digit' })}`;
    }
    map[doc.id] = {
      name: v.name || '', venue: v.address || '', date, time,
      category: v.category || 'Event', description: v.description || '',
      ticketLink: v.ticketLink || null, sourceLink: v.sourceLink || null,
    };
  });
  return map;
}

async function main() {
  const file = process.argv[2];
  if (!file) { console.error('Usage: node scripts/cleanupWriteRecommendations.js <verdicts.json>'); process.exit(1); }
  const verdicts = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(verdicts)) { console.error('Input must be a JSON array.'); process.exit(1); }

  const liveMap = await liveEventsById();

  // Clear existing pending claude_cleanup docs (same as runEventCleanup).
  const existing = await db.collection('pendingEvents')
    .where('curatedBy', '==', 'claude_cleanup').where('status', '==', 'pending').get();
  const batch = db.batch();
  existing.forEach((d) => batch.delete(d.ref));
  await batch.commit();

  const counts = { KEEP: 0, REMOVE: 0, 'NEEDS EDIT': 0, added: 0 };
  for (const item of verdicts) {
    const orig = liveMap[item.originalId];
    if (!orig) continue;
    const display = (item.action === 'NEEDS EDIT' && item.updatedEvent) ? item.updatedEvent : orig;
    const { startDate, expirationDate } = parseDateTime(display.date || orig.date, display.time || orig.time || '18:00');

    await db.collection('pendingEvents').add({
      name: display.name || orig.name || '',
      venue: display.venue || orig.venue || '',
      date: display.date || orig.date || '',
      time: display.time || orig.time || '',
      category: display.category || orig.category || 'Event',
      description: display.description || orig.description || '',
      ticketLink: display.ticketLink || orig.ticketLink || null,
      sourceLink: display.sourceLink || orig.sourceLink || null,
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      curatedBy: 'claude_cleanup',
      originalId: item.originalId,
      action: item.action || 'KEEP',
      updatedEvent: item.updatedEvent || null,
      startDate, expirationDate,
    });
    counts[item.action] = (counts[item.action] || 0) + 1;
    counts.added++;
  }
  console.log(JSON.stringify(counts));
  process.exit(0);
}
main().catch((e) => { console.error('❌ write failed:', e); process.exit(1); });
