import { collection, addDoc, serverTimestamp, doc, updateDoc } from 'firebase/firestore';
import { ref, remove } from 'firebase/database';
import { firestore, realtimeDB } from './firebase';
import { deleteStory } from './storyService';

export interface ReportData {
  id?: string;
  reporterId: string;
  reportedUserId: string | null;
  contentType: 'chat' | 'post' | 'venue';
  contentId: string;
  contentSnippet: string;
  venueId?: string;
  reason: string;
  timestamp: any;
  status: 'pending' | 'resolved' | 'dismissed';
}

/**
 * Creates a new content report in Firestore.
 */
export const createReport = async (
  reporterId: string,
  reportedUserId: string | null,
  contentType: 'chat' | 'post' | 'venue',
  contentId: string,
  contentSnippet: string,
  venueId?: string,
  reason: string = 'Inappropriate content'
): Promise<string> => {
  try {
    const docRef = await addDoc(collection(firestore, 'reports'), {
      reporterId,
      reportedUserId,
      contentType,
      contentId,
      contentSnippet,
      venueId: venueId || null,
      reason,
      timestamp: serverTimestamp(),
      status: 'pending',
    });
    return docRef.id;
  } catch (error) {
    console.error('Error creating report:', error);
    throw error;
  }
};

/**
 * Dismisses a report by setting its status to 'dismissed'.
 */
export const dismissReport = async (reportId: string): Promise<void> => {
  try {
    const reportRef = doc(firestore, 'reports', reportId);
    await updateDoc(reportRef, { status: 'dismissed' });
  } catch (error) {
    console.error('Error dismissing report:', error);
    throw error;
  }
};

/**
 * Resolves a report by hiding/removing the offending content.
 */
export const resolveReportWithContentRemoval = async (
  reportId: string,
  contentType: 'chat' | 'post' | 'venue',
  contentId: string,
  venueId?: string
): Promise<void> => {
  try {
    if (contentType === 'chat') {
      if (!venueId) throw new Error('Missing venueId for RTDB chat deletion');
      const chatMsgRef = ref(realtimeDB, `venue_chats/${venueId}/${contentId}`);
      await remove(chatMsgRef);
    } else if (contentType === 'post') {
      await deleteStory(contentId);
    } else if (contentType === 'venue') {
      const venueRef = doc(firestore, 'venues', contentId);
      await updateDoc(venueRef, { hidden: true });
    }

    // Update report status
    const reportRef = doc(firestore, 'reports', reportId);
    await updateDoc(reportRef, { status: 'resolved' });
  } catch (error) {
    console.error('Error removing reported content:', error);
    throw error;
  }
};

/**
 * Resolves a report by suspending the violating user.
 */
export const resolveReportWithUserSuspension = async (
  reportId: string,
  reportedUserId: string
): Promise<void> => {
  try {
    const userRef = doc(firestore, 'users', reportedUserId);
    await updateDoc(userRef, { suspended: true });

    // Update report status
    const reportRef = doc(firestore, 'reports', reportId);
    await updateDoc(reportRef, { status: 'resolved' });
  } catch (error) {
    console.error('Error suspending reported user:', error);
    throw error;
  }
};
