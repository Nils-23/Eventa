/**
 * testRehost.js — quick check that the service account can upload to Storage.
 * Downloads an image URL and re-uploads it to curator/test/, prints the URL.
 *
 * Usage: node scripts/testRehost.js "https://example.com/poster.jpg"
 * If no URL is given, uses the Novotel poster as a default.
 */
const crypto = require('crypto');
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

const STORAGE_BUCKET = 'eventa-211fb.firebasestorage.app';
if (admin.apps.length === 0) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount), storageBucket: STORAGE_BUCKET });
}
const bucket = admin.storage().bucket();

function extFromContentType(ct) {
  const t = String(ct || '').toLowerCase();
  if (t.includes('png')) return 'png';
  if (t.includes('webp')) return 'webp';
  if (t.includes('gif')) return 'gif';
  return 'jpg';
}

(async () => {
  const src = process.argv[2] || 'https://standupcollective.co.ke/media/Double%20Trouble%20with%20the%20Mainas.png';
  console.log('Downloading:', src);
  const res = await fetch(src, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'image/*,*/*;q=0.8' } });
  if (!res.ok) { console.error('fetch failed:', res.status); process.exit(1); }
  const ct = res.headers.get('content-type') || '';
  const buf = Buffer.from(await res.arrayBuffer());
  console.log(`Got ${buf.length} bytes (${ct})`);

  const ext = extFromContentType(ct);
  const path = `curator/test/rehost-check-${Date.now()}.${ext}`;
  const token = crypto.randomUUID();
  await bucket.file(path).save(buf, { resumable: false, contentType: ct, metadata: { metadata: { firebaseStorageDownloadTokens: token } } });

  const url = `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
  console.log('\n✅ Upload OK. Public URL:\n' + url);
  console.log('\nOpen that URL in a browser — if the image loads, re-hosting works.');
  process.exit(0);
})().catch((e) => { console.error('❌ test failed:', e.message); process.exit(1); });
