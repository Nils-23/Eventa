const admin = require('firebase-admin');
const serviceAccount = require('../scripts/serviceAccountKey.json');

if (admin.apps.length === 0) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function check() {
  const usersRef = db.collection('users');
  const snapshot = await usersRef.get();
  
  console.log(`=== Users in Firestore (${snapshot.size}) ===`);
  snapshot.forEach(doc => {
    const data = doc.data();
    console.log(`User: ${data.username || doc.id}`);
    console.log(`  Lifetime Points: ${data.points || 0}`);
    
    // Print all fields starting with "points_"
    const pointsKeys = Object.keys(data).filter(k => k.startsWith('points_'));
    pointsKeys.forEach(k => {
      console.log(`  ${k}: ${data[k]}`);
    });
  });
  process.exit(0);
}

check().catch(console.error);
