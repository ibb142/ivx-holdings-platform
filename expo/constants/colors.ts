/**
 * IVX Global Design Tokens
 *
 * Derived from the official IVX brand system:
 *   - Primary black: #000000
 *   - Official gold: #E6C200
 *   - Secondary gold: #FFD700
 *   - Text white: #FFFFFF
 *   - Muted gray: #909090
 *
 * Do not introduce new golds or blacks outside these tokens. All IVX surfaces
 * (mobile, web, emails, PDFs) should reference these values.
 */

const primaryBlack = '#000000' as const;
const officialGold = '#E6C200' as const;
const secondaryGold = '#FFD700' as const;
const goldLight = '#FFF2A3' as const;
const textWhite = '#FFFFFF' as const;
const mutedGray = '#909090' as const;
const surface = '#141414' as const;
const surfaceElevated = '#1A1A1A' as const;
const surfaceBorder = '#2A2A2A' as const;
const error = '#FF4D4D' as const;
const success = '#00C48C' as const;
const warning = '#F59E0B' as const;
const info = '#4A90D9' as const;
const teal = '#4ECDC4' as const;
const coral = '#FF6B35' as const;
const purple = '#A78BFA' as const;

const tintColorLight = officialGold;

type ColorScheme = {
  text: string;
  background: string;
  tint: string;
  tabIconDefault: string;
  tabIconSelected: string;
};

type AppColors = {
  light: ColorScheme;
  dark: ColorScheme;
  primary: string;
  primaryDark: string;
  primaryLight: string;
  secondary: string;
  accent: string;
  background: string;
  backgroundSecondary: string;
  backgroundTertiary: string;
  surface: string;
  surfaceElevated: string;
  surfaceLight: string;
  surfaceBorder: string;
  border: string;
  card: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  subtitle: string;
  tint: string;
  muted: string;
  inputPlaceholder: string;
  inputBackground: string;
  inputBorder: string;
  white: string;
  black: string;
  success: string;
  positive: string;
  warning: string;
  error: string;
  danger: string;
  negative: string;
  info: string;
  gold: string;
  green: string;
  chartGreen: string;
  red: string;
  chartRed: string;
  orange: string;
  blue: string;
  overlay: string;
  transparent: string;
  // Official brand tokens
  primaryBlack: string;
  officialGold: string;
  secondaryGold: string;
  goldLight: string;
  textWhite: string;
  mutedGray: string;
  teal: string;
  coral: string;
  purple: string;
};

const Colors: AppColors = {
  light: {
    text: textWhite,
    background: primaryBlack,
    tint: tintColorLight,
    tabIconDefault: '#555555',
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: textWhite,
    background: primaryBlack,
    tint: tintColorLight,
    tabIconDefault: '#555555',
    tabIconSelected: tintColorLight,
  },
  primary: officialGold,
  primaryDark: officialGold,
  primaryLight: goldLight,
  secondary: surfaceElevated,
  accent: officialGold,
  background: primaryBlack,
  backgroundSecondary: surfaceElevated,
  backgroundTertiary: '#242424',
  surface,
  surfaceElevated,
  surfaceLight: '#2A2A2A',
  surfaceBorder,
  border: surfaceBorder,
  card: surface,
  text: textWhite,
  textSecondary: mutedGray,
  textTertiary: '#555555',
  subtitle: mutedGray,
  tint: tintColorLight,
  muted: '#555555',
  inputPlaceholder: '#555555',
  inputBackground: surfaceElevated,
  inputBorder: '#333333',
  white: textWhite,
  black: primaryBlack,
  success,
  positive: success,
  warning,
  error,
  danger: error,
  negative: error,
  info,
  gold: officialGold,
  green: success,
  chartGreen: success,
  red: error,
  chartRed: error,
  orange: warning,
  blue: info,
  overlay: 'rgba(0,0,0,0.7)',
  transparent: 'transparent',
  primaryBlack,
  officialGold,
  secondaryGold,
  goldLight,
  textWhite,
  mutedGray,
  teal,
  coral,
  purple,
};

export default Colors;
