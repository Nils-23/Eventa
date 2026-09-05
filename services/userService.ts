import {
  doc,
  getDoc,
  onSnapshot,
  updateDoc,
  arrayUnion,
  arrayRemove,
  addDoc,
  collection,
  query,
  where,
  limit,
  getDocs,
  serverTimestamp,
} from 'firebase/firestore';
import { firestore } from './firebase';
import { getSimPersona } from './simPersonas';

const NIGHTLIFE_NAMES = [
  'NightOwl', 'PartyAnimal', 'VibeCheck', 'Raver', 'ClubHopper',
  'MidnightRider', 'NeonSoul', 'BassDrop', 'GrooveMaster', 'MoonlightViber',
  'StarGazer', 'RhythmJunkie', 'VibeChaser', 'BeatRider'
];

/** Shown for a real account whose document carries no username yet. */
export const FALLBACK_USERNAME = 'EventGoer';

/**
 * ─── Live username registry ────────────────────────────────────────────────
 *
 * Usernames used to be read once and memoised forever, and every surface that
 * showed a name (chat messages, replies, reactions, reviews) stored the string
 * it read at write time. A rename therefore never reached anything already on
 * screen or already written: a user who renamed still appeared under the
 * auto-generated name they were given at sign-up — the "my username changed by
 * itself" reports — and the two names coexisted indefinitely.
 *
 * Names are now resolved through per-user Firestore listeners. A rename lands
 * on every device and every surface within one snapshot, with no sign-out and
 * no app restart. The cache below is the shared read-through layer for those
 * listeners; entries are corrected by the listener rather than trusted forever,
 * and `clearUsernameCache` drops the lot when the session ends so the next
 * account on the device cannot inherit them.
 */
type UsernameListener = (username: string) => void;

const usernameCache: Record<string, string> = {};
const listeners: Record<string, Set<UsernameListener>> = {};
const liveUnsubs: Record<string, () => void> = {};

/**
 * Names that are derived from the id itself and can never change: the admin's
 * fixed persona roster, then the generic `sim_` pool. Resolved before any
 * Firestore work because these ids have no user document to listen to.
 */
const resolveStaticUsername = (userId: string): string | null => {
  const rosterPersona = getSimPersona(userId);
  if (rosterPersona) return rosterPersona.name;

  if (userId.startsWith('sim_')) {
    const numStr = userId.split('_').pop() || '0';
    const number = parseInt(numStr, 10) || 0;
    const baseName = NIGHTLIFE_NAMES[number % NIGHTLIFE_NAMES.length];
    return `${baseName}${number}`;
  }
  return null;
};

const publishUsername = (userId: string, username: string) => {
  usernameCache[userId] = username;
  listeners[userId]?.forEach((cb) => cb(username));
};

/**
 * The name for a user if one is already known locally, otherwise null. Lets a
 * list render the right name on its first frame instead of flashing the stale
 * value stored on the message.
 */
export const getCachedUsername = (userId: string): string | null => {
  if (!userId) return null;
  return resolveStaticUsername(userId) ?? usernameCache[userId] ?? null;
};

/**
 * Subscribes to a user's current display name. Calls back immediately with a
 * known value (if any) and again on every change, for as long as the returned
 * unsubscribe has not been called. Listeners are shared per user id, so a chat
 * full of one person's messages costs exactly one Firestore listener.
 */
export const subscribeUsername = (
  userId: string,
  onChange: UsernameListener
): (() => void) => {
  if (!userId) return () => {};

  const staticName = resolveStaticUsername(userId);
  if (staticName) {
    onChange(staticName);
    return () => {};
  }

  const known = usernameCache[userId];
  if (known) onChange(known);

  if (!listeners[userId]) listeners[userId] = new Set();
  listeners[userId].add(onChange);

  if (!liveUnsubs[userId]) {
    liveUnsubs[userId] = onSnapshot(
      doc(firestore, 'users', userId),
      (snap) => {
        if (!snap.exists()) return;
        publishUsername(userId, snap.data().username || FALLBACK_USERNAME);
      },
      (error) => {
        // A name we cannot re-read is not a name that changed: keep whatever is
        // cached rather than downgrading every message to a placeholder.
        console.warn(`[userService] Username listener failed for ${userId}:`, error?.code || error);
      }
    );
  }

  return () => {
    const set = listeners[userId];
    if (!set) return;
    set.delete(onChange);
    if (set.size > 0) return;
    delete listeners[userId];
    liveUnsubs[userId]?.();
    delete liveUnsubs[userId];
  };
};

/**
 * One-shot read, for the places that genuinely cannot hold a subscription.
 * Prefer `subscribeUsername` (or the `useUsername`/`useUsernames` hooks) for
 * anything rendered, and `requireUsername` for anything written.
 */
export const fetchUsername = async (userId: string): Promise<string> => {
  if (!userId) return 'Unknown';

  const known = getCachedUsername(userId);
  if (known) return known;

  try {
    const docSnap = await getDoc(doc(firestore, 'users', userId));
    if (docSnap.exists()) {
      const username = docSnap.data().username || FALLBACK_USERNAME;
      publishUsername(userId, username);
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
 * The name to stamp on something being written (a chat message, a review).
 *
 * Throws rather than falling back: a transient offline or permission-denied
 * read used to be persisted as the literal string "Unknown" on the message,
 * which then outlived the outage — another way a user's name silently became
 * something they never chose. Callers surface the failure instead.
 */
export const requireUsername = async (userId: string): Promise<string> => {
  const known = getCachedUsername(userId);
  if (known) return known;

  const docSnap = await getDoc(doc(firestore, 'users', userId));
  if (!docSnap.exists()) {
    throw new Error("We couldn't load your profile, so nothing was sent under the wrong name. Check your connection and try again.");
  }
  const username = docSnap.data().username || FALLBACK_USERNAME;
  publishUsername(userId, username);
  return username;
};

/**
 * Drops every cached name and tears down the listeners. Called on sign-out:
 * this cache is process-wide, so without it the next account signed in on the
 * device starts out reading the previous one's names.
 */
export const clearUsernameCache = () => {
  Object.values(liveUnsubs).forEach((unsub) => unsub());
  Object.keys(liveUnsubs).forEach((k) => delete liveUnsubs[k]);
  Object.keys(listeners).forEach((k) => delete listeners[k]);
  Object.keys(usernameCache).forEach((k) => delete usernameCache[k]);
};

/** Reserved words and system placeholders nobody may take as a username. */
const RESERVED_USERNAMES = [
  'you', 'someone', 'unknown', 'anonymous', 'admin', 'eventas', 'eventgoer', 'deleted user',
];

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;

/** The rules, in the words the user is shown while typing. */
export const USERNAME_RULES = `${USERNAME_MIN}–${USERNAME_MAX} characters. Letters, numbers, spaces, dots, dashes and underscores.`;

// Letters, numbers and light punctuation, with single internal spaces
// allowed; must start and end on a letter or number.
const USERNAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._\- ]*[A-Za-z0-9])?$/;
const ALLOWED_CHARS = /^[A-Za-z0-9._\- ]*$/;

/**
 * Everything the UI needs to explain a candidate name to the user:
 *
 *  - `normalized` — what would actually be saved.
 *  - `error`      — why it cannot be saved, phrased for the user.
 *  - `notice`     — an accepted name that will not be saved exactly as typed,
 *                   and what will change about it.
 *
 * Split out from the throwing validator on purpose. Silently tidying someone's
 * input, or greying out a button with no explanation, is the same failure mode
 * as the rename bug itself: the name they end up with is not the one they
 * believe they chose. The rules are stated up front, the input is checked as
 * they type, and any adjustment is named before and after saving.
 */
export const inspectUsername = (
  candidate: string
): { normalized: string; error: string | null; notice: string | null } => {
  const raw = candidate || '';
  // Runs of whitespace collapse to one space, so "Night   Owl" and
  // "Night Owl" cannot coexist as two different-looking names.
  const normalized = raw.trim().replace(/\s+/g, ' ');

  const fail = (error: string) => ({ normalized, error, notice: null });

  if (normalized.length === 0) return fail('Please enter a username.');
  if (normalized.length < USERNAME_MIN) {
    const missing = USERNAME_MIN - normalized.length;
    return fail(`Too short — ${missing} more character${missing === 1 ? '' : 's'} needed (minimum ${USERNAME_MIN}).`);
  }
  if (normalized.length > USERNAME_MAX) {
    const over = normalized.length - USERNAME_MAX;
    return fail(`Too long by ${over} character${over === 1 ? '' : 's'} — the maximum is ${USERNAME_MAX}.`);
  }
  if (!ALLOWED_CHARS.test(normalized)) {
    const offenders = Array.from(new Set(normalized.split('').filter((c) => !ALLOWED_CHARS.test(c))));
    return fail(`"${offenders.join('" "')}" can't be used. Letters, numbers, spaces, dots, dashes and underscores only.`);
  }
  if (!USERNAME_PATTERN.test(normalized)) {
    return fail('A username has to start and end with a letter or number.');
  }
  if (RESERVED_USERNAMES.includes(normalized.toLowerCase())) {
    return fail(`"${normalized}" is reserved by the app — please pick another.`);
  }

  // Accepted, but not character-for-character what they typed. Say so rather
  // than quietly changing it under them.
  let notice: string | null = null;
  if (normalized !== raw) {
    const trimmed = raw !== raw.trim();
    const collapsed = /\s{2,}/.test(raw.trim());
    if (collapsed && trimmed) {
      notice = `Will be saved as "${normalized}" — extra spaces removed.`;
    } else if (collapsed) {
      notice = `Will be saved as "${normalized}" — repeated spaces become one.`;
    } else if (trimmed) {
      notice = `Will be saved as "${normalized}" — spaces at the start or end are removed.`;
    } else {
      notice = `Will be saved as "${normalized}".`;
    }
  }

  return { normalized, error: null, notice };
};

/**
 * Throwing wrapper for callers that just need a valid name or an exception.
 */
export const validateUsername = (candidate: string): string => {
  const { normalized, error } = inspectUsername(candidate);
  if (error) throw new Error(error);
  return normalized;
};

/**
 * True when somebody other than `userId` already answers to this name.
 * `usernameLower` is written alongside every rename from here on, so the check
 * is case-insensitive for any account that has been renamed since; the exact
 * match covers everyone else.
 */
const isUsernameTaken = async (userId: string, name: string): Promise<boolean> => {
  const users = collection(firestore, 'users');
  const [exact, lower] = await Promise.all([
    getDocs(query(users, where('username', '==', name), limit(2))),
    getDocs(query(users, where('usernameLower', '==', name.toLowerCase()), limit(2))),
  ]);
  return [...exact.docs, ...lower.docs].some((d) => d.id !== userId);
};

/**
 * Renames a user. The write is mirrored into the live registry immediately, so
 * the new name is on screen before the round trip completes and everywhere else
 * the moment the snapshot lands — no sign-out, no restart.
 */
export const updateUsername = async (
  userId: string,
  newUsername: string
): Promise<{ username: string; changed: boolean; adjusted: boolean }> => {
  const { normalized: name, error } = inspectUsername(newUsername);
  if (error) throw new Error(error);

  const previous = usernameCache[userId];
  const adjusted = name !== (newUsername || '');

  if (previous === name) return { username: name, changed: false, adjusted };

  if (await isUsernameTaken(userId, name)) {
    throw new Error(`"${name}" is already taken by another user. Please pick a different one.`);
  }

  publishUsername(userId, name);
  try {
    await updateDoc(doc(firestore, 'users', userId), {
      username: name,
      usernameLower: name.toLowerCase(),
    });
    return { username: name, changed: true, adjusted };
  } catch (error) {
    // Put the old name back rather than leaving the UI showing one the server
    // never accepted.
    if (previous) publishUsername(userId, previous);
    console.error('Error updating username:', error);
    throw error;
  }
};

/**
 * Returns the points key string for the current month, formatted as points_YYYY_MM
 */
export const getMonthlyPointsKey = (): string => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `points_${year}_${month}`;
};

/**
 * Hides/blocks a user. Adds their userId to the current user's hiddenUsers array,
 * and creates a "user_hidden" event record in the reports collection.
 */
export const hideUser = async (currentUserId: string, targetUserId: string): Promise<void> => {
  try {
    const userDocRef = doc(firestore, 'users', currentUserId);
    await updateDoc(userDocRef, {
      hiddenUsers: arrayUnion(targetUserId)
    });

    // Create record on action
    await addDoc(collection(firestore, 'reports'), {
      reporterId: currentUserId,
      reportedUserId: targetUserId,
      contentType: 'user_hidden',
      contentId: targetUserId,
      contentSnippet: `User blocked/hidden by reporter`,
      reason: 'User hidden/blocked',
      timestamp: serverTimestamp(),
      status: 'pending',
    });
  } catch (error) {
    console.error('Error hiding user:', error);
    throw error;
  }
};

/**
 * Unhides/unblocks a user by removing their userId from hiddenUsers.
 */
export const unhideUser = async (currentUserId: string, targetUserId: string): Promise<void> => {
  try {
    const userDocRef = doc(firestore, 'users', currentUserId);
    await updateDoc(userDocRef, {
      hiddenUsers: arrayRemove(targetUserId)
    });
  } catch (error) {
    console.error('Error unhiding user:', error);
    throw error;
  }
};

