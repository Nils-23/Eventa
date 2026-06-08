const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`
});

const rtdb = admin.database();

async function inspectRTDB() {
  const ref = rtdb.ref('simulated_locations');
  const snap = await ref.once('value');
  
  if (!snap.exists()) {
    console.log('No simulated locations found in RTDB.');
    process.exit(0);
  }

  const locations = snap.val();
  const total = Object.keys(locations).length;
  console.log(`Total Simulated Locations in RTDB: ${total}`);

  let withVenueId = 0;
  let withoutVenueId = 0;
  let sampleMissing = null;

  Object.entries(locations).forEach(([key, val]) => {
    if (val.venueId) {
      withVenueId++;
    } else {
      withoutVenueId++;
      if (!sampleMissing) {
        sampleMissing = { key, val };
      }
    }
  });

  console.log(`- Locations WITH venueId: ${withVenueId}`);
  console.log(`- Locations WITHOUT venueId: ${withoutVenueId}`);
  if (sampleMissing) {
    console.log('Sample missing venueId:', JSON.stringify(sampleMissing, null, 2));
  }

  process.exit(0);
}

inspectRTDB().catch(console.error);
