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
  setPendingVenueId,
  subscribePendingVenueId,
} from '../services/pendingDeepLink';

// A link to a venue that no longer exists would otherwise sit pending forever
// and fire on some unrelated later render. Give it a bounded window instead.
const RESOLVE_TIMEOUT_MS = 20000;

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

  React.useEffect(() => {
    if (!pendingId) return;
    const timer = setTimeout(() => setPendingVenueId(null), RESOLVE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [pendingId]);

  React.useEffect(() => {
    if (!pendingId || !navReady || !canRoute) return;
    const venue = venues.find((v) => v.id === pendingId);
    // Not an error — the list is still streaming in. This effect re-runs on the
    // next venues update.
    if (!venue) return;
    setPendingVenueId(null);
    navigate('EventDetail', { event: venue });
  }, [pendingId, navReady, canRoute, venues]);

  return null;
};
