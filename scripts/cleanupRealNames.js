const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

if (admin.apps.length === 0) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`
  });
}

const rtdb = admin.database();

async function cleanupRealNames() {
  const venueId = 'venue_001';
  const chatRef = rtdb.ref(`venue_chats/${venueId}`);
  const snap = await chatRef.once('value');

  if (snap.exists()) {
    const messages = snap.val();
    const updates = {};
    for (const [key, msg] of Object.entries(messages)) {
      const text = (msg.message || '').toLowerCase();
      const username = (msg.username || '').toLowerCase();
      const userId = (msg.user_id || '').toLowerCase();

      if (
        userId === 'user_test_nils' ||
        username.includes('nils') ||
        text.includes('nils')
      ) {
        console.log(`Deleting message: "${msg.message}" by ${msg.username}`);
        updates[key] = null;
      }
    }

    if (Object.keys(updates).length > 0) {
      await chatRef.update(updates);
      console.log('Successfully cleaned up matching messages.');
    } else {
      console.log('No matching messages found.');
    }
  }

  process.exit(0);
}

cleanupRealNames().catch(console.error);
