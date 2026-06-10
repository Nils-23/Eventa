const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

// Initialize Firebase Admin
if (admin.apps.length === 0) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

async function setVersionConfig(mode) {
  let latestVersion = "1.0.3";
  let minimumVersion = "1.0.3";

  if (mode === 'forced') {
    latestVersion = "1.0.4";
    minimumVersion = "1.0.4";
    console.log("Setting app_config for FORCED update (latest: 1.0.4, minimum: 1.0.4)");
  } else if (mode === 'flexible') {
    latestVersion = "1.0.4";
    minimumVersion = "1.0.3";
    console.log("Setting app_config for FLEXIBLE update (latest: 1.0.4, minimum: 1.0.3)");
  } else if (mode === 'none') {
    latestVersion = "1.0.3";
    minimumVersion = "1.0.2";
    console.log("Setting app_config for NO update prompt (latest: 1.0.3, minimum: 1.0.2)");
  } else {
    latestVersion = "1.0.3";
    minimumVersion = "1.0.3";
    console.log("Setting app_config to DEFAULT values (latest: 1.0.3, minimum: 1.0.3)");
  }

  try {
    await db.collection('settings').doc('app_config').set({
      latestVersion,
      minimumVersion,
      androidUrl: "https://play.google.com/store/apps/details?id=com.nils23.Eventa",
      iosUrl: "https://apps.apple.com/app/eventas/id6769403503"
    }, { merge: true });
    console.log("Successfully updated settings/app_config in Firestore!");
  } catch (error) {
    console.error("Error updating app_config:", error);
  }
  process.exit(0);
}

const mode = process.argv[2];
setVersionConfig(mode);
