/**
 * VenueDeepLinkHandler
 *
 * Resolves a parked /venue/<id> deep link into an EventDetail navigation.
 *
 * EventDetail takes a full LiveVenue object, not an id, so the link cannot be
 * routed until the venue list has loaded. This renders nothing and simply waits
 * for every precondition to line up:
 *   - navigation is mounted (navReady)
 *   - the EventDetail screen exists in the stack, i.e. the user is signed in,
 *     past onboarding and has accepted terms (canRoute)
 *   - the venue itself has arrived in the live list
 *
 * Must be mounted inside LiveVenuesProvider.
 */
import React from 'react';
import { useLiveVenues } from '../hooks/useLiveVenues';
import { navigate } from '../navigation/navigationRef';
import {
  getPendingVenueId,
  getPendingVenueSetAt,
  setPendingVenueId,
  subscribePendingVenueId,
} from '../services/pendingDeepLink';

// Once we are actually able to route, a venue that never turns up in the live
// list is a dead link — stop waiting rather than firing on some unrelated later
// render. This clock deliberately does NOT run while the user is signed out:
// there we are waiting on a person, not on data, and sign-up can take minutes.
const RESOLVE_TIMEOUT_MS = 20000;

// Backstop for the signed-out wait. A link tapped and then abandoned should not
// still be sitting there ready to yank the user somewhere much later in the
// session. Generous enough to cover sign-up, e-mail verification and terms.
const MAX_PENDING_AGE_MS = 30 * 60 * 1000;

export const VenueDeepLinkHandler: React.FC<{
  navReady: boolean;
  canRoute: boolean;
}> = ({ navReady, canRoute }) => {
  const { venues } = useLiveVenues();
  const [pendingId, setPendingId] = React.useState<string | null>(getPendingVenueId());

  React.useEffect(
    () => subscribePendingVenueId(() => setPendingId(getPendingVenueId())),
    [],
  );

  // Only bound the wait once routing is actually possible. While the user is
  // signing in, the link waits indefinitely (up to MAX_PENDING_AGE_MS) so that
  // arriving from a share link and creating an account still lands on the event.
  React.useEffect(() => {
    if (!pendingId || !navReady || !canRoute) return;
    const timer = setTimeout(() => setPendingVenueId(null), RESOLVE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [pendingId, navReady, canRoute]);

  React.useEffect(() => {
    if (!pendingId || !navReady || !canRoute) return;
    if (Date.now() - getPendingVenueSetAt() > MAX_PENDING_AGE_MS) {
      setPendingVenueId(null);
      return;
    }
    const venue = venues.find((v) => v.id === pendingId);
    // Not an error — the list is still streaming in. This effect re-runs on the
    // next venues update.
    if (!venue) return;
    setPendingVenueId(null);
    navigate('EventDetail', { event: venue });
  }, [pendingId, navReady, canRoute, venues]);

  return null;
};
