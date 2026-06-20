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
    username: 'zawa.m',
    personalityType: 'hype_person',
    preferredVenueTypes: ['Club', 'Bar'],
  },
  {
    id: 'persona_kofi_omondi',
    name: 'Kofi Omondi',
    username: 'kofi_ke',
    personalityType: 'hype_person',
    preferredVenueTypes: ['Club', 'Bar'],
  },
  {
    id: 'persona_shiku_wanjiru',
    name: 'Shiku Wanjiru',
    username: 'shiku.w',
    personalityType: 'hype_person',
    preferredVenueTypes: ['Club', 'Event'],
  },
  {
    id: 'persona_brian_kariuki',
    name: 'Brian Kariuki',
    username: 'brian_ke',
    personalityType: 'hype_person',
    preferredVenueTypes: ['Bar', 'Event'],
  },
  {
    id: 'persona_aisha_ndegwa',
    name: 'Aisha Ndegwa',
    username: 'aish.n',
    personalityType: 'hype_person',
    preferredVenueTypes: ['Club', 'Activity'],
  },
  {
    id: 'persona_kelvin_maina',
    name: 'Kelvin Maina',
    username: 'kelv.m',
    personalityType: 'hype_person',
    preferredVenueTypes: ['Club', 'Bar'],
  },
  {
    id: 'persona_ryan_kamande',
    name: 'Ryan Kamande',
    username: 'ryan.k',
    personalityType: 'hype_person',
    preferredVenueTypes: ['Bar', 'Club'],
  },

  // ── QUESTION ASKER ────────────────────────────────────────────────────────────
  {
    id: 'persona_mwenda_kamau',
    name: 'Mwenda Kamau',
    username: 'mwen.k',
    personalityType: 'question_asker',
    preferredVenueTypes: ['Bar', 'Activity'],
  },
  {
    id: 'persona_pendo_otieno',
    name: 'Pendo Otieno',
    username: 'pendo.o',
    personalityType: 'question_asker',
    preferredVenueTypes: ['Club', 'Bar'],
  },
  {
    id: 'persona_juma_njoroge',
    name: 'Juma Njoroge',
    username: 'juma_jr',
    personalityType: 'question_asker',
    preferredVenueTypes: ['Club', 'Event'],
  },
  {
    id: 'persona_tiffany_waweru',
    name: 'Tiffany Waweru',
    username: 'tiff.w',
    personalityType: 'question_asker',
    preferredVenueTypes: ['Bar', 'Activity'],
  },
  {
    id: 'persona_rashid_mwangi',
    name: 'Rashid Mwangi',
    username: 'rash.m',
    personalityType: 'question_asker',
    preferredVenueTypes: ['Event', 'Bar'],
  },
  {
    id: 'persona_lydia_chebet',
    name: 'Lydia Chebet',
    username: 'lydia.c',
    personalityType: 'question_asker',
    preferredVenueTypes: ['Activity', 'Bar'],
  },

  // ── OPINION GIVER ─────────────────────────────────────────────────────────────
  {
    id: 'persona_neema_achieng',
    name: 'Neema Achieng',
    username: 'neema_a',
    personalityType: 'opinion_giver',
    preferredVenueTypes: ['Club', 'Bar'],
  },
  {
    id: 'persona_cynthia_karanja',
    name: 'Cynthia Karanja',
    username: 'cynth.k',
    personalityType: 'opinion_giver',
    preferredVenueTypes: ['Club', 'Activity'],
  },
  {
    id: 'persona_felix_oduya',
    name: 'Felix Oduya',
    username: 'felix_od',
    personalityType: 'opinion_giver',
    preferredVenueTypes: ['Bar', 'Event'],
  },
  {
    id: 'persona_grace_wambui',
    name: 'Grace Wambui',
    username: 'grace.wb',
    personalityType: 'opinion_giver',
    preferredVenueTypes: ['Club', 'Event'],
  },
  {
    id: 'persona_shem_mutua',
    name: 'Shem Mutua',
    username: 'shem.m',
    personalityType: 'opinion_giver',
    preferredVenueTypes: ['Bar', 'Activity'],
  },
  {
    id: 'persona_otieno_obiero',
    name: 'Otieno Obiero',
    username: 'otie.o',
    personalityType: 'opinion_giver',
    preferredVenueTypes: ['Club', 'Event'],
  },

  // ── EVENT ENTHUSIAST ──────────────────────────────────────────────────────────
  {
    id: 'persona_amina_hassan',
    name: 'Amina Hassan',
    username: 'amina.h',
    personalityType: 'event_enthusiast',
    preferredVenueTypes: ['Event', 'Club'],
  },
  {
    id: 'persona_victor_njiru',
    name: 'Victor Njiru',
    username: 'vic.nj',
    personalityType: 'event_enthusiast',
    preferredVenueTypes: ['Event', 'Bar'],
  },
  {
    id: 'persona_stella_adhiambo',
    name: 'Stella Adhiambo',
    username: 'stell.a',
    personalityType: 'event_enthusiast',
    preferredVenueTypes: ['Event', 'Activity'],
  },
  {
    id: 'persona_benson_gacheru',
    name: 'Benson Gacheru',
    username: 'bens.g',
    personalityType: 'event_enthusiast',
    preferredVenueTypes: ['Event', 'Club'],
  },
  {
    id: 'persona_diana_njeri',
    name: 'Diana Njeri',
    username: 'diana.nj',
    personalityType: 'event_enthusiast',
    preferredVenueTypes: ['Event', 'Activity'],
  },
  {
    id: 'persona_mercy_wanjiku',
    name: 'Mercy Wanjiku',
    username: 'mercy.w',
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
