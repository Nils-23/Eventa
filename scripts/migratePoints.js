const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function migrate() {
  const usersRef = db.collection('users');
  const snapshot = await usersRef.get();
  
  const currentMonthKey = 'points_2026_05'; // May 2026
  
  console.log(`Checking ${snapshot.size} users for points migration...`);
  
  const batch = db.batch();
  let migrateCount = 0;
  
  snapshot.forEach(doc => {
    const data = doc.data();
    const points = data.points || 0;
    const monthlyPoints = data[currentMonthKey];
    
    if (points > 0 && monthlyPoints === undefined) {
      console.log(`User ${data.username || doc.id} has ${points} points but missing ${currentMonthKey}. Migrating...`);
      batch.update(doc.ref, {
        [currentMonthKey]: points
      });
      migrateCount++;
    }
  });
  
  if (migrateCount > 0) {
    await batch.commit();
    console.log(`Successfully migrated ${migrateCount} users.`);
  } else {
    console.log('No users needed migration.');
  }
}

migrate().catch(console.error);
