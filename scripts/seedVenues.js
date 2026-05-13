/**
 * One-time seed script — run with:
 *   node scripts/seedVenues.js
 *
 * Requires a Firebase service account key saved at:
 *   scripts/serviceAccountKey.json
 *
 * Download it from Firebase Console → Project Settings → Service accounts
 */

const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const NAIROBI_VENUES = [
  {
    id: 'venue_001',
    name: 'Alchemist Bar',
    latitude: -1.2664,
    longitude: 36.7966,
    description: 'Nairobi\'s iconic open-air bar with live music, food trucks, and an eclectic crowd every weekend.',
  },
  {
    id: 'venue_002',
    name: 'B-Club',
    latitude: -1.2897,
    longitude: 36.7834,
    description: 'The city\'s premier nightclub, known for international DJs, VIP tables, and high energy.',
  },
  {
    id: 'venue_003',
    name: 'Havana Bar & Restaurant',
    latitude: -1.2921,
    longitude: 36.8219,
    description: 'Cuban-inspired cocktail bar in the heart of the CBD. Salsa nights every Thursday.',
  },
  {
    id: 'venue_004',
    name: 'The Kiza Lounge',
    latitude: -1.2831,
    longitude: 36.7814,
    description: 'Upscale Westlands nightspot with afrobeats and a rooftop terrace overlooking the city skyline.',
  },
  {
    id: 'venue_005',
    name: 'Brew Bistro & Lounge',
    latitude: -1.2658,
    longitude: 36.8039,
    description: 'Craft beer hub at ABC Place, Waiyaki Way. Great for after-work drinks with a lively patio.',
  },
  {
    id: 'venue_006',
    name: 'Club Hypnotica',
    latitude: -1.2869,
    longitude: 36.8141,
    description: 'Popular Central Business District club known for packed dance floors and affordable entry.',
  },
  {
    id: 'venue_007',
    name: 'Sky Lounge Radisson Blu',
    latitude: -1.2959,
    longitude: 36.8149,
    description: 'Rooftop bar with panoramic Nairobi views. Perfect for sundowners and city nightscapes.',
  },
  {
    id: 'venue_008',
    name: 'Galileo Lounge',
    latitude: -1.2908,
    longitude: 36.7825,
    description: 'Westlands sports bar turned nightclub. Live DJ sets and happy hours all week.',
  },
  {
    id: 'venue_009',
    name: 'X-Lounge',
    latitude: -1.2845,
    longitude: 36.7855,
    description: 'Upscale Westlands venue popular with Nairobi\'s social elite. House and afropop every Friday.',
  },
  {
    id: 'venue_010',
    name: '1824 Bar & Grill',
    latitude: -1.2953,
    longitude: 36.8218,
    description: 'Named after Nairobi\'s founding, this bar combines history with modern cocktail culture in the CBD.',
  },
  {
    id: 'venue_011',
    name: 'AL CAPONE LOUNGE',
    latitude: -1.2323,
    longitude: 36.8797,
    description: 'Popular nightlife spot along Thika Superhighway known for a vibrant crowd and music.',
  },
  {
    id: 'venue_012',
    name: 'HABANOS LOUNGE',
    latitude: -1.2154,
    longitude: 36.8452,
    description: 'Premium lounge located along the Northern Bypass near Kiambu Road.',
  },
  {
    id: 'venue_013',
    name: 'Bar Next Door',
    latitude: -1.2825,
    longitude: 36.7865,
    description: 'Trendy social hub in Kileleshwa, famous for weekend vibes and great cocktails.',
  },
  {
    id: 'venue_014',
    name: 'Zeytoon Lounge',
    latitude: -1.2930,
    longitude: 36.7845,
    description: 'Elegant lounge space with premium service and energetic nightlife atmosphere.',
  },
  {
    id: 'venue_015',
    name: 'Paris Lounge and Grill',
    latitude: -1.2050,
    longitude: 36.8850,
    description: 'Lively grill and lounge along Mirema Drive, offering fantastic food and music.',
  },
  {
    id: 'venue_016',
    name: 'QUIVER KILIMANI',
    latitude: -1.3005,
    longitude: 36.7808,
    description: 'The Kilimani branch of the famous Quiver Lounge, located along Ngong Road.',
  }
];

async function seedVenues() {
  const batch = db.batch();

  for (const venue of NAIROBI_VENUES) {
    const docRef = db.collection('venues').doc(venue.id);
    batch.set(docRef, venue);
  }

  await batch.commit();
  console.log(`✅ Successfully seeded ${NAIROBI_VENUES.length} Nairobi venues to Firestore!`);
  process.exit(0);
}

seedVenues().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
