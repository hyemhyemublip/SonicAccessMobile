/**
 * SonicAccess visual theme — Quezon City University palette.
 *
 * Blue is the brand, white/paper are surfaces, gold is the highlight (the live
 * code, progress), red is reserved for alerts / expiry. Light theme.
 *
 * Import `t` for tokens; use `text.*` for the shared type styles.
 */

import { StyleSheet } from 'react-native';

export const palette = {
  blue: '#0B3C8C', // QCU blue — brand / primary actions
  blueDark: '#082C66',
  blueTint: '#E7EEF9', // pale blue fill
  gold: '#F2B705', // highlight
  goldDeep: '#C8930A',
  red: '#C8102E', // alerts, expiry, errors
  redTint: '#FBE7EA',
  white: '#FFFFFF',
  paper: '#F4F6FB', // app background
  ink: '#141B2D', // primary text
  inkMute: '#5A6478', // secondary text
  inkFaint: '#8A93A6', // hints / captions
  line: '#DDE3EE', // borders / dividers
} as const;

export const t = {
  color: palette,
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 },
  radius: { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 },
  // subtle elevation for cards on the paper background
  shadow: {
    shadowColor: '#0B1B3A',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
} as const;

export const text = StyleSheet.create({
  display: { color: palette.ink, fontSize: 28, fontWeight: '800', letterSpacing: 0.2 },
  title: { color: palette.ink, fontSize: 22, fontWeight: '700' },
  body: { color: palette.ink, fontSize: 15, lineHeight: 21 },
  muted: { color: palette.inkMute, fontSize: 14, lineHeight: 20 },
  caption: { color: palette.inkFaint, fontSize: 12.5, lineHeight: 17 },
  label: { color: palette.inkMute, fontSize: 12, fontWeight: '700', letterSpacing: 1 },
});

/** Brand wordmark colours — "Sonic" blue, "Access" gold. */
export const brand = { primary: palette.blue, accent: palette.gold };
