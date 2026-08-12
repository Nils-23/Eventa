// Manual runner for the venue image refresh (same logic as the scheduled
// refreshVenueImages Cloud Function). Use after a Maps key rotation or outage
// to heal images immediately instead of waiting for the next scheduled run.
//   node scripts/refreshVenueImages.js
// The key is read from settings/simulation.googleMapsApiKey (the same source the
// Cloud Function uses, so a manual run can't heal against a different key than
// the scheduled one); GOOGLE_MAPS_API_KEY overrides it if set.
//
// firebase-admin is required from functions/node_modules on purpose. The root
// project has its own copy, and mixing the two makes every FieldValue sentinel
// (serverTimestamp, delete) unserializable — the writes fail while the reads and
// lookups all appear to succeed.
const admin = require('../functions/node_modules/firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');
const { refreshVenueImages } = require('../functions/venueImages');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

async function main() {
  const db = admin.firestore();
  let apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    const settings = await db.collection('settings').doc('simulation').get();
    apiKey = settings.exists ? settings.data().googleMapsApiKey : null;
  }
  if (!apiKey) {
    console.error(
      'No Maps key found. Set GOOGLE_MAPS_API_KEY, or populate settings/simulation.googleMapsApiKey.'
    );
    process.exit(1);
  }

  await refreshVenueImages(db, apiKey);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal execution error:', err);
    process.exit(1);
  });
