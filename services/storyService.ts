import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { firestore, storage } from './firebase';

export interface StoryData {
  id?: string;
  user_id: string;
  venue_id: string | null;
  media_url: string;
  media_type: 'image' | 'video';
  created_at: any;
  expires_at: any;
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

  const docRef = await addDoc(collection(firestore, 'stories'), {
    user_id: userId,
    venue_id: venueId,
    media_url: mediaUrl,
    media_type: mediaType,
    created_at: serverTimestamp(),
    expires_at: expiresAtDate,
  });

  return docRef.id;
};
