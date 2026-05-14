/**
 * useLiveVenues
 *
 * Thin wrapper around LiveVenuesContext.
 * All Firebase listeners live in LiveVenuesProvider (contexts/LiveVenuesContext.tsx),
 * which is mounted once in navigation/MainTabs.tsx. This eliminates the duplicate
 * subscription that caused the ListScreen loading delay — data is always ready.
 */
import { useLiveVenuesContext, LiveVenue, HeatPoint, ActivityLevel } from '../contexts/LiveVenuesContext';

export type { LiveVenue, HeatPoint, ActivityLevel };

export const useLiveVenues = () => useLiveVenuesContext();
