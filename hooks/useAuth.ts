import { useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, firestore } from '../services/firebase';
import { useAppStore } from './useAppStore';

export const useAuth = () => {
  // Setters are stable references in zustand — selecting them individually
  // means this hook never re-renders its host (App) on store changes.
  const setUser = useAppStore((s) => s.setUser);
  const setIsLoading = useAppStore((s) => s.setIsLoading);
  const setIsAdmin = useAppStore((s) => s.setIsAdmin);
  const setHasAgreedToTerms = useAppStore((s) => s.setHasAgreedToTerms);
  const setHiddenUsers = useAppStore((s) => s.setHiddenUsers);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setIsLoading(true);
        setUser(user);
        try {
          const userDocRef = doc(firestore, 'users', user.uid);
          const userDoc = await getDoc(userDocRef);
          if (userDoc.exists()) {
            const userData = userDoc.data();
            setIsAdmin(userData.isAdmin === true);
            setHasAgreedToTerms(userData.agreedToTerms === true);
            setHiddenUsers(userData.hiddenUsers || []);
          } else {
            setIsAdmin(false);
            setHasAgreedToTerms(false);
            setHiddenUsers([]);
          }
        } catch (error) {
          console.error("Error fetching user data:", error);
          setUser(null);
          setIsAdmin(false);
          setHasAgreedToTerms(false);
          setHiddenUsers([]);
        }
      } else {
        setUser(null);
        setIsAdmin(false);
        setHasAgreedToTerms(false);
        setHiddenUsers([]);
      }
      setIsLoading(false);
    });

    // Cleanup subscription on unmount
    return () => unsubscribe();
  }, [setUser, setIsLoading, setIsAdmin, setHasAgreedToTerms, setHiddenUsers]);
};
