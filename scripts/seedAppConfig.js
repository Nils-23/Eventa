const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function seedAppConfig() {
  console.log("Seeding app_config in settings collection...");
  try {
    await db.collection('settings').doc('app_config').set({
      latestVersion: "1.0.2",
      minimumVersion: "1.0.2",
      androidUrl: "https://play.google.com/store/apps/details?id=com.nils23.Eventa",
      iosUrl: "https://apps.apple.com/app/eventas/id6769403503"
    });
    console.log("Successfully seeded settings/app_config!");
  } catch (error) {
    console.error("Error seeding app_config:", error);
  }
  process.exit(0);
}

seedAppConfig();
