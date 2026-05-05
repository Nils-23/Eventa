const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

// Initialize Firebase Admin with Storage Bucket
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: 'eventa-211fb.firebasestorage.app' // From your error message
});

const db = admin.firestore();
const bucket = admin.storage().bucket();

async function cleanupTestStories() {
  console.log('Starting cleanup of test stories...');

  try {
    // 1. Delete all story documents from Firestore
    console.log('Fetching stories from Firestore...');
    const snapshot = await db.collection('stories').get();
    
    if (snapshot.empty) {
      console.log('No stories found in Firestore.');
    } else {
      const batch = db.batch();
      snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });
      await batch.commit();
      console.log(`✅ Deleted ${snapshot.size} story documents from Firestore.`);
    }

    // 2. Delete all files in the 'stories' folder in Firebase Storage
    console.log('Fetching files from Firebase Storage (stories/ folder)...');
    const [files] = await bucket.getFiles({ prefix: 'stories/' });
    
    if (files.length === 0) {
      console.log('No files found in the stories folder.');
    } else {
      const deletePromises = files.map(file => {
        return file.delete().catch(err => {
          console.error(`Failed to delete ${file.name}:`, err.message);
        });
      });
      
      await Promise.all(deletePromises);
      console.log(`✅ Deleted ${files.length} files from Firebase Storage.`);
    }

    console.log('🎉 Cleanup complete! Your storage quota should be freed up.');
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
  }
}

cleanupTestStories().catch(console.error);
