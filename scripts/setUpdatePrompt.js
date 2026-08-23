/**
 * Turns the in-app "update available" prompt on for a release.
 *
 * The prompt is driven entirely by settings/app_config — there is no code to
 * change per release. hooks/useVersionCheck.ts reads this document on launch and
 * compares the installed version against it:
 *
 *   installed < minimumVersion  -> forced prompt, the app is unusable until they update
 *   installed < latestVersion   -> soft prompt, dismissible (returns on next cold start)
 *
 * RUN THIS ONLY ONCE THE BUILD IS ACTUALLY DOWNLOADABLE ON BOTH STORES.
 * The prompt sends people to the store page. If the new version is still in
 * review, they arrive at the old one and there is nothing to install — and with
 * --forced they cannot use the app at all in the meantime. iOS and Android
 * approve at different times; the slower one decides when it is safe to run.
 *
 * Usage:
 *   node scripts/setUpdatePrompt.js --latest 1.0.8              # soft prompt
 *   node scripts/setUpdatePrompt.js --latest 1.0.8 --forced     # also blocks older versions
 *   node scripts/setUpdatePrompt.js --latest 1.0.8 --minimum 1.0.6
 *   node scripts/setUpdatePrompt.js --show                      # print live config, change nothing
 *
 * Nothing is written without --latest, and every run prints the before/after
 * and waits for confirmation unless --yes is passed.
 */
const admin = require('firebase-admin');
const readline = require('readline');
const serviceAccount = require('./serviceAccountKey.json');

if (admin.apps.length === 0) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();
const CONFIG_REF = db.collection('settings').doc('app_config');

const argOf = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
};
const hasFlag = (name) => process.argv.includes(`--${name}`);

/** Semver-ish compare on dot-separated numbers, matching useVersionCheck. */
const isOlder = (a, b) => {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x < y) return true;
    if (x > y) return false;
  }
  return false;
};

const confirm = (question) =>
  new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });

async function main() {
  const snap = await CONFIG_REF.get();
  const current = snap.exists ? snap.data() : {};

  console.log('\nLive settings/app_config:');
  console.log(JSON.stringify(current, null, 2));

  const latest = argOf('latest');
  if (!latest) {
    if (!hasFlag('show')) {
      console.log('\nNothing written. Pass --latest <version> to update, or --show to just read.');
    }
    return;
  }

  const forced = hasFlag('forced');
  const minimum = argOf('minimum') || (forced ? latest : current.minimumVersion || '1.0.0');

  if (isOlder(latest, minimum)) {
    console.error(`\nRefusing: latestVersion (${latest}) is older than minimumVersion (${minimum}).`);
    console.error('That forces everyone to update to a version that is already below the floor.');
    process.exitCode = 1;
    return;
  }
  if (current.latestVersion && isOlder(latest, current.latestVersion)) {
    console.error(`\nRefusing: latestVersion would go backwards (${current.latestVersion} -> ${latest}).`);
    process.exitCode = 1;
    return;
  }

  const next = { ...current, latestVersion: latest, minimumVersion: minimum };

  console.log('\nAbout to write:');
  console.log(`  latestVersion : ${current.latestVersion || '(unset)'} -> ${latest}`);
  console.log(`  minimumVersion: ${current.minimumVersion || '(unset)'} -> ${minimum}`);
  console.log(
    forced || isOlder(current.minimumVersion || '0.0.0', minimum)
      ? `\n  ⚠  Anyone below ${minimum} will be BLOCKED from using the app until they update.`
      : `\n  Anyone below ${latest} gets a dismissible prompt and can keep using the app.`
  );
  console.log('\n  Confirm the build is live and downloadable on BOTH stores before continuing.');

  if (!hasFlag('yes')) {
    const ok = await confirm('\nWrite this to production? (yes/no) ');
    if (!ok) {
      console.log('Aborted, nothing written.');
      return;
    }
  }

  await CONFIG_REF.set(next, { merge: true });
  console.log('\nDone. settings/app_config updated.');
  console.log('Clients pick it up on their next cold start (useVersionCheck runs once per launch).');
}

main()
  .catch((err) => {
    console.error('Failed:', err);
    process.exitCode = 1;
  })
  .finally(() => admin.app().delete().catch(() => {}));
