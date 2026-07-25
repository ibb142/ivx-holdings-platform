/**
 * IVX Global Brand System
 *
 * Official brand source: assets/brand/ivx-logo-master.png
 * Attached logo: black background, gold architectural IVX symbol, gold "IVX" lettering.
 *
 * Rules:
 * 1. Use only the official assets below for any IVX-branded surface.
 * 2. Do not create alternate logos, crowns, text-only marks, or Rork branding in production.
 * 3. Do not stretch, distort, or recolor the logo without owner approval.
 * 4. Prefer the IVXBrandLogo component over ad-hoc Image usage.
 * 5. Use IVX_BRAND_TOKENS for colors, spacing, and typography.
 */

// ─── Brand assets ───────────────────────────────────────────────────────────

/** Master 1024x1024 PNG of the official IVX logo (black background, gold symbol + wordmark). */
export const IVX_LOGO_MASTER = require('@/assets/images/ivx-logo.png');

/** Transparent-background variant (gold symbol + wordmark only). */
export const IVX_LOGO_TRANSPARENT = require('@/assets/images/ivx-logo-transparent.png');

/** Horizontal layout (symbol left, wordmark right) — owner-approved official variant. */
export const IVX_LOGO_HORIZONTAL = { uri: 'https://r2-pub.rork.com/projects/j2l8t44588ix9ns7b57mu/assets/02dc3859-abdd-4577-8360-2531e06ee2b0.png' };

/** Stacked / vertical layout (symbol above wordmark) — owner-approved official variant. */
export const IVX_LOGO_STACKED = { uri: 'https://r2-pub.rork.com/projects/j2l8t44588ix9ns7b57mu/assets/13a98cc9-5275-4104-8380-38ee2d5b1fca.png' };

/** Gold symbol-only version (compact avatars, tab icons, small headers). */
export const IVX_SYMBOL = require('@/assets/images/ivx-symbol.png');

/** Gold wordmark-only version (IVX text). */
export const IVX_WORDMARK = require('@/assets/images/ivx-wordmark.png');

/** Legacy alias for existing imports. Always resolves to the official master logo. */
export const IVX_LOGO_SOURCE = IVX_LOGO_MASTER;

// ─── Brand tokens ───────────────────────────────────────────────────────────

export type IVXLogoVariant = 'full' | 'symbol' | 'wordmark' | 'horizontal' | 'stacked';
export type IVXLogoSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'hero';
export type IVXLogoTheme = 'dark' | 'light';

export interface IVXLogoSpec {
  source: any;
  width: number;
  height: number;
  accessibilityLabel: string;
  variant: IVXLogoVariant;
  theme: IVXLogoTheme;
}

export const IVX_BRAND_TOKENS = {
  colors: {
    primaryBlack: '#000000',
    officialGold: '#E6C200',
    secondaryGold: '#FFD700',
    goldLight: '#FFF2A3',
    textWhite: '#FFFFFF',
    mutedGray: '#909090',
    surface: '#141414',
    surfaceElevated: '#1A1A1A',
    border: '#2A2A2A',
    error: '#FF4D4D',
    success: '#00C48C',
  },
  spacing: {
    logoMinWidth: 24,
    logoMinHeight: 24,
    logoPadding: 8,
  },
  typography: {
    brandFont: '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif',
    letterSpacing: 1,
  },
} as const;

// ─── Logo specs ──────────────────────────────────────────────────────────────

const LOGO_SIZE_MAP: Record<IVXLogoSize, number> = {
  xs: 24,
  sm: 32,
  md: 48,
  lg: 80,
  xl: 120,
  hero: 200,
};

export function getIVXLogoSpec(
  variant: IVXLogoVariant = 'full',
  size: IVXLogoSize = 'md',
  theme: IVXLogoTheme = 'dark',
): IVXLogoSpec {
  const dim = LOGO_SIZE_MAP[size];
  const isHorizontal = variant === 'horizontal' || variant === 'wordmark';
  const aspectRatio = isHorizontal ? 3.0 : 1.0;
  const source =
    variant === 'horizontal' ? IVX_LOGO_HORIZONTAL :
    variant === 'stacked' ? IVX_LOGO_STACKED :
    variant === 'symbol' ? IVX_SYMBOL :
    variant === 'wordmark' ? IVX_WORDMARK :
    theme === 'light' ? IVX_LOGO_TRANSPARENT :
    IVX_LOGO_MASTER;

  return {
    source,
    width: Math.round(dim * aspectRatio),
    height: dim,
    accessibilityLabel: 'IVX Holdings official logo',
    variant,
    theme,
  };
}

export const IVX_BRAND_COPY = {
  companyName: 'IVX Holdings',
  companyNameLLC: 'IVX HOLDINGS LLC',
  assistantName: 'IVX IA',
  ownerAssistantName: 'IVX Owner AI',
  seniorDeveloperName: 'IVX Senior Developer',
} as const;

// ─── Governance constants ─────────────────────────────────────────────────────

export const IVX_BRAND_RULES = [
  'The attached logo is the official master.',
  'No team or agent may create a replacement logo automatically.',
  'No AI agent may redesign the brand without owner approval.',
  'No Rork branding may appear in production.',
  'No old logo may remain active.',
  'No inconsistent gold colors.',
  'No stretched or low-resolution versions.',
  'No external hot-linked logo assets.',
  'All logo changes require owner approval.',
  'All new IVX Factory apps inherit the IVX brand system unless explicitly created as an independent brand.',
  'No hot-linking to pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev or any pre-official asset host.',
] as const;
