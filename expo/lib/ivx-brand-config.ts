/**
 * IVX Official Brand Configuration
 * 
 * Single source of truth for IVX branding across all surfaces.
 * The App Factory uses this config to inherit official IVX branding
 * for any new module or app created by the IVX autonomous system.
 */
export const IVX_BRAND_CONFIG = {
  companyName: 'IVX HOLDINGS LLC',
  appName: 'IVX Holdings',
  legalName: 'IVX Holdings LLC',
  domain: 'ivxholding.com',
  supportEmail: 'support@ivxholding.com',
  privacyURL: 'https://ivxholding.com/privacy',
  termsURL: 'https://ivxholding.com/terms',
  
  // Visual identity
  logoAsset: '/ivx-logo-master.png',
  faviconAsset: '/favicon.png',
  
  // Design tokens (from colors.ts)
  primaryColorToken: 'officialGold',
  secondaryColorToken: 'primaryBlack',
  typographyToken: 'system',
  
  // Build identifiers (never use Rork defaults)
  bundleId: 'com.ivxholdings.app',
  packageName: 'com.ivxholdings.app',
  
  // Legal footer for documents
  legalFooter: 'IVX Holdings LLC — All rights reserved. Confidential.',
  
  // Document defaults
  documentDefaults: {
    headerLogo: true,
    footerLegal: true,
    confidentialityLabel: true,
    includeTimestamp: true,
    includeDocumentId: true,
  },
} as const;

export type IVXBrandConfig = typeof IVX_BRAND_CONFIG;
