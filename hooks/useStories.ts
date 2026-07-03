import { useEffect, useState } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { firestore } from '../services/firebase';
import { StoryData } from '../services/storyService';
import { useAppStore } from './useAppStore';
import { prefetchStoriesMedia } from '../utils/mediaCache';

export const useStories = () => {
  const [stories, setStories] = useState<StoryData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const hiddenUsers = useAppStore((s) => s.hiddenUsers);

  useEffect(() => {
    // Only fetch stories where expires_at is greater than current time
    const now = new Date();
    
    // We fetch all non-expired stories. 
    // In production, we might want to query by venue or area, but fetching active stories is fine for this scale.
    const q = query(
      collection(firestore, 'stories'),
      where('expires_at', '>', now)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const activeStories: StoryData[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data() as StoryData;
        if (!hiddenUsers.includes(data.user_id)) {
          activeStories.push({
            id: doc.id,
            ...data
          });
        }
      });
      
      setStories(activeStories);
      setIsLoading(false);
      
      // Start background prefetching of all active stories' media files
      const mediaUrls = activeStories.map(s => s.media_url).filter(Boolean);
      prefetchStoriesMedia(mediaUrls);
    }, (error) => {
      console.error('Error fetching stories:', error);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [hiddenUsers]);

  return { stories, isLoading };
};
