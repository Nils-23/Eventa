const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

if (admin.apps.length === 0) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function fix() {
  const username = 'DayTripper_BOSS';
  const usersRef = db.collection('users');
  const snapshot = await usersRef.where('username', '==', username).get();
  
  if (snapshot.empty) {
    console.error(`User ${username} not found!`);
    process.exit(1);
  }
  
  const userDoc = snapshot.docs[0];
  console.log(`Found user: ${username} (ID: ${userDoc.id})`);
  console.log(`Current points_2026_07: ${userDoc.data().points_2026_07}`);
  
  console.log('Resetting points_2026_07 to 0...');
  await userDoc.ref.update({
    points_2026_07: 0
  });
  
  console.log('Verification: fetching user data again...');
  const updatedDoc = await userDoc.ref.get();
  console.log(`Updated points_2026_07: ${updatedDoc.data().points_2026_07}`);
  console.log('Database repair completed successfully!');
  process.exit(0);
}

fix().catch(err => {
  console.error('Error running repair script:', err);
  process.exit(1);
});
