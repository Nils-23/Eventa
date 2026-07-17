// Manual runner for the venue image refresh (same logic as the scheduled
// refreshVenueImages Cloud Function). Use after a Maps key rotation or outage
// to heal images immediately instead of waiting for the next scheduled run.
//   GOOGLE_MAPS_API_KEY=... node scripts/refreshVenueImages.js
const admin = require('../functions/node_modules/firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');
const { refreshVenueImages } = require('../functions/venueImages');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
if (!apiKey) {
  console.error('Missing GOOGLE_MAPS_API_KEY env var. Set it before running, e.g. GOOGLE_MAPS_API_KEY=... node scripts/refreshVenueImages.js');
  process.exit(1);
}

refreshVenueImages(admin.firestore(), apiKey)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal execution error:', err);
    process.exit(1);
  });
