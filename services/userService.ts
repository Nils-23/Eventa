import { doc, getDoc } from 'firebase/firestore';
import { firestore } from './firebase';

const usernameCache: Record<string, string> = {};

/**
 * Fetches exactly the 'username' from the /users/ collection for a specific ID.
 * Implements a basic memory cache to avoid thrashing Firestore for stories built by the same author.
 */
export const fetchUsername = async (userId: string): Promise<string> => {
  if (usernameCache[userId]) {
    return usernameCache[userId];
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
  } catch (error) {
    console.error('Error fetching username:', error);
  }

  return 'Unknown';
};
