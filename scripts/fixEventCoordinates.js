const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

// Coordinates lookup map for known venues and addresses in Nairobi
const KNOWN_COORDINATES = {
  'alliance francaise': { latitude: -1.2831, longitude: 36.8188 },
  'braeburn': { latitude: -1.2885, longitude: 36.7642 },
  'capital club': { latitude: -1.2642, longitude: 36.8061 },
  'koda': { latitude: -1.2655, longitude: 36.8042 },
  'park inn': { latitude: -1.2638, longitude: 36.8049 },
  'unseen': { latitude: -1.2942, longitude: 36.7865 },
  'radix': { latitude: -1.3215, longitude: 36.7150 },
  'all saints': { latitude: -1.2892, longitude: 36.8155 },
  'stoni athi': { latitude: -1.5125, longitude: 36.9856 },
  'kiambu valley': { latitude: -1.1712, longitude: 36.8285 },
  'village market': { latitude: -1.2288, longitude: 36.8050 },
  'national theatre': { latitude: -1.2792, longitude: 36.8166 },
  'sarakasi': { latitude: -1.2767, longitude: 36.8269 },
  'kicc': { latitude: -1.2889, longitude: 36.8236 },
  'kasarani': { latitude: -1.2299, longitude: 36.8913 },
  'two rivers': { latitude: -1.2118, longitude: 36.7957 },
  'ngong hills': { latitude: -1.4000, longitude: 36.6381 },
  'railway museum': { latitude: -1.2906, longitude: 36.8206 },
  'carnivore': { latitude: -1.3251, longitude: 36.8021 },
  'circle art': { latitude: -1.2964, longitude: 36.7598 },
  'jamhuri': { latitude: -1.2995, longitude: 36.7907 },
  'golf park': { latitude: -1.3107, longitude: 36.7428 },
  'mist': { latitude: -1.2646, longitude: 36.8028 },
  'alchemist': { latitude: -1.2650, longitude: 36.8038 },
  'muze': { latitude: -1.2645, longitude: 36.8040 },
  'kimosabe': { latitude: -1.2640, longitude: 36.8050 },
  'westlands': { latitude: -1.2630, longitude: 36.8030 },
  'kilimani': { latitude: -1.2900, longitude: 36.7820 },
  'karen': { latitude: -1.3200, longitude: 36.7100 },
  'lavington': { latitude: -1.2800, longitude: 36.7600 }
};

function resolveCoords(address, name) {
  const text = `${name || ''} ${address || ''}`.toLowerCase();
  for (const [key, coords] of Object.entries(KNOWN_COORDINATES)) {
    if (text.includes(key)) {
      return coords;
    }
  }
  return null;
}

async function fixEventCoordinates() {
  const snap = await db.collection('venues').get();
  console.log(`Checking ${snap.size} documents in 'venues' collection...`);

  let updatedCount = 0;
  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    if (data.type === 'Event' || docSnap.id.startsWith('event_')) {
      const currentLat = data.latitude;
      const currentLng = data.longitude;
      const isDefaultCoords = currentLat === -1.286389 && currentLng === 36.817223;

      const resolved = resolveCoords(data.address, data.name);
      if (resolved && (isDefaultCoords || (resolved.latitude !== currentLat || resolved.longitude !== currentLng))) {
        await db.collection('venues').doc(docSnap.id).update({
          latitude: resolved.latitude,
          longitude: resolved.longitude
        });
        console.log(`✅ Updated [${docSnap.id}] "${data.name}" (${data.address}) -> (${resolved.latitude}, ${resolved.longitude})`);
        updatedCount++;
      } else if (isDefaultCoords && !resolved) {
        console.log(`⚠️ Document [${docSnap.id}] "${data.name}" (${data.address}) has default coords but no matching lookup rule.`);
      }
    }
  }

  console.log(`\n🎉 Successfully updated coordinates for ${updatedCount} events in Firestore!`);
}

fixEventCoordinates().catch(console.error);
