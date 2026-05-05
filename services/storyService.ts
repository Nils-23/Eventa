import { collection, addDoc, serverTimestamp, doc, updateDoc, increment, getDoc } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { firestore, storage } from './firebase';
import { checkAndUnlockAchievements } from './achievementService';

export interface StoryData {
  id?: string;
  user_id: string;
  venue_id: string | null;
  media_url: string;
  media_type: 'image' | 'video';
  created_at: any;
  expires_at: any;
  activeBadge?: string;
}

export const uploadStoryMedia = async (uri: string, userId: string): Promise<string> => {
  const fileExtension = uri.split('.').pop() || 'jpg';
  const fileName = `stories/${userId}_${Date.now()}.${fileExtension}`;
  const storageRef = ref(storage, fileName);

  const response = await fetch(uri);
  const blob = await response.blob();

  const uploadTask = await uploadBytesResumable(storageRef, blob);
  return getDownloadURL(uploadTask.ref);
};

export const createStory = async (
  userId: string,
  mediaUrl: string,
  mediaType: 'image' | 'video',
  venueId: string | null
): Promise<string> => {
  // Calculate expiration time (24 hours from now)
  const expiresAtDate = new Date();
  expiresAtDate.setHours(expiresAtDate.getHours() + 24);

  const userDocRef = doc(firestore, 'users', userId);
  const userDocSnap = await getDoc(userDocRef);
  const activeBadge = userDocSnap.exists() ? userDocSnap.data().activeBadge : null;

  const docRef = await addDoc(collection(firestore, 'stories'), {
    user_id: userId,
    venue_id: venueId,
    media_url: mediaUrl,
    media_type: mediaType,
    created_at: serverTimestamp(),
    expires_at: expiresAtDate,
    ...(activeBadge ? { activeBadge } : {})
  });

  try {
    await updateDoc(userDocRef, {
      storyCount: increment(1)
    });
    await checkAndUnlockAchievements(userId);
  } catch (error) {
    console.error('Failed to update user story stats', error);
  }

  return docRef.id;
};

export const createSimulatedStory = async (
  mediaUrl: string,
  mediaType: 'image' | 'video',
  venueId: string | null
): Promise<string> => {
  // Calculate expiration time (24 hours from now)
  const expiresAtDate = new Date();
  expiresAtDate.setHours(expiresAtDate.getHours() + 24);

  const fakeUserId = `sim_admin_${Date.now()}`;

  const docRef = await addDoc(collection(firestore, 'stories'), {
    user_id: fakeUserId,
    venue_id: venueId,
    media_url: mediaUrl,
    media_type: mediaType,
    created_at: serverTimestamp(),
    expires_at: expiresAtDate,
    activeBadge: 'Admin'
  });

  return docRef.id;
};
