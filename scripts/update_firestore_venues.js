const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const updatedVenues = {
  venue_001: { latitude: -1.2625724, longitude: 36.8039327, address: "Parklands Rd, Westlands, Nairobi" },
  venue_002: { latitude: -1.2908639, longitude: 36.7829028, address: "Galana Plaza, Galana Rd, Kilimani, Nairobi" },
  venue_003: { latitude: -1.2642143, longitude: 36.8044386, address: "33 Woodvale Grv, Westlands, Nairobi" },
  venue_004: { latitude: -1.2909566, longitude: 36.7826144, address: "Galana Plaza, Galana Rd, Kilimani, Nairobi" },
  venue_005: { latitude: -1.264758, longitude: 36.8042338, address: "Fortis Tower, Woodvale Grove, Westlands, Nairobi" },
  venue_006: { latitude: -1.2642464, longitude: 36.8040987, address: "Krishna Center, Woodvale Grv, Westlands, Nairobi" },
  venue_007: { latitude: -1.3022805, longitude: 36.8167439, address: "Elgon Rd, Upperhill, Nairobi" },
  venue_008: { latitude: -1.2680421, longitude: 36.8055464, address: "Waiyaki Way, Westlands, Nairobi" },
  venue_009: { latitude: -1.2675001, longitude: 36.812022, address: "Westlands, Nairobi" },
  venue_010: { latitude: -1.3362692, longitude: 36.7757823, address: "Langata Rd, Langata, Nairobi" },
  venue_011: { latitude: -1.2312163, longitude: 36.8768796, address: "Thika Road, Kasarani, Nairobi" },
  venue_012: { latitude: -1.2154953, longitude: 36.8453822, address: "Kiambu Rd, Kiambu" },
  venue_013: { latitude: -1.2872129, longitude: 36.7727869, address: "Othaya Rd, Kileleshwa, Nairobi" },
  venue_014: { latitude: -1.2209769, longitude: 36.8802146, address: "USIU Rd, Roysambu, Nairobi" },
  venue_015: { latitude: -1.2109073, longitude: 36.8870886, address: "Mirema Drive, Roysambu, Nairobi" },
  venue_016: { latitude: -1.3000736, longitude: 36.7842119, address: "Ngong Rd, Kilimani, Nairobi" }
};

async function updateVenues() {
  const batch = db.batch();
  for (const [id, data] of Object.entries(updatedVenues)) {
    const docRef = db.collection('venues').doc(id);
    batch.set(docRef, data, { merge: true });
  }
  await batch.commit();
  console.log('Successfully updated all 16 Nairobi venue coordinates and addresses in Firestore!');
}

updateVenues().catch(console.error);
