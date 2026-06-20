/**
 * seedPersonas.js
 * Run once: node scripts/seedPersonas.js
 * Seeds 25 fixed Nairobi fictional user personas into the Firestore `personas` collection.
 * These personas are used by the runPersonaActivity Cloud Function to generate AI chat messages.
 */

const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

if (admin.apps.length === 0) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`
  });
}

const db = admin.firestore();

const PERSONAS = [
  // ── HYPE PERSON ──────────────────────────────────────────────────────────────
  {
    id: 'persona_zawadi_muthoni',
    name: 'Zawadi Muthoni',
    username: 'NightOwl8324',
    personalityType: 'hype_person',
    preferredVenueTypes: ['Club', 'Bar'],
  },
  {
    id: 'persona_kofi_omondi',
    name: 'Kofi Omondi',
    username: 'PartyAnimal2918',
    personalityType: 'hype_person',
    preferredVenueTypes: ['Club', 'Bar'],
  },
  {
    id: 'persona_shiku_wanjiru',
    name: 'Shiku Wanjiru',
    username: 'VibeCheck7492',
    personalityType: 'hype_person',
    preferredVenueTypes: ['Club', 'Event'],
  },
  {
    id: 'persona_brian_kariuki',
    name: 'Brian Kariuki',
    username: 'Raver1083',
    personalityType: 'hype_person',
    preferredVenueTypes: ['Bar', 'Event'],
  },
  {
    id: 'persona_aisha_ndegwa',
    name: 'Aisha Ndegwa',
    username: 'ClubHopper5902',
    personalityType: 'hype_person',
    preferredVenueTypes: ['Club', 'Activity'],
  },
  {
    id: 'persona_kelvin_maina',
    name: 'Kelvin Maina',
    username: 'MidnightRider3821',
    personalityType: 'hype_person',
    preferredVenueTypes: ['Club', 'Bar'],
  },
  {
    id: 'persona_ryan_kamande',
    name: 'Ryan Kamande',
    username: 'NeonSoul4729',
    personalityType: 'hype_person',
    preferredVenueTypes: ['Bar', 'Club'],
  },

  // ── QUESTION ASKER ────────────────────────────────────────────────────────────
  {
    id: 'persona_mwenda_kamau',
    name: 'Mwenda Kamau',
    username: 'BassDrop6820',
    personalityType: 'question_asker',
    preferredVenueTypes: ['Bar', 'Activity'],
  },
  {
    id: 'persona_pendo_otieno',
    name: 'Pendo Otieno',
    username: 'GrooveMaster9102',
    personalityType: 'question_asker',
    preferredVenueTypes: ['Club', 'Bar'],
  },
  {
    id: 'persona_juma_njoroge',
    name: 'Juma Njoroge',
    username: 'MoonlightViber1938',
    personalityType: 'question_asker',
    preferredVenueTypes: ['Club', 'Event'],
  },
  {
    id: 'persona_tiffany_waweru',
    name: 'Tiffany Waweru',
    username: 'StarGazer4921',
    personalityType: 'question_asker',
    preferredVenueTypes: ['Bar', 'Activity'],
  },
  {
    id: 'persona_rashid_mwangi',
    name: 'Rashid Mwangi',
    username: 'RhythmJunkie8320',
    personalityType: 'question_asker',
    preferredVenueTypes: ['Event', 'Bar'],
  },
  {
    id: 'persona_lydia_chebet',
    name: 'Lydia Chebet',
    username: 'VibeChaser2719',
    personalityType: 'question_asker',
    preferredVenueTypes: ['Activity', 'Bar'],
  },

  // ── OPINION GIVER ─────────────────────────────────────────────────────────────
  {
    id: 'persona_neema_achieng',
    name: 'Neema Achieng',
    username: 'BeatRider5920',
    personalityType: 'opinion_giver',
    preferredVenueTypes: ['Club', 'Bar'],
  },
  {
    id: 'persona_cynthia_karanja',
    name: 'Cynthia Karanja',
    username: 'NightOwl9182',
    personalityType: 'opinion_giver',
    preferredVenueTypes: ['Club', 'Activity'],
  },
  {
    id: 'persona_felix_oduya',
    name: 'Felix Oduya',
    username: 'PartyAnimal4819',
    personalityType: 'opinion_giver',
    preferredVenueTypes: ['Bar', 'Event'],
  },
  {
    id: 'persona_grace_wambui',
    name: 'Grace Wambui',
    username: 'VibeCheck3829',
    personalityType: 'opinion_giver',
    preferredVenueTypes: ['Club', 'Event'],
  },
  {
    id: 'persona_shem_mutua',
    name: 'Shem Mutua',
    username: 'Raver5902',
    personalityType: 'opinion_giver',
    preferredVenueTypes: ['Bar', 'Activity'],
  },
  {
    id: 'persona_otieno_obiero',
    name: 'Otieno Obiero',
    username: 'ClubHopper9281',
    personalityType: 'opinion_giver',
    preferredVenueTypes: ['Club', 'Event'],
  },

  // ── EVENT ENTHUSIAST ──────────────────────────────────────────────────────────
  {
    id: 'persona_amina_hassan',
    name: 'Amina Hassan',
    username: 'MidnightRider8192',
    personalityType: 'event_enthusiast',
    preferredVenueTypes: ['Event', 'Club'],
  },
  {
    id: 'persona_victor_njiru',
    name: 'Victor Njiru',
    username: 'NeonSoul2839',
    personalityType: 'event_enthusiast',
    preferredVenueTypes: ['Event', 'Bar'],
  },
  {
    id: 'persona_stella_adhiambo',
    name: 'Stella Adhiambo',
    username: 'BassDrop7102',
    personalityType: 'event_enthusiast',
    preferredVenueTypes: ['Event', 'Activity'],
  },
  {
    id: 'persona_benson_gacheru',
    name: 'Benson Gacheru',
    username: 'GrooveMaster3910',
    personalityType: 'event_enthusiast',
    preferredVenueTypes: ['Event', 'Club'],
  },
  {
    id: 'persona_diana_njeri',
    name: 'Diana Njeri',
    username: 'MoonlightViber8291',
    personalityType: 'event_enthusiast',
    preferredVenueTypes: ['Event', 'Activity'],
  },
  {
    id: 'persona_mercy_wanjiku',
    name: 'Mercy Wanjiku',
    username: 'StarGazer1029',
    personalityType: 'event_enthusiast',
    preferredVenueTypes: ['Event', 'Club'],
  },
];

async function seedPersonas() {
  console.log(`\n🌱 Seeding ${PERSONAS.length} personas into Firestore...\n`);

  const batch = db.batch();

  for (const persona of PERSONAS) {
    const { id, ...data } = persona;
    const ref = db.collection('personas').doc(id);
    batch.set(ref, {
      ...data,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    console.log(`  ✓ Queued: ${persona.name} (@${persona.username}) [${persona.personalityType}]`);
  }

  await batch.commit();

  console.log(`\n✅ Successfully seeded ${PERSONAS.length} personas into Firestore 'personas' collection.\n`);

  // Verify
  const snap = await db.collection('personas').get();
  console.log(`📊 Verification: ${snap.size} personas now in Firestore.\n`);

  process.exit(0);
}

seedPersonas().catch((err) => {
  console.error('❌ Seeding failed:', err);
  process.exit(1);
});
