import { useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, firestore } from '../services/firebase';
import { useAppStore } from './useAppStore';

export const useAuth = () => {
  const { setUser, setIsLoading, setIsAdmin, setHasAgreedToTerms } = useAppStore();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);
      if (user) {
        try {
          const userDocRef = doc(firestore, 'users', user.uid);
          const userDoc = await getDoc(userDocRef);
          if (userDoc.exists()) {
            const userData = userDoc.data();
            setIsAdmin(userData.isAdmin === true);
            setHasAgreedToTerms(userData.agreedToTerms === true);
          } else {
            setIsAdmin(false);
            setHasAgreedToTerms(false);
          }
        } catch (error) {
          console.error("Error fetching user data:", error);
          setIsAdmin(false);
          setHasAgreedToTerms(false);
        }
      } else {
        setIsAdmin(false);
        setHasAgreedToTerms(false);
      }
      setIsLoading(false);
    });

    // Cleanup subscription on unmount
    return () => unsubscribe();
  }, [setUser, setIsLoading, setIsAdmin, setHasAgreedToTerms]);
};
