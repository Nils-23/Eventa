const admin = require('firebase-admin');
const assert = require('assert');

// 1. Initialize admin SDK to communicate with local emulators
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_DATABASE_EMULATOR_HOST = "127.0.0.1:9000";
process.env.FIREBASE_CONFIG = JSON.stringify({
  databaseURL: "https://eventa-211fb-default-rtdb.firebaseio.com",
  projectId: "eventa-211fb"
});

if (admin.apps.length === 0) {
  admin.initializeApp({
    projectId: 'eventa-211fb',
    databaseURL: 'https://eventa-211fb-default-rtdb.firebaseio.com'
  });
}

const db = admin.firestore();
const rtdb = admin.database();

// Mock Date.now() to control simulation time
let mockTimeMs = Date.now();
const originalDateNow = Date.now;
Date.now = () => mockTimeMs;

const f = require('../functions/index');

function getRolloverEATDate(nowMs = Date.now()) {
  const format = (options) => new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Nairobi', ...options }).format(nowMs);
  
  const yearStr = format({ year: 'numeric' });
  const monthStr = format({ month: 'numeric' });
  const dayStr = format({ day: 'numeric' });
  const hourStr = format({ hour: 'numeric', hour12: false });
  
  let year = parseInt(yearStr, 10);
  let month = parseInt(monthStr, 10);
  let day = parseInt(dayStr, 10);
  let hour = parseInt(hourStr, 10);
  if (hour === 24) hour = 0;
  
  if (hour < 5) {
    const d = new Date(nowMs - 24 * 60 * 60 * 1000);
    const prevFormat = (options) => new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Nairobi', ...options }).format(d);
    return {
      year: parseInt(prevFormat({ year: 'numeric' }), 10),
      month: parseInt(prevFormat({ month: 'numeric' }), 10),
      day: parseInt(prevFormat({ day: 'numeric' }), 10),
      weekday: prevFormat({ weekday: 'short' }),
      hour: hour
    };
  }
  
  return {
    year,
    month,
    day,
    weekday: format({ weekday: 'short' }),
    hour
  };
}

async function cleanDatabases() {
  console.log("Cleaning Database & Cooldowns...");
  await rtdb.ref('venue_chats').remove();
  const cooldownsSnap = await db.collection('persona_cooldowns').get();
  const batch = db.batch();
  cooldownsSnap.docs.forEach(doc => batch.delete(doc.ref));
  await batch.commit();
}

async function runTest() {
  console.log("\n=================== STARTING PERSONA CAPS & ROLLOVER TESTS ===================");

  // ---------------------------------------------------------------------------
  // SCENARIO 1: Peak Night (Friday 23:00 EAT)
  // ---------------------------------------------------------------------------
  console.log("\n--- SCENARIO 1: Friday 23:00 EAT (Peak Night) ---");
  await cleanDatabases();
  
  // Friday June 26, 2026 at 23:00 EAT (UTC+3) -> 20:00 UTC
  mockTimeMs = new Date('2026-06-26T20:00:00Z').getTime();
  
  console.log("Invoking runPersonaActivity for Friday 23:00 EAT...");
  await f.runPersonaActivity.run();

  // Retrieve messages posted in RTDB to see which venues were simulated
  let chatSnap = await rtdb.ref('venue_chats').once('value');
  let chats = chatSnap.val() || {};
  let simulatedVenueIds = Object.keys(chats);

  console.log("Simulated venue IDs:", simulatedVenueIds);
  // Cap is at most 4 simulated venues total on peak nights
  assert.ok(simulatedVenueIds.length <= 4, `Peak night simulated venues (${simulatedVenueIds.length}) exceeded cap of 4.`);
  assert.ok(simulatedVenueIds.length > 0, "No venues were simulated on peak night.");

  // Save the list of Friday simulated venues and their message count
  const fridayVenues = [...simulatedVenueIds];

  // ---------------------------------------------------------------------------
  // SCENARIO 2: Crossing Midnight (Saturday 01:00 EAT)
  // ---------------------------------------------------------------------------
  console.log("\n--- SCENARIO 2: Saturday 01:00 EAT (Friday Night Rollover) ---");
  
  // Saturday June 27, 2026 at 01:00 EAT -> 22:00 UTC (still Friday night rollover logic!)
  mockTimeMs = new Date('2026-06-26T22:00:00Z').getTime();

  // Run calculation to see if target venues are identical
  const rolloverDate = getRolloverEATDate(mockTimeMs);
  console.log(`Rollover Date at Saturday 1 AM: Day: ${rolloverDate.day}, Weekday: ${rolloverDate.weekday}`);
  assert.strictEqual(rolloverDate.weekday, 'Fri', "Saturday 1 AM EAT was not rolled back to Friday!");

  // Clean databases to measure what gets posted next
  await cleanDatabases();
  console.log("Invoking runPersonaActivity for Saturday 01:00 EAT...");
  await f.runPersonaActivity.run();

  chatSnap = await rtdb.ref('venue_chats').once('value');
  chats = chatSnap.val() || {};
  let saturdayEarlyVenues = Object.keys(chats);

  console.log("Saturday early morning simulated venues:", saturdayEarlyVenues);
  assert.deepStrictEqual(saturdayEarlyVenues.sort(), fridayVenues.sort(), "Venues reshuffled mid-night after crossing midnight!");
  console.log("✓ Date rollover successfully stabilized active venues across midnight.");

  // ---------------------------------------------------------------------------
  // SCENARIO 3: Weekday Seed (Monday 22:00 EAT)
  // ---------------------------------------------------------------------------
  console.log("\n--- SCENARIO 3: Monday 22:00 EAT (Light Night) ---");
  await cleanDatabases();

  // Monday June 29, 2026 at 22:00 EAT -> 19:00 UTC
  mockTimeMs = new Date('2026-06-29T19:00:00Z').getTime();

  console.log("Invoking runPersonaActivity for Monday 22:00 EAT...");
  await f.runPersonaActivity.run();

  chatSnap = await rtdb.ref('venue_chats').once('value');
  chats = chatSnap.val() || {};
  let weekdayVenues = Object.keys(chats);

  console.log("Weekday simulated venues:", weekdayVenues);
  // Cap is at most 2 simulated venues total on light nights
  assert.ok(weekdayVenues.length <= 2, `Light night simulated venues (${weekdayVenues.length}) exceeded cap of 2.`);
  
  // Verify they are both ambient (chainDepth for all messages is 0)
  for (const vid of weekdayVenues) {
    const msgs = Object.values(chats[vid]);
    msgs.forEach(m => {
      assert.strictEqual(m.chainDepth, 0, `Ambient message at venue ${vid} has non-zero chainDepth!`);
    });
  }
  console.log("✓ Weekday seed correctly produced at most 2 ambient-only venues with zero deep chains.");

  // Restore original Date.now
  Date.now = originalDateNow;
  console.log("\n=================== ALL LOCAL PERSONA CAPS & ROLLOVER TESTS PASSED! ===================\n");
  process.exit(0);
}

runTest().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
