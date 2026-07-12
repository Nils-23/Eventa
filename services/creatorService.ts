/**
 * creatorService — the Creator Program's single source of truth.
 *
 * Account model:
 *   - Every account starts as a normal user (no accountType field, or 'user').
 *   - users/{uid}.accountType === 'creator' unlocks creator features. The flag is
 *     read via a real-time listener (useCreatorStatus), so admin revocation takes
 *     effect immediately on the client.
 *   - The applicant's FULL NAME lives ONLY on the application doc
 *     (creatorApplications), which is an admin-only surface. It is never copied
 *     to the public user doc — the public profile shows the Creator/Stage name.
 *
 * Collections:
 *   creatorApplications/{uid}   one application per user (doc id = uid)
 *   creators/{uid}              referral stats doc — SAME collection the existing
 *                               affiliate pipeline (inviteRedirect, registerInstall,
 *                               onUserCreated) already reads/writes, so approved
 *                               creators plug into install/signup attribution with
 *                               no extra backend work.
 *   creatorAttendance/{eventId_uid}  "I'm Going" declarations, verified later by
 *                               the geofence visit tracker.
 *
 * Modularity: future creator features (brand partnerships, campaigns, paid
 * promotions, venue invitations) should add new collections/fields and new
 * service functions here — the account gate (isCreator) and the profile shape
 * (CreatorProfile) are the only shared contracts.
 */

import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where,
  getDocs, onSnapshot, orderBy, serverTimestamp, writeBatch, limit,
} from 'firebase/firestore';
import { firestore } from './firebase';

// ─── Official accounts (update if the handles change) ────────────────────────
export const OFFICIAL_INSTAGRAM_USERNAME = 'eventas.app';
export const OFFICIAL_TIKTOK_USERNAME = 'eventas.app';
export const INSTAGRAM_DM_URL = `https://instagram.com/${OFFICIAL_INSTAGRAM_USERNAME}`;
export const TIKTOK_DM_URL = `https://www.tiktok.com/@${OFFICIAL_TIKTOK_USERNAME}`;

// ─── Types ────────────────────────────────────────────────────────────────────

export type CreatorPlatform = 'instagram' | 'tiktok';
export type ApplicationStatus = 'pending' | 'approved' | 'rejected';

export const CREATOR_CATEGORIES = [
  'Nightlife', 'Food', 'Lifestyle', 'Photography', 'Music',
  'Fashion', 'Comedy', 'Travel', 'Fitness', 'Other',
] as const;
export type CreatorCategory = (typeof CREATOR_CATEGORIES)[number];

export interface CreatorApplication {
  userId: string;
  /** Private — shown only on the admin review surface, never on public profiles. */
  fullName: string;
  creatorName: string;
  socialUsername: string;
  platform: CreatorPlatform;
  category: string;
  message?: string;
  verificationCode: string;
  /** ms epoch. Codes are single-use and expire 72h after issue. */
  codeExpiresAt: number;
  codeUsed: boolean;
  status: ApplicationStatus;
  createdAt?: any;
  updatedAt?: any;
  reviewedAt?: any;
  reviewedBy?: string;
}

/** Public creator identity stored on users/{uid}.creator — safe to display. */
export interface CreatorProfile {
  creatorName: string;
  category: string;
  platform: CreatorPlatform;
  socialUsername: string;
  referralCode: string;
  approvedAt: number;
  status: 'active' | 'revoked';
  revokedAt?: number;
}

export interface CreatorStats {
  totalClicks: number;
  totalInstalls: number;
  validInstalls: number;
  totalSignups: number;
  firstVisits: number;
}

export interface CreatorAttendance {
  eventId: string;
  eventName: string;
  userId: string;
  creatorName: string;
  category: string;
  createdAt: number;
  /** Set true by the geofence visit tracker when the creator actually shows up. */
  verified: boolean;
  verifiedAt?: number;
}

export const CODE_TTL_MS = 72 * 60 * 60 * 1000; // 72 hours

// ─── Verification codes ───────────────────────────────────────────────────────

// No 0/O/1/I — codes get retyped from DMs, ambiguity creates support tickets.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(): string {
  let s = '';
  for (let i = 0; i < 6; i++) {
    s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return `EVT-${s}`;
}

/** Generates a code that no other application currently holds. */
async function generateUniqueVerificationCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const clash = await getDocs(query(
      collection(firestore, 'creatorApplications'),
      where('verificationCode', '==', code),
      limit(1)
    ));
    if (clash.empty) return code;
  }
  // 32^6 combinations — five straight collisions means something is broken.
  throw new Error('Could not generate a unique verification code. Try again.');
}

export function isCodeExpired(app: Pick<CreatorApplication, 'codeExpiresAt' | 'codeUsed'>): boolean {
  return !app.codeUsed && Date.now() > app.codeExpiresAt;
}

/** Effective display status: a pending application whose code lapsed reads as Expired. */
export function effectiveStatus(app: CreatorApplication): ApplicationStatus | 'expired' {
  if (app.status === 'pending' && isCodeExpired(app)) return 'expired';
  return app.status;
}

// ─── Application lifecycle ────────────────────────────────────────────────────

export interface CreatorApplicationForm {
  fullName: string;
  creatorName: string;
  socialUsername: string;
  platform: CreatorPlatform;
  category: string;
  message?: string;
}

export async function submitCreatorApplication(
  userId: string,
  form: CreatorApplicationForm
): Promise<CreatorApplication> {
  const verificationCode = await generateUniqueVerificationCode();
  const app: CreatorApplication = {
    userId,
    fullName: form.fullName.trim(),
    creatorName: form.creatorName.trim(),
    socialUsername: form.socialUsername.trim().replace(/^@/, ''),
    platform: form.platform,
    category: form.category,
    message: (form.message || '').trim(),
    verificationCode,
    codeExpiresAt: Date.now() + CODE_TTL_MS,
    codeUsed: false,
    status: 'pending',
  };
  await setDoc(doc(firestore, 'creatorApplications', userId), {
    ...app,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return app;
}

export async function fetchMyApplication(userId: string): Promise<CreatorApplication | null> {
  const snap = await getDoc(doc(firestore, 'creatorApplications', userId));
  return snap.exists() ? (snap.data() as CreatorApplication) : null;
}

/**
 * Issues a fresh single-use code after the previous one expired.
 * Only valid while the application is still pending.
 */
export async function regenerateVerificationCode(userId: string): Promise<string> {
  const appSnap = await getDoc(doc(firestore, 'creatorApplications', userId));
  if (!appSnap.exists()) throw new Error('No application found.');
  const app = appSnap.data() as CreatorApplication;
  if (app.status !== 'pending') throw new Error('Application is no longer pending.');

  const verificationCode = await generateUniqueVerificationCode();
  await updateDoc(doc(firestore, 'creatorApplications', userId), {
    verificationCode,
    codeExpiresAt: Date.now() + CODE_TTL_MS,
    codeUsed: false,
    updatedAt: serverTimestamp(),
  });
  return verificationCode;
}

/** Rejected applicants may re-apply from scratch. */
export async function deleteApplication(userId: string): Promise<void> {
  await deleteDoc(doc(firestore, 'creatorApplications', userId));
}

// ─── Admin review ─────────────────────────────────────────────────────────────

export function subscribeAllApplications(
  cb: (apps: CreatorApplication[]) => void
): () => void {
  const q = query(collection(firestore, 'creatorApplications'), orderBy('createdAt', 'desc'));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => d.data() as CreatorApplication));
  });
}

/** Referral code from the stage name: readable prefix + digits, unique in `creators`. */
async function generateUniqueReferralCode(creatorName: string): Promise<string> {
  const prefix = creatorName.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'CREATOR';
  for (let attempt = 0; attempt < 8; attempt++) {
    const suffix = String(Math.floor(Math.random() * 90) + 10); // 10-99
    const code = attempt === 0 ? prefix : `${prefix}${suffix}`;
    const clash = await getDocs(query(
      collection(firestore, 'creators'),
      where('referralCode', '==', code),
      limit(1)
    ));
    if (clash.empty) return code;
  }
  throw new Error('Could not generate a unique referral code.');
}

/**
 * Approves an application after the admin has matched the verification code in
 * the official Instagram/TikTok DMs against the listed social account.
 *
 * One batch: marks the code used + application approved, upgrades the user to
 * Creator (public stage name only — full name stays on the application), and
 * creates/updates the creators/{uid} referral-stats doc that the existing
 * affiliate pipeline (registerInstall / onUserCreated) attributes into.
 */
export async function approveApplication(
  app: CreatorApplication,
  adminUid: string
): Promise<CreatorProfile> {
  const referralCode = await generateUniqueReferralCode(app.creatorName);
  const now = Date.now();
  const profile: CreatorProfile = {
    creatorName: app.creatorName,
    category: app.category,
    platform: app.platform,
    socialUsername: app.socialUsername,
    referralCode,
    approvedAt: now,
    status: 'active',
  };

  const batch = writeBatch(firestore);
  batch.update(doc(firestore, 'creatorApplications', app.userId), {
    status: 'approved',
    codeUsed: true,
    reviewedAt: serverTimestamp(),
    reviewedBy: adminUid,
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(firestore, 'users', app.userId), {
    accountType: 'creator',
    creator: profile,
  }, { merge: true });
  // merge: if this uid ever had a creators doc (e.g. re-approval after revoke),
  // its historical analytics counters are preserved.
  batch.set(doc(firestore, 'creators', app.userId), {
    userId: app.userId,
    name: app.creatorName,
    referralCode,
    revoked: false,
    approvedAt: now,
  }, { merge: true });
  await batch.commit();
  return profile;
}

export async function rejectApplication(userId: string, adminUid: string): Promise<void> {
  await updateDoc(doc(firestore, 'creatorApplications', userId), {
    status: 'rejected',
    codeUsed: true, // a rejected code can never be redeemed
    reviewedAt: serverTimestamp(),
    reviewedBy: adminUid,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Revokes creator status. Creator-only features lock immediately (clients gate
 * on the users/{uid} snapshot). The creators/{uid} analytics doc is kept —
 * flagged revoked — so historical referral data stays available to admins.
 */
export async function revokeCreator(userId: string, adminUid: string): Promise<void> {
  const now = Date.now();
  const batch = writeBatch(firestore);
  batch.set(doc(firestore, 'users', userId), {
    accountType: 'user',
    creator: { status: 'revoked', revokedAt: now },
  }, { merge: true });
  batch.set(doc(firestore, 'creators', userId), {
    revoked: true,
    revokedAt: now,
    revokedBy: adminUid,
  }, { merge: true });
  batch.update(doc(firestore, 'creatorApplications', userId), {
    status: 'rejected',
    reviewedAt: serverTimestamp(),
    reviewedBy: adminUid,
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
}

// ─── Referral stats (creator dashboard) ───────────────────────────────────────

export function buildReferralLink(referralCode: string): string {
  return `https://www.eventas.live/invite/${referralCode}`;
}

export async function fetchCreatorStats(userId: string): Promise<CreatorStats> {
  const snap = await getDoc(doc(firestore, 'creators', userId));
  const d = snap.exists() ? snap.data() : {};
  return {
    totalClicks: d.totalClicks || 0,
    totalInstalls: d.totalInstalls || 0,
    validInstalls: d.validInstalls || 0,
    totalSignups: d.totalSignups || 0,
    firstVisits: d.firstVisits || 0,
  };
}

// ─── Event attendance ("I'm Going") ──────────────────────────────────────────

const attendanceId = (eventId: string, userId: string) => `${eventId}_${userId}`;

export async function markGoing(
  eventId: string,
  eventName: string,
  userId: string,
  profile: Pick<CreatorProfile, 'creatorName' | 'category'>
): Promise<void> {
  await setDoc(doc(firestore, 'creatorAttendance', attendanceId(eventId, userId)), {
    eventId,
    eventName,
    userId,
    creatorName: profile.creatorName,
    category: profile.category,
    createdAt: Date.now(),
    verified: false,
  });
}

export async function cancelGoing(eventId: string, userId: string): Promise<void> {
  await deleteDoc(doc(firestore, 'creatorAttendance', attendanceId(eventId, userId)));
}

export function subscribeCreatorsAttending(
  eventId: string,
  cb: (list: CreatorAttendance[]) => void
): () => void {
  const q = query(collection(firestore, 'creatorAttendance'), where('eventId', '==', eventId));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => d.data() as CreatorAttendance));
  });
}

export async function fetchMyAttendance(userId: string): Promise<CreatorAttendance[]> {
  const snap = await getDocs(query(
    collection(firestore, 'creatorAttendance'),
    where('userId', '==', userId)
  ));
  return snap.docs
    .map((d) => d.data() as CreatorAttendance)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Geofence verification hook-in: called by useVisitTracker when the user is
 * physically at venues (existing 200m check-in radius). Marks any unverified
 * "I'm Going" declarations for those venues as verified attendance.
 */
export async function verifyAttendanceAtVenues(userId: string, venueIds: string[]): Promise<void> {
  if (venueIds.length === 0) return;
  try {
    for (const venueId of venueIds) {
      const ref = doc(firestore, 'creatorAttendance', attendanceId(venueId, userId));
      const snap = await getDoc(ref);
      if (snap.exists() && !snap.data().verified) {
        await updateDoc(ref, { verified: true, verifiedAt: Date.now() });
      }
    }
  } catch (err) {
    console.warn('[creatorService] Attendance verification failed (non-fatal):', err);
  }
}
