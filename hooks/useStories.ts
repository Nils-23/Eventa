import { useEffect, useState } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { firestore } from '../services/firebase';
import { StoryData } from '../services/storyService';

export const useStories = () => {
  const [stories, setStories] = useState<StoryData[]>([]);
  const [isLoading, setIsLoading] = useState(true);

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
        activeStories.push({
          id: doc.id,
          ...doc.data()
        } as StoryData);
      });
      
      setStories(activeStories);
      setIsLoading(false);
    }, (error) => {
      console.error('Error fetching stories:', error);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  return { stories, isLoading };
};
