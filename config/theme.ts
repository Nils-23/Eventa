/**
 * Eventas design tokens — the single source of truth for colors.
 *
 * Use these instead of hex literals in new/edited code. Several near-identical
 * legacy shades (six different near-blacks, three different reds) were
 * consolidated into the background/surface/border/danger tokens below.
 *
 * The Android splash (splashscreen_background) and iOS SplashScreenBackground
 * colorset mirror `background` — keep them in sync if it ever changes.
 */
export const theme = {
  // Surfaces
  background: '#121212', // screen + app background (matches native splash)
  surface: '#1A1A1A', // cards, sheets, overlays, modals
  border: '#2A2A2A', // hairline borders and dividers

  // Text
  textPrimary: '#FFFFFF',
  textSecondary: '#AAAAAA',
  textMuted: '#888888',

  // Brand
  accent: '#00FFCC', // primary neon cyan — CTAs, highlights, active states
  accentAlt: '#FF00CC', // secondary neon magenta — stories, special actions
  onAccent: '#000000', // text/icons placed on accent backgrounds

  // Semantic
  danger: '#FF0055',
  warning: '#FFCC00',

  // Leaderboard metals
  gold: '#FFD700',
  silver: '#C0C0C0',
  bronze: '#CD7F32',
} as const;

export type Theme = typeof theme;
