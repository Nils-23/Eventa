const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function listAllVenues() {
  const venuesSnap = await db.collection('venues').get();
  const venues = [];
  const names = new Set();
  const duplicates = [];

  venuesSnap.forEach((doc) => {
    const data = doc.data();
    const name = data.name;
    venues.push({ id: doc.id, name, type: data.type });
    if (names.has(name)) {
      duplicates.push({ name, id: doc.id });
    } else {
      names.add(name);
    }
  });

  console.log(`Total Venues: ${venues.length}`);
  console.log('--- List of All Venues ---');
  venues.forEach(v => {
    console.log(`- [${v.id}] ${v.name} (${v.type})`);
  });

  if (duplicates.length > 0) {
    console.log('\n⚠️ Duplicates found:');
    duplicates.forEach(d => console.log(`- ${d.name} (ID: ${d.id})`));
  } else {
    console.log('\n✅ No duplicates found!');
  }

  process.exit(0);
}

listAllVenues().catch(console.error);
