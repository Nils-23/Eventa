const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Extract API key from .env
let anthropicApiKey = '';
try {
  const envContent = fs.readFileSync(path.join(__dirname, '../.env'), 'utf8');
  const match = envContent.match(/ANTHROPIC_API_KEY\s*=\s*(.*)/);
  if (match && match[1]) {
    anthropicApiKey = match[1].trim().replace(/['"]/g, '');
  }
} catch (e) {
  console.warn("Could not read .env file:", e.message);
}

// Force emulator hosts if not already set
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_DATABASE_EMULATOR_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000';

const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`
});

const db = admin.firestore();
const rtdb = admin.database();

const NAIROBI_VENUES = [
  {
    id: 'venue_001',
    name: 'Alchemist Bar',
    latitude: -1.2664,
    longitude: 36.7966,
    type: 'Bar'
  },
  {
    id: 'venue_002',
    name: 'B-Club',
    latitude: -1.2897,
    longitude: 36.7834,
    type: 'Club'
  },
  {
    id: 'venue_003',
    name: 'Havana Bar & Restaurant',
    latitude: -1.2921,
    longitude: 36.8219,
    type: 'Bar'
  },
  {
    id: 'venue_004',
    name: 'The Kiza Lounge',
    latitude: -1.2831,
    longitude: 36.7814,
    type: 'Club'
  },
  {
    id: 'venue_005',
    name: 'Brew Bistro & Lounge',
    latitude: -1.3007,
    longitude: 36.7839,
    type: 'Club'
  }
];

const PERSONAS = [
  {
    id: 'persona_zawadi_muthoni',
    name: 'Zawadi Muthoni',
    username: 'NightOwl8324',
    personalityType: 'hype_person',
    preferredVenueTypes: ['Club', 'Bar']
  },
  {
    id: 'persona_kofi_omondi',
    name: 'Kofi Omondi',
    username: 'PartyAnimal2918',
    personalityType: 'hype_person',
    preferredVenueTypes: ['Club', 'Bar']
  },
  {
    id: 'persona_shiku_wanjiru',
    name: 'Shiku Wanjiru',
    username: 'VibeCheck7492',
    personalityType: 'hype_person',
    preferredVenueTypes: ['Club', 'Event']
  },
  {
    id: 'persona_brian_kariuki',
    name: 'Brian Kariuki',
    username: 'Raver1083',
    personalityType: 'hype_person',
    preferredVenueTypes: ['Bar', 'Event']
  }
];

async function seed() {
  console.log("Seeding simulation settings...");
  await db.collection('settings').doc('simulation').set({
    enabled: true,
    anthropicApiKey: anthropicApiKey
  });
  console.log("✓ Simulation settings seeded.");

  console.log("Seeding venues...");
  for (const v of NAIROBI_VENUES) {
    await db.collection('venues').doc(v.id).set(v);
  }
  console.log("✓ Venues seeded.");

  console.log("Seeding personas...");
  for (const p of PERSONAS) {
    await db.collection('personas').doc(p.id).set(p);
  }
  console.log("✓ Personas seeded.");

  console.log("Emulator Seeding completed successfully!");
  process.exit(0);
}

seed().catch(console.error);
