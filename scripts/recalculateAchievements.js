const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const ACTIVITY_BADGES = {
  act_1: { target: 10 },
  act_3: { target: 50 },
  act_5: { target: 100 },
  act_10: { target: 250 }
};

async function recalculate() {
  const usersRef = db.collection('users');
  const snapshot = await usersRef.get();
  
  console.log(`Analyzing ${snapshot.size} users for achievement recalculation...`);
  
  const batch = db.batch();
  let updateCount = 0;
  
  snapshot.forEach(doc => {
    const data = doc.data();
    const points = data.points || 0;
    const oldUnlocked = data.unlockedAchievements || [];
    const activeBadge = data.activeBadge;
    
    // Filter out existing activity badges
    const nonActivity = oldUnlocked.filter(id => !ACTIVITY_BADGES.hasOwnProperty(id));
    
    // Calculate new activity badges based on current points
    const newActivity = [];
    if (points >= 10) newActivity.push('act_1');
    if (points >= 50) newActivity.push('act_3');
    if (points >= 100) newActivity.push('act_5');
    if (points >= 250) newActivity.push('act_10');
    
    // Merge
    const newUnlocked = [...nonActivity, ...newActivity];
    
    // Check if active badge is still valid
    let newActiveBadge = activeBadge;
    if (activeBadge && !newUnlocked.includes(activeBadge)) {
      // If the old active badge was revoked, fallback to the latest valid achievement or null
      newActiveBadge = newUnlocked.length > 0 ? newUnlocked[newUnlocked.length - 1] : null;
    }
    
    // Determine if updates are needed
    const oldSet = new Set(oldUnlocked);
    const newSet = new Set(newUnlocked);
    
    let isDifferent = oldUnlocked.length !== newUnlocked.length ||
                      [...oldSet].some(x => !newSet.has(x)) ||
                      activeBadge !== newActiveBadge;
                      
    if (isDifferent) {
      console.log(`User: ${data.username || doc.id} (Points: ${points})`);
      console.log(`  Old Achievements: [${oldUnlocked.join(', ')}]`);
      console.log(`  New Achievements: [${newUnlocked.join(', ')}]`);
      if (activeBadge !== newActiveBadge) {
        console.log(`  Active Badge updated: ${activeBadge} -> ${newActiveBadge}`);
      }
      
      batch.update(doc.ref, {
        unlockedAchievements: newUnlocked,
        activeBadge: newActiveBadge !== undefined ? newActiveBadge : null
      });
      updateCount++;
    }
  });
  
  if (updateCount > 0) {
    await batch.commit();
    console.log(`Successfully updated ${updateCount} users.`);
  } else {
    console.log('No users required updates.');
  }
}

recalculate().catch(console.error);
