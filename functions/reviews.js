const admin = require('firebase-admin');

/**
 * Venue reviews: the aggregate, and the morning-after prompt.
 *
 * Reviews are written by the client (rules enforce the verified-visit gate),
 * but everything derived from them is server-owned. Two reasons: venue docs are
 * admin-write-only, so a client could not maintain the aggregate even if we
 * wanted it to; and an average a client computes is an average a client can
 * forge.
 */

// Only reviews of visits this recent feed the "recent" count on a venue card. A
// venue's crowd, door policy and pricing change with the season and the
// promoter, so a rating from March says nothing about tonight.
const RECENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

// Reviews are asked for the morning after, at a civilised local hour. Anyone
// who visited yesterday and has not been asked yet gets exactly one prompt.
const REVIEW_PROMPT_HOUR = 11;

// The same window the client offers, so a prompt never points at a venue the
// user can no longer rate.
const REVIEW_WINDOW_DAYS = 14;

function nairobiDayKey(ms) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date(ms));
}

function nairobiHour(ms) {
  return parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Nairobi',
      hour: '2-digit',
      hour12: false,
    }).format(new Date(ms)),
    10
  );
}

/**
 * Recomputes a venue's aggregate from its reviews.
 *
 * Deliberately a full recount rather than an incremental nudge on the changed
 * document: a review here is editable, so increments would drift every time
 * someone changed an answer, and at these volumes the recount costs one small
 * query. It is also self-healing — one good run repairs any past drift.
 */
async function recomputeVenueStats(db, venueId) {
  const snap = await db
    .collection('reviews')
    .where('venueId', '==', venueId)
    .where('status', '==', 'visible')
    .get();

  const stats = {
    count: snap.size,
    recentCount: 0,
    wouldReturnPct: null,
    crowd: {},
    entry: {},
    price: {},
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const now = Date.now();
  let returnYes = 0;
  let returnAnswered = 0;

  snap.forEach((doc) => {
    const r = doc.data();
    if (typeof r.visitedAt === 'number' && now - r.visitedAt <= RECENT_WINDOW_MS) {
      stats.recentCount++;
    }
    for (const key of ['crowd', 'entry', 'price']) {
      const value = r[key];
      if (typeof value === 'string' && value) {
        stats[key][value] = (stats[key][value] || 0) + 1;
      }
    }
    if (typeof r.wouldReturn === 'boolean') {
      returnAnswered++;
      if (r.wouldReturn) returnYes++;
    }
  });

  if (returnAnswered > 0) {
    stats.wouldReturnPct = Math.round((returnYes / returnAnswered) * 100);
  }

  // The venue may have been deleted between the review write and this run.
  try {
    await db.collection('venues').doc(venueId).update({ reviewStats: stats });
  } catch (err) {
    console.warn(`[Reviews] Could not write stats for ${venueId}: ${err.message}`);
  }

  return stats;
}

async function handleReviewWritten(db, change) {
    const after = change.after.exists ? change.after.data() : null;
    const before = change.before.exists ? change.before.data() : null;
    const venueId = (after && after.venueId) || (before && before.venueId);
    if (!venueId) return null;

    const stats = await recomputeVenueStats(db, venueId);
    console.log(`[Reviews] ${venueId}: ${stats.count} reviews (${stats.recentCount} recent)`);

    // Mark the visit as reviewed so the prompt scheduler skips it. Best effort:
    // the worst case is one redundant push, which the prompted flag then stops.
    if (after && after.userId && after.visitDayKey) {
      const visitId = `${after.userId}_${after.visitDayKey}_${venueId}`;
      try {
        await db.collection('visits').doc(visitId).update({ reviewed: true, reviewPrompted: true });
      } catch (err) {
        // A visit row that no longer exists is not an error worth failing on.
      }
    }

    return null;
}

/**
 * Asks yesterday's visitors to rate where they were.
 *
 * Runs hourly and does nothing until REVIEW_PROMPT_HOUR Nairobi, so the ping
 * lands mid-morning rather than whenever a cron happened to fire. One prompt
 * per visit, ever: `reviewPrompted` is set whether or not the push succeeded,
 * because a person who cannot be reached is not a person to keep retrying.
 */
async function runReviewPrompts(db, sendRateLimitedPushNotification) {
    const now = Date.now();

    if (nairobiHour(now) < REVIEW_PROMPT_HOUR) {
      console.log(`[Reviews] Before ${REVIEW_PROMPT_HOUR}:00 EAT. Skipping.`);
      return null;
    }

    // Everything from the last REVIEW_WINDOW_DAYS that has never been asked
    // about — not just literally yesterday, so a run that fails or a phone
    // that was off does not cost the user the prompt entirely.
    const cutoff = now - REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const todayKey = nairobiDayKey(now);

    let snap;
    try {
      snap = await db
        .collection('visits')
        .where('reviewPrompted', '==', false)
        .where('visitedAt', '>=', cutoff)
        .orderBy('visitedAt', 'desc')
        .limit(500)
        .get();
    } catch (err) {
      console.error('[Reviews] Visit query failed (is the composite index deployed?):', err.message);
      return null;
    }

    if (snap.empty) {
      console.log('[Reviews] No visits awaiting a prompt.');
      return null;
    }

    const summary = { scanned: snap.size, prompted: 0, sameDay: 0, alreadyReviewed: 0, failed: 0 };

    for (const docSnap of snap.docs) {
      const visit = docSnap.data();

      // Never on the day itself — the night may still be going, and "how was
      // it?" while someone is still there is the wrong question.
      if (visit.dayKey === todayKey) {
        summary.sameDay++;
        continue;
      }
      if (visit.reviewed) {
        summary.alreadyReviewed++;
        await docSnap.ref.update({ reviewPrompted: true }).catch(() => {});
        continue;
      }

      try {
        await sendRateLimitedPushNotification(
          visit.userId,
          `How was ${visit.venueName || 'it'}?`,
          'Four taps: how busy, the queue, prices, would you go back.',
          { type: 'review_prompt', venueId: visit.venueId },
          `review_${visit.venueId}`,
          7 * 24 * 60 * 60 * 1000
        );
        summary.prompted++;
      } catch (err) {
        summary.failed++;
      }

      // Set regardless of delivery: one ask per visit is the contract.
      await docSnap.ref.update({ reviewPrompted: true }).catch(() => {});
    }

    console.log(
      `[Reviews] Prompts: ${summary.prompted} sent, ${summary.sameDay} too soon, ` +
      `${summary.alreadyReviewed} already reviewed, ${summary.failed} failed, of ${summary.scanned} scanned.`
    );
    return null;
}

module.exports = { recomputeVenueStats, handleReviewWritten, runReviewPrompts };
