import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { firestore } from './firebase';

const usernameCache: Record<string, string> = {};

/**
 * Fetches exactly the 'username' from the /users/ collection for a specific ID.
 * Implements a basic memory cache to avoid thrashing Firestore for stories built by the same author.
 */
export const fetchUsername = async (userId: string): Promise<string> => {
  if (!userId) return 'Unknown';
  
  if (usernameCache[userId]) {
    return usernameCache[userId];
  }

  if (userId.startsWith('sim_')) {
    const simName = `SimUser_${userId.split('_').pop()}`;
    usernameCache[userId] = simName;
    return simName;
  }

  try {
    const userDocRef = doc(firestore, 'users', userId);
    const docSnap = await getDoc(userDocRef);

    if (docSnap.exists()) {
      const data = docSnap.data();
      const username = data.username || 'EventGoer';
      usernameCache[userId] = username;
      return username;
    }
  } catch (error: any) {
    if (error.code === 'permission-denied') {
      console.warn(`Permission denied when fetching username for ${userId}. Using fallback.`);
    } else {
      console.error('Error fetching username:', error);
    }
  }

  return 'Unknown';
};

/**
 * Updates the username for a specific user in Firestore and updates the cache.
 */
export const updateUsername = async (userId: string, newUsername: string): Promise<void> => {
  try {
    const userDocRef = doc(firestore, 'users', userId);
    await updateDoc(userDocRef, { username: newUsername });
    usernameCache[userId] = newUsername;
  } catch (error) {
    console.error('Error updating username:', error);
    throw error;
  }
};
