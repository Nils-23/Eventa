import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { firestore } from './firebase';

/**
 * Venue reviews.
 *
 * Two rules shape everything here:
 *
 * 1. Only someone the app watched arrive can review. Eligibility is a `visits`
 *    doc — written by useVisitTracker when GPS put the user inside
 *    VISIT_RADIUS of the venue — inside REVIEW_WINDOW_DAYS. This is the whole
 *    point of doing reviews in a venue app rather than pointing people at
 *    Google: nobody can review a room they were never in, which removes
 *    competitor-bombing and drive-by spam at the source instead of moderating
 *    them afterwards.
 *
 * 2. Only real accounts. Simulated personas drive the crowd counts and the
 *    chat, which are ambient and expire; a review is a durable, attributed
 *    claim of fact about a named business. The firestore rules reject any
 *    reviewer id carrying a sim_/persona_ prefix, so the admin's "post as
 *    simulated user" path cannot reach this collection even by accident.
 *
 * The answers are taps, not prose. A text box gets a couple of percent of
 * visitors; four taps get a third of them, and the result is queryable — "cheap
 * and no queue tonight" is a filter, a paragraph is not. Free text is also what
 * creates the moderation and legal surface, so it is deliberately absent until
 * the volume justifies it.
 */

// How long after a visit the user can still review it. Long enough to catch
// someone who opens the app days later, short enough that the review is about a
// night they actually remember.
export const REVIEW_WINDOW_DAYS = 14;
const REVIEW_WINDOW_MS = REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000;

export type CrowdAnswer = 'dead' | 'chill' | 'buzzing' | 'packed';
export type EntryAnswer = 'walked_in' | 'short_queue' | 'long_queue' | 'turned_away';
export type PriceAnswer = 'cheap' | 'fair' | 'steep';
export type VibeAnswer = CrowdAnswer | EntryAnswer | PriceAnswer;

export interface ReviewAnswers {
  crowd?: CrowdAnswer;
  entry?: EntryAnswer;
  price?: PriceAnswer;
  wouldReturn?: boolean;
}

export interface Review extends ReviewAnswers {
  id: string;
  userId: string;
  username: string;
  venueId: string;
  venueName: string;
  /** Nairobi day key of the visit being reviewed, e.g. "2026-08-18". */
  visitDayKey: string;
  visitedAt: number;
  createdAt?: any;
  updatedAt?: any;
  status: 'visible' | 'hidden';
}

/** Aggregate written onto the venue doc by the onReviewWritten function. */
export interface ReviewStats {
  count: number;
  recentCount: number;
  wouldReturnPct: number | null;
  crowd: Record<string, number>;
  entry: Record<string, number>;
  price: Record<string, number>;
  updatedAt?: any;
}

export interface ReviewEligibility {
  canReview: boolean;
  visitDayKey?: string;
  visitedAt?: number;
  /** An existing review for this venue, so the sheet opens on their answers. */
  existing?: Review | null;
}

// One review per user per venue. A returning regular edits their answer rather
// than stacking a second one — otherwise a venue's aggregate is just a count of
// how often its regulars opened the app.
const reviewId = (userId: string, venueId: string) => `${userId}_${venueId}`;

/** Human-readable labels, shared by the sheet and the venue summary. */
export const ANSWER_LABELS: Record<string, string> = {
  dead: 'Dead',
  chill: 'Chill',
  buzzing: 'Buzzing',
  packed: 'Packed',
  walked_in: 'Walked in',
  short_queue: 'Short queue',
  long_queue: 'Long queue',
  turned_away: 'Turned away',
  cheap: 'Cheap',
  fair: 'Fair',
  steep: 'Steep',
};

/**
 * Can this user review this venue right now, and have they already?
 *
 * Reads the most recent `visits` row for the pair. The visit ledger is written
 * per user/venue/day, so this is a single indexed query rather than a scan of
 * the user's whole history.
 */
export async function getReviewEligibility(
  userId: string,
  venueId: string
): Promise<ReviewEligibility> {
  if (!userId || !venueId) return { canReview: false };

  try {
    const visitSnap = await getDocs(
      query(
        collection(firestore, 'visits'),
        where('userId', '==', userId),
        where('venueId', '==', venueId),
        orderBy('visitedAt', 'desc'),
        limit(1)
      )
    );

    const existing = await getMyReview(userId, venueId);
    if (visitSnap.empty) return { canReview: false, existing };

    const visit = visitSnap.docs[0].data() as { visitedAt: number; dayKey: string };
    const withinWindow = Date.now() - visit.visitedAt <= REVIEW_WINDOW_MS;

    return {
      canReview: withinWindow,
      visitDayKey: visit.dayKey,
      visitedAt: visit.visitedAt,
      existing,
    };
  } catch (err) {
    console.warn('[reviewService] Eligibility check failed:', err);
    return { canReview: false };
  }
}

export async function getMyReview(userId: string, venueId: string): Promise<Review | null> {
  try {
    const snap = await getDoc(doc(firestore, 'reviews', reviewId(userId, venueId)));
    return snap.exists() ? ({ id: snap.id, ...(snap.data() as Omit<Review, 'id'>) }) : null;
  } catch (err) {
    console.warn('[reviewService] Failed to load own review:', err);
    return null;
  }
}

/**
 * Writes (or replaces) the user's review of a venue.
 *
 * `merge: true` on a stable id makes editing and first-time submission the same
 * write, which is also what keeps the aggregate honest — the trigger recomputes
 * from the collection, so an edit can never double-count.
 */
export async function submitReview(params: {
  userId: string;
  username: string;
  venueId: string;
  venueName: string;
  visitDayKey: string;
  visitedAt: number;
  answers: ReviewAnswers;
}): Promise<void> {
  const { userId, username, venueId, venueName, visitDayKey, visitedAt, answers } = params;

  await setDoc(
    doc(firestore, 'reviews', reviewId(userId, venueId)),
    {
      userId,
      username,
      venueId,
      venueName,
      visitDayKey,
      visitedAt,
      ...answers,
      status: 'visible',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/** Most recent visible reviews for a venue, newest first. */
export async function getVenueReviews(venueId: string, max = 20): Promise<Review[]> {
  try {
    const snap = await getDocs(
      query(
        collection(firestore, 'reviews'),
        where('venueId', '==', venueId),
        where('status', '==', 'visible'),
        orderBy('visitedAt', 'desc'),
        limit(max)
      )
    );
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Review, 'id'>) }));
  } catch (err) {
    console.warn('[reviewService] Failed to load venue reviews:', err);
    return [];
  }
}

/**
 * The single line a venue card can show: the most-picked answer per attribute.
 * Reads the denormalized aggregate rather than the reviews themselves, so a
 * card costs one document it has already loaded.
 */
export function summarizeStats(stats?: ReviewStats | null): {
  count: number;
  headline: string | null;
  wouldReturnPct: number | null;
} {
  if (!stats || !stats.count) return { count: 0, headline: null, wouldReturnPct: null };

  const topOf = (bucket?: Record<string, number>): string | null => {
    if (!bucket) return null;
    const entries = Object.entries(bucket).filter(([, n]) => n > 0);
    if (entries.length === 0) return null;
    entries.sort((a, b) => b[1] - a[1]);
    return ANSWER_LABELS[entries[0][0]] || entries[0][0];
  };

  const parts = [topOf(stats.crowd), topOf(stats.entry), topOf(stats.price)].filter(Boolean);
  return {
    count: stats.count,
    headline: parts.length ? parts.join(' · ') : null,
    wouldReturnPct: stats.wouldReturnPct,
  };
}
