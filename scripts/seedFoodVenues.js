/**
 * seedFoodVenues.js — seeds well-known Nairobi food venues (type: 'Food') so
 * the Food category isn't empty at launch.
 *
 * Coordinates, addresses, and photos are resolved live from Google Places so
 * pins land exactly where the venues are. Run with:
 *   GOOGLE_MAPS_API_KEY=... node scripts/seedFoodVenues.js
 * (falls back to EXPO_PUBLIC_GOOGLE_MAPS_API_KEY)
 */

const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

if (admin.apps.length === 0) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
if (!apiKey) {
  console.error('Missing GOOGLE_MAPS_API_KEY env var.');
  process.exit(1);
}

// venueProfile is set explicitly (restaurant | cafe) so the attendance curves
// are right from the first crowd-sim cycle instead of relying on inference.
const FOOD_VENUES = [
  {
    id: 'food_001',
    query: 'Carnivore Restaurant, Langata Road, Nairobi',
    name: 'Carnivore Restaurant',
    venueProfile: 'restaurant',
    description: 'Nairobi\'s legendary nyama choma experience — endless roast meats carved at your table, a rite of passage for locals and visitors alike.',
  },
  {
    id: 'food_002',
    query: 'Mama Oliech Restaurant, Marcus Garvey Road, Nairobi',
    name: 'Mama Oliech Restaurant',
    venueProfile: 'restaurant',
    description: 'The home of Nairobi\'s most famous whole fried tilapia with ugali. An institution — simple, busy, and always worth it.',
  },
  {
    id: 'food_003',
    query: 'Talisman Restaurant, Ngong Road, Karen, Nairobi',
    name: 'The Talisman',
    venueProfile: 'restaurant',
    description: 'Karen\'s beloved garden restaurant mixing Kenyan and international flavours. Famous for the feta and coriander samosas.',
  },
  {
    id: 'food_004',
    query: 'Nyama Mama Delta Towers, Westlands, Nairobi',
    name: 'Nyama Mama Delta',
    venueProfile: 'restaurant',
    description: 'Modern Kenyan roadside-diner classics with a twist — chapo wraps, mama\'s pilau, and colourful interiors in the heart of Westlands.',
  },
  {
    id: 'food_005',
    query: "CJ's Restaurant, Koinange Street, Nairobi",
    name: "CJ's Koinange Street",
    venueProfile: 'restaurant',
    description: 'All-day casual dining in the CBD — big menus, bigger milkshakes, and a constant lunch-hour buzz.',
  },
  {
    id: 'food_006',
    query: 'Java House Kimathi Street, Nairobi',
    name: 'Java House Kimathi Street',
    venueProfile: 'cafe',
    description: 'The flagship of Kenya\'s favourite coffee house — reliable coffee, breakfast plates, and a steady CBD crowd from morning to evening.',
  },
  {
    id: 'food_007',
    query: 'Fogo Gaucho Restaurant, Westlands, Nairobi',
    name: 'Fogo Gaucho',
    venueProfile: 'restaurant',
    description: 'Brazilian churrascaria in Westlands — unlimited flame-grilled meat brought to your table on swords. Come hungry.',
  },
];

async function resolvePlace(query) {
  const searchUrl = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&location=-1.286389,36.817223&radius=50000&key=${apiKey}`;
  const searchData = await (await fetch(searchUrl)).json();
  if (searchData.status !== 'OK' || searchData.predictions.length === 0) {
    throw new Error(`Autocomplete failed (${searchData.status})`);
  }
  const placeId = searchData.predictions[0].place_id;
  const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=geometry,formatted_address,name,photos&key=${apiKey}`;
  const detailsData = await (await fetch(detailsUrl)).json();
  if (detailsData.status !== 'OK' || !detailsData.result) {
    throw new Error(`Details failed (${detailsData.status})`);
  }
  const r = detailsData.result;
  return {
    latitude: r.geometry.location.lat,
    longitude: r.geometry.location.lng,
    address: r.formatted_address,
    googleName: r.name,
    imageUrl: r.photos && r.photos.length > 0
      ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${r.photos[0].photo_reference}&key=${apiKey}`
      : null,
  };
}

async function seed() {
  console.log(`\n🍽  Seeding ${FOOD_VENUES.length} Nairobi food venues...\n`);
  let ok = 0;
  for (const v of FOOD_VENUES) {
    try {
      const place = await resolvePlace(v.query);
      const docData = {
        id: v.id,
        name: v.name,
        description: v.description,
        address: place.address,
        latitude: place.latitude,
        longitude: place.longitude,
        type: 'Food',
        venueProfile: v.venueProfile,
        ...(place.imageUrl ? { imageUrl: place.imageUrl } : {}),
      };
      await db.collection('venues').doc(v.id).set(docData, { merge: true });
      console.log(`  ✅ ${v.name} @ (${place.latitude.toFixed(5)}, ${place.longitude.toFixed(5)}) ${place.imageUrl ? '📷' : '(no photo)'}`);
      console.log(`     ${place.address}`);
      ok++;
    } catch (err) {
      console.error(`  ❌ ${v.name}: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(`\n✅ Seeded ${ok}/${FOOD_VENUES.length} food venues.\n`);
  process.exit(0);
}

seed().catch((err) => { console.error('Fatal:', err); process.exit(1); });
