const admin = require('firebase-admin');
const assert = require('assert');

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_DATABASE_EMULATOR_HOST = "127.0.0.1:9000";

if (admin.apps.length === 0) {
  admin.initializeApp({
    projectId: 'eventa-211fb',
    databaseURL: 'https://eventa-211fb-default-rtdb.firebaseio.com'
  });
}

const rtdb = admin.database();

async function runTest() {
  console.log("\n=================== STARTING REAL-USER OVERRIDE & DEEP CHAIN TESTS ===================");

  const venueId = 'venue_003'; // Havana Bar & Restaurant
  console.log(`Clearing RTDB path venue_chats/${venueId}...`);
  await rtdb.ref(`venue_chats/${venueId}`).remove();

  console.log("Posting real-user message to Havana...");
  const testMessage = {
    user_id: 'real_user_nils',
    username: 'nils',
    message: 'Hey anyone at Havana right now? How is the crowd?',
    type: 'text',
    timestamp: Date.now()
  };

  await rtdb.ref(`venue_chats/${venueId}`).push().set(testMessage);
  console.log("Real-user message posted. Waiting 15 seconds for emulator background function triggers to process...");

  // Sleep 15 seconds to let the staggered background replies run
  await new Promise(resolve => setTimeout(resolve, 15000));

  console.log("Fetching chat history...");
  const snap = await rtdb.ref(`venue_chats/${venueId}`).orderByChild('timestamp').once('value');
  
  if (!snap.exists()) {
    console.error("❌ No messages found! Trigger did not run or fail.");
    process.exit(1);
  }

  const messages = [];
  snap.forEach((child) => {
    messages.push({ id: child.key, ...child.val() });
  });

  console.log("\n--- THREAD HISTORY ---");
  messages.forEach((m, i) => {
    console.log(`${i + 1}. @${m.username} (depth: ${m.chainDepth || 0}) -> "${m.message}"`);
  });
  console.log("----------------------\n");

  assert.strictEqual(messages.length, 3, `Thread length should be exactly 3, but found ${messages.length}`);
  
  assert.strictEqual(messages[0].user_id, 'real_user_nils', "First message must be the real user");
  assert.strictEqual(messages[0].chainDepth || 0, 0, "Real user message must be depth 0");
  
  assert.ok(messages[1].isPersona, "Second message must be a persona");
  assert.strictEqual(messages[1].chainDepth, 1, "First persona reply must be depth 1");
  
  assert.ok(messages[2].isPersona, "Third message must be a persona");
  assert.strictEqual(messages[2].chainDepth, 2, "Second persona reply must be depth 2");

  console.log("✓ Real-user override correctly flipped venue to deep.");
  console.log("✓ Persona-to-persona replying successfully terminated at chainDepth = 2.");
  console.log("\n=================== ALL OVERRIDE AND CHAIN TESTS PASSED! ===================\n");
  process.exit(0);
}

runTest().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
