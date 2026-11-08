export interface Theme {
  dark: boolean;
  bg: string;
  surface: string;
  text: string;
  muted: string;
  primary: string;
  onPrimary: string;
  pass: string;
  fail: string;
  warn: string;
  border: string;
}

/**
 * Palettes are chosen so every text/background pair used by the UI is >= 4.5:1
 * and borders are >= 3:1 (checked in __tests__/theme.test.ts) - the app should
 * pass the audit it is used for.
 */
export const LIGHT: Theme = {
  dark: false,
  bg: '#FFFFFF',
  surface: '#F2F4F7',
  text: '#111827',
  muted: '#4B5563',
  primary: '#1D4ED8',
  onPrimary: '#FFFFFF',
  pass: '#166534',
  fail: '#B91C1C',
  warn: '#92400E',
  border: '#6B7280',
};

export const DARK: Theme = {
  dark: true,
  bg: '#0B0F14',
  surface: '#1A2029',
  text: '#F3F4F6',
  muted: '#C0C7D1',
  primary: '#8AB4FF',
  onPrimary: '#0B0F14',
  pass: '#86EFAC',
  fail: '#FCA5A5',
  warn: '#FCD34D',
  border: '#8B95A3',
};
