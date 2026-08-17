import { doc, setDoc, deleteDoc, onSnapshot, collection, query, where, orderBy } from 'firebase/firestore';
import { firestore } from './firebase';

/**
 * A user's saved ("remind me") event.
 *
 * One doc per (event, user), which is what scopes the reminder: the scheduled
 * sendSavedEventReminders function pushes to `userId` and nobody else, and the
 * security rules only let a user read or write rows carrying their own uid.
 *
 * The two reminded* flags are written ONLY by the server (rules reject a client
 * update), so a client can neither replay a reminder nor suppress one.
 */
export interface SavedEvent {
  eventId: string;
  userId: string;
  eventName: string;
  /** Epoch ms. null for a TBA event — saveable, but no reminder is possible. */
  startDate: number | null;
  savedAt: number;
  remindedDayBefore: boolean;
  remindedDayOf: boolean;
}

const savedEventDocId = (eventId: string, userId: string) => `${eventId}_${userId}`;

/**
 * Saves an event for a user. Deliberately a full overwrite rather than a merge:
 * re-saving something previously saved and unsaved must start with both reminder
 * flags false, or a re-save would inherit "already reminded" and stay silent.
 */
export async function saveEvent(
  eventId: string,
  eventName: string,
  startDate: number | null | undefined,
  userId: string
): Promise<void> {
  await setDoc(doc(firestore, 'savedEvents', savedEventDocId(eventId, userId)), {
    eventId,
    userId,
    eventName,
    startDate: typeof startDate === 'number' ? startDate : null,
    savedAt: Date.now(),
    remindedDayBefore: false,
    remindedDayOf: false,
  });
}

export async function unsaveEvent(eventId: string, userId: string): Promise<void> {
  await deleteDoc(doc(firestore, 'savedEvents', savedEventDocId(eventId, userId)));
}

/** Live "is this event saved by me" for the detail screen's button state. */
export function subscribeIsEventSaved(
  eventId: string,
  userId: string,
  cb: (saved: boolean) => void
): () => void {
  return onSnapshot(
    doc(firestore, 'savedEvents', savedEventDocId(eventId, userId)),
    (snap) => cb(snap.exists()),
    (err) => {
      console.warn('[savedEvents] subscribeIsEventSaved failed:', err);
      cb(false);
    }
  );
}

/** Every event this user has saved, soonest first. */
export function subscribeSavedEvents(
  userId: string,
  cb: (events: SavedEvent[]) => void
): () => void {
  const q = query(
    collection(firestore, 'savedEvents'),
    where('userId', '==', userId),
    orderBy('startDate', 'asc')
  );
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => d.data() as SavedEvent)),
    (err) => {
      console.warn('[savedEvents] subscribeSavedEvents failed:', err);
      cb([]);
    }
  );
}
