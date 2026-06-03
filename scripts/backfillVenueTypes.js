const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function backfillVenues() {
  const venuesRef = db.collection('venues');
  const snapshot = await venuesRef.get();

  if (snapshot.empty) {
    console.log('No venues found.');
    return;
  }

  const batch = db.batch();
  let updatedCount = 0;
  let deletedCount = 0;

  snapshot.forEach(doc => {
    const venue = doc.data();
    const name = (venue.name || '').toLowerCase();
    
    let type = null;

    if (name.includes('club')) {
      type = 'Club';
    } else if (name.includes('bar') || name.includes('lounge') || name.includes('bistro') || name.includes('grill')) {
      type = 'Bar';
    } else if (name.includes('festival') || name.includes('activity')) {
      type = 'Activity';
    } else if (name.includes('event')) {
      type = 'Event';
    }

    const docRef = venuesRef.doc(doc.id);

    if (type) {
      batch.update(docRef, { type });
      updatedCount++;
      console.log(`Updated ${venue.name} -> ${type}`);
    } else {
      batch.delete(docRef);
      deletedCount++;
      console.log(`Deleted ${venue.name} (unidentifiable)`);
    }
  });

  await batch.commit();
  console.log(`\n✅ Migration Complete!`);
  console.log(`- Updated: ${updatedCount}`);
  console.log(`- Deleted: ${deletedCount}`);
  process.exit(0);
}

backfillVenues().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
