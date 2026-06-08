const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// Replication of filtering logic from LiveVenuesContext.tsx
function computeLiveDataSimulated(venues, mockNow) {
  const liveVenues = [];
  const scheduledVenues = [];
  let expiredCount = 0;

  for (const venue of venues) {
    if (!venue.latitude || !venue.longitude) continue;
    if (venue.hidden === true) continue;

    // Filter out expired venues
    if (venue.expirationDate && venue.expirationDate < mockNow) {
      expiredCount++;
      continue;
    }

    // Filter out future scheduled events/activities that haven't started yet
    if ((venue.type === 'Activity' || venue.type === 'Event') && venue.startDate && venue.startDate > mockNow) {
      scheduledVenues.push(venue);
      continue;
    }

    liveVenues.push(venue);
  }

  return { liveVenues, scheduledVenues, expiredCount };
}

async function runTest() {
  const venuesSnap = await db.collection('venues').get();
  const allVenues = [];
  venuesSnap.forEach(d => {
    allVenues.push({ id: d.id, ...d.data() });
  });

  const testDates = [
    { name: 'June 1, 2026', time: new Date('2026-06-01T12:00:00+03:00').getTime() },
    { name: 'June 8, 2026 (Today)', time: new Date('2026-06-08T12:00:00+03:00').getTime() },
    { name: 'June 18, 2026 (Nairobi Tech Summit)', time: new Date('2026-06-18T12:00:00+03:00').getTime() },
    { name: 'July 4, 2026 (Millennials Cookout / Art Exhibition End)', time: new Date('2026-07-04T15:00:00+03:00').getTime() },
    { name: 'August 1, 2026 (After all events)', time: new Date('2026-08-01T12:00:00+03:00').getTime() },
  ];

  console.log('=== DATE FILTERING SIMULATION TESTS ===\n');

  for (const dateInfo of testDates) {
    const { liveVenues, scheduledVenues, expiredCount } = computeLiveDataSimulated(allVenues, dateInfo.time);
    
    console.log(`📅 Mock Date: ${dateInfo.name}`);
    console.log(`- Active / Live Venues & Events: ${liveVenues.length}`);
    console.log(`- Future Scheduled Events / Activities: ${scheduledVenues.length}`);
    console.log(`- Expired / Past (Hidden): ${expiredCount}`);

    // Print active events
    const activeEvents = liveVenues.filter(v => v.type === 'Event');
    console.log(`- Active Events (${activeEvents.length}):`);
    activeEvents.forEach(e => {
      console.log(`  * ${e.name} (Ends: ${new Date(e.expirationDate).toLocaleDateString()})`);
    });

    console.log('--------------------------------------------------\n');
  }

  process.exit(0);
}

runTest().catch(console.error);
