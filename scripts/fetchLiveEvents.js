/**
 * fetchLiveEvents.js  (NO Anthropic API — read only)
 * Prints all live events (venues where type == 'Event') as a JSON array to stdout,
 * so the Cowork cleanup task can verify each one with its own web search.
 *
 * Usage:  node scripts/fetchLiveEvents.js
 * Output: [{ id, name, description, venue, date (DD/MM/YYYY), time, category, ticketLink, sourceLink }]
 */

const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

if (admin.apps.length === 0) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

async function main() {
  const snap = await db.collection('venues').where('type', '==', 'Event').get();
  const out = [];
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
    out.push({
      id: doc.id,
      name: v.name || '',
      description: v.description || '',
      venue: v.address || '',
      date, time,
      category: v.category || 'Other',
      ticketLink: v.ticketLink || null,
      sourceLink: v.sourceLink || null,
    });
  });
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error('❌ fetch failed:', e); process.exit(1); });
