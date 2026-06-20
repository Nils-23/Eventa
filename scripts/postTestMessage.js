const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

if (admin.apps.length === 0) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`
  });
}

const rtdb = admin.database();

async function postTestMessage() {
  const venueId = 'venue_001'; // Alchemist Bar (Type: Bar)
  const messageRef = rtdb.ref(`venue_chats/${venueId}`).push();
  const testMessage = {
    user_id: 'user_test_nils',
    username: 'nils',
    message: 'Hey anyone at Alchemist tonight? How is the crowd?',
    type: 'text',
    timestamp: Date.now()
  };

  console.log(`Sending test message to venue_chats/${venueId} as real user 'nils'...`);
  await messageRef.set(testMessage);
  console.log('Test message sent successfully! Cloud Function onNewChatMessage should now trigger.');
  process.exit(0);
}

postTestMessage().catch(console.error);
