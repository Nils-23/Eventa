/**
 * pendingDeepLink
 *
 * A deep link can land before the app is in any state to act on it: navigation
 * is not mounted yet, auth has not resolved, and the venue list is still empty
 * on a cold start. The link is parsed once in App.tsx and parked here until
 * VenueDeepLinkHandler can resolve it into a real venue and navigate.
 *
 * Module-level rather than store state so the value survives whatever mounts
 * (or remounts) between the URL arriving and the handler being ready.
 */
let pendingVenueId: string | null = null;
const listeners = new Set<() => void>();

export function setPendingVenueId(id: string | null) {
  pendingVenueId = id;
  listeners.forEach((l) => l());
}

export function getPendingVenueId() {
  return pendingVenueId;
}

export function subscribePendingVenueId(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
