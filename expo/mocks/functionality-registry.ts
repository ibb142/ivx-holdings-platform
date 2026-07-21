export interface Feature {
  id: string;
  name: string;
  description?: string;
  status: 'active' | 'beta' | 'coming_soon';
  addedDate: string;
  version?: string;
}

export interface Module {
  id: string;
  title: string;
  icon: string;
  color: string;
  description: string;
  features: Feature[];
}

export const APP_INFO = {
  name: 'IVXHOLDINGS Real Estate Investment Platform',
  version: '1.0.0',
  lastUpdated: new Date().toISOString().split('T')[0],
};

export const FUNCTIONALITY_REGISTRY: Module[] = [
  {
    id: 'auth', title: 'Authentication & Onboarding', icon: 'Lock', color: '#6366F1',
    description: 'User authentication, registration, and onboarding flows',
    features: [
      { id: 'auth-1', name: 'User registration with email and password', status: 'active', addedDate: '2024-01-01' },
      { id: 'auth-2', name: 'Social login integration (Google, Apple)', status: 'active', addedDate: '2024-01-01' },
      { id: 'auth-3', name: 'Two-factor authentication (2FA)', status: 'active', addedDate: '2024-01-01' },
      { id: 'auth-4', name: 'Biometric authentication (Face ID / Touch ID)', status: 'active', addedDate: '2024-01-01' },
      { id: 'auth-5', name: 'Onboarding tutorial flow', status: 'active', addedDate: '2024-01-01' },
    ],
  },
  {
    id: 'kyc', title: 'KYC Verification', icon: 'Shield', color: '#00C48C',
    description: 'Know Your Customer verification and compliance',
    features: [
      { id: 'kyc-1', name: 'Personal information collection', status: 'active', addedDate: '2024-01-01' },
      { id: 'kyc-2', name: 'Government ID upload and verification', status: 'active', addedDate: '2024-01-01' },
      { id: 'kyc-3', name: 'Face recognition verification', status: 'active', addedDate: '2024-01-15' },
      { id: 'kyc-4', name: 'KYC status tracking and progress', status: 'active', addedDate: '2024-01-01' },
      { id: 'kyc-5', name: 'Open access investor verification (no accreditation required)', status: 'active', addedDate: '2024-01-01' },
    ],
  },
  {
    id: 'profile', title: 'User Profile Management', icon: 'Users', color: '#6366F1',
    description: 'User profile and settings management',
    features: [
      { id: 'profile-1', name: 'View and edit personal information', status: 'active', addedDate: '2024-01-01' },
      { id: 'profile-2', name: 'Notification preferences settings', status: 'active', addedDate: '2024-01-01' },
      { id: 'profile-3', name: 'Security settings and password change', status: 'active', addedDate: '2024-01-01' },
      { id: 'profile-4', name: 'Investment preferences and risk tolerance', status: 'active', addedDate: '2024-01-01' },
    ],
  },
  {
    id: 'marketplace', title: 'Property Marketplace', icon: 'Building2', color: '#F59E0B',
    description: 'Browse and search property investments',
    features: [
      { id: 'market-1', name: 'Browse all available properties', status: 'active', addedDate: '2024-01-01' },
      { id: 'market-2', name: 'Property search and filtering', status: 'active', addedDate: '2024-01-01' },
      { id: 'market-3', name: 'Property detail view with gallery', status: 'active', addedDate: '2024-01-01' },
      { id: 'market-4', name: 'Property comparison tool', status: 'active', addedDate: '2024-01-01' },
      { id: 'market-5', name: 'Investment calculator', status: 'active', addedDate: '2024-01-01' },
    ],
  },
  {
    id: 'transactions', title: 'Investment Transactions', icon: 'TrendingUp', color: '#EC4899',
    description: 'Buy, sell, and manage investments',
    features: [
      { id: 'trans-1', name: 'Buy property shares/tokens', status: 'active', addedDate: '2024-01-01' },
      { id: 'trans-2', name: 'Sell property shares/tokens', status: 'active', addedDate: '2024-01-01' },
      { id: 'trans-3', name: 'Market and limit orders', status: 'active', addedDate: '2024-01-01' },
      { id: 'trans-4', name: 'Transaction history and tracking', status: 'active', addedDate: '2024-01-01' },
      { id: 'trans-5', name: 'Auto-invest and DRIP', status: 'active', addedDate: '2024-01-01' },
    ],
  },
  {
    id: 'portfolio', title: 'Portfolio Management', icon: 'BarChart3', color: '#8B5CF6',
    description: 'Track and manage your investment portfolio',
    features: [
      { id: 'port-1', name: 'Portfolio overview dashboard', status: 'active', addedDate: '2024-01-01' },
      { id: 'port-2', name: 'Performance charts and analytics', status: 'active', addedDate: '2024-01-01' },
      { id: 'port-3', name: 'Holdings breakdown and allocation', status: 'active', addedDate: '2024-01-01' },
      { id: 'port-4', name: 'Gains/losses calculation', status: 'active', addedDate: '2024-01-01' },
    ],
  },
  {
    id: 'payment', title: 'Payment & Funding', icon: 'Wallet', color: '#14B8A6',
    description: 'Payment methods and wallet management',
    features: [
      { id: 'pay-1', name: 'Bank account linking (ACH/Plaid)', status: 'active', addedDate: '2024-01-01' },
      { id: 'pay-2', name: 'Credit/debit card payments', status: 'active', addedDate: '2024-01-01' },
      { id: 'pay-3', name: 'Wire transfer deposits', status: 'active', addedDate: '2024-01-01' },
      { id: 'pay-4', name: 'Wallet balance and withdrawals', status: 'active', addedDate: '2024-01-01' },
      { id: 'pay-5', name: 'Fee calculation and display', status: 'active', addedDate: '2024-01-01' },
    ],
  },
  {
    id: 'dividend', title: 'Dividend & Income', icon: 'Gift', color: '#F97316',
    description: 'Dividend tracking and income management',
    features: [
      { id: 'div-1', name: 'Dividend distribution tracking', status: 'active', addedDate: '2024-01-01' },
      { id: 'div-2', name: 'Income projections and history', status: 'active', addedDate: '2024-01-01' },
      { id: 'div-3', name: 'Dividend reinvestment option', status: 'active', addedDate: '2024-01-01' },
    ],
  },
  {
    id: 'ipx', title: 'IVXHOLDINGS Token System', icon: 'IVXBrandIcon', color: '#EAB308',
    description: 'IVXHOLDINGS token management and staking',
    features: [
      { id: 'ipx-1', name: 'IVXHOLDINGS token balance and price tracking', status: 'active', addedDate: '2024-01-01' },
      { id: 'ipx-2', name: 'Buy/sell IVXHOLDINGS tokens', status: 'active', addedDate: '2024-01-01' },
      { id: 'ipx-3', name: 'IVXHOLDINGS staking and rewards', status: 'active', addedDate: '2024-01-01' },
      { id: 'ipx-4', name: 'IVXHOLDINGS governance voting', status: 'active', addedDate: '2024-01-01' },
    ],
  },
  {
    id: 'referral', title: 'Referral Program', icon: 'Users', color: '#06B6D4',
    description: 'Referral tracking and rewards',
    features: [
      { id: 'ref-1', name: 'Referral code generation and sharing', status: 'active', addedDate: '2024-01-01' },
      { id: 'ref-2', name: 'Referral tracking dashboard', status: 'active', addedDate: '2024-01-01' },
      { id: 'ref-3', name: 'Referral rewards and leaderboard', status: 'active', addedDate: '2024-01-01' },
    ],
  },
  {
    id: 'notifications', title: 'Notifications & Alerts', icon: 'Bell', color: '#FF4D4D',
    description: 'Push notifications and in-app alerts',
    features: [
      { id: 'notif-1', name: 'Push notification delivery', status: 'active', addedDate: '2024-01-01' },
      { id: 'notif-2', name: 'In-app notification center', status: 'active', addedDate: '2024-01-01' },
      { id: 'notif-3', name: 'Custom alert configuration', status: 'active', addedDate: '2024-01-01' },
    ],
  },
  {
    id: 'chat', title: 'AI Chat Assistant', icon: 'Brain', color: '#A855F7',
    description: 'AI-powered investment assistant',
    features: [
      { id: 'chat-1', name: 'AI-powered chat interface', status: 'active', addedDate: '2024-01-01' },
      { id: 'chat-2', name: 'Investment recommendations', status: 'active', addedDate: '2024-01-01' },
      { id: 'chat-3', name: 'Human support escalation', status: 'active', addedDate: '2024-01-01' },
    ],
  },
  {
    id: 'admin', title: 'Admin Panel', icon: 'Settings', color: '#555555',
    description: 'Administrative controls and management',
    features: [
      { id: 'admin-1', name: 'Admin dashboard overview', status: 'active', addedDate: '2024-01-01' },
      { id: 'admin-2', name: 'Member and KYC management', status: 'active', addedDate: '2024-01-01' },
      { id: 'admin-3', name: 'Property listing management', status: 'active', addedDate: '2024-01-01' },
      { id: 'admin-4', name: 'Transaction and fee management', status: 'active', addedDate: '2024-01-01' },
      { id: 'admin-5', name: 'Marketing and AI content tools', status: 'active', addedDate: '2024-01-01' },
      { id: 'admin-6', name: 'Engagement and analytics', status: 'active', addedDate: '2024-01-01' },
    ],
  },
  {
    id: 'security', title: 'Security Features', icon: 'ShieldCheck', color: '#DC2626',
    description: 'Security and data protection',
    features: [
      { id: 'sec-1', name: 'End-to-end encryption', status: 'active', addedDate: '2024-01-01' },
      { id: 'sec-2', name: 'Session management and device tracking', status: 'active', addedDate: '2024-01-01' },
      { id: 'sec-3', name: 'GDPR compliance tools', status: 'active', addedDate: '2024-01-01' },
    ],
  },
  {
    id: 'floating_analytics', title: 'Floating Analytics Icon', icon: 'BarChart3', color: '#D4AF37',
    description: 'Pulsing golden BarChart3 floating button (bottom-right) — navigates to analytics report',
    features: [
      { id: 'fab-visible', name: 'Show Floating Analytics Button', status: 'active', addedDate: '2024-06-01' },
      { id: 'fab-pulse', name: 'Pulse Glow Animation', status: 'active', addedDate: '2024-06-01' },
      { id: 'fab-navigate', name: 'Navigate to Analytics Report on Tap', status: 'active', addedDate: '2024-06-01' },
    ],
  },
  {
    id: 'uiux', title: 'UI/UX Features', icon: 'Palette', color: '#D946EF',
    description: 'User interface and experience',
    features: [
      { id: 'ui-1', name: 'Dark/light mode support', status: 'active', addedDate: '2024-01-01' },
      { id: 'ui-2', name: 'Haptic feedback and animations', status: 'active', addedDate: '2024-01-01' },
      { id: 'ui-3', name: 'Multi-language support (30 languages)', status: 'active', addedDate: '2024-01-01' },
      { id: 'ui-4', name: 'Accessibility support', status: 'active', addedDate: '2024-01-01' },
    ],
  },
];

export function getTotalFeatures(): number {
  return FUNCTIONALITY_REGISTRY.reduce((sum, module) => sum + module.features.length, 0);
}

export function getTotalModules(): number {
  return FUNCTIONALITY_REGISTRY.length;
}

export function getActiveFeatures(): number {
  return FUNCTIONALITY_REGISTRY.reduce((sum, module) => sum + module.features.filter(f => f.status === 'active').length, 0);
}

export function getBetaFeatures(): number {
  return FUNCTIONALITY_REGISTRY.reduce((sum, module) => sum + module.features.filter(f => f.status === 'beta').length, 0);
}

export function getComingSoonFeatures(): number {
  return FUNCTIONALITY_REGISTRY.reduce((sum, module) => sum + module.features.filter(f => f.status === 'coming_soon').length, 0);
}

export function generateTextReport(): string {
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  let content = `IVXHOLDINGS REAL ESTATE INVESTMENT PLATFORM - FUNCTIONALITY REPORT\nGenerated: ${date} | Version: ${APP_INFO.version}\n`;
  content += `Modules: ${getTotalModules()} | Features: ${getTotalFeatures()} | Active: ${getActiveFeatures()}\n\n`;
  FUNCTIONALITY_REGISTRY.forEach((module, index) => {
    content += `${index + 1}. ${module.title} (${module.features.length} features)\n`;
    module.features.forEach((feature, fIndex) => {
      const status = feature.status === 'active' ? '✓' : feature.status === 'beta' ? 'β' : '○';
      content += `  ${fIndex + 1}. [${status}] ${feature.name}\n`;
    });
    content += '\n';
  });
  return content;
}

export function generateCSVReport(): string {
  let csv = 'Module ID,Module Name,Feature ID,Feature Name,Status\n';
  FUNCTIONALITY_REGISTRY.forEach((module) => {
    module.features.forEach((feature) => {
      csv += `"${module.id}","${module.title}","${feature.id}","${feature.name.replace(/"/g, '""')}","${feature.status}"\n`;
    });
  });
  return csv;
}

export function generateExcelHTML(): string {
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  let html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>table{border-collapse:collapse;width:100%}th,td{border:1px solid #000;padding:8px}th{background:#0066FF;color:white}.module-header{background:#E8F0FE;font-weight:bold}</style></head><body>
<h1>IVXHOLDINGS Real Estate Investment Platform</h1><p>Generated: ${date} | Version: ${APP_INFO.version}</p>
<table><tr><th>#</th><th>Module</th><th>Feature</th><th>Status</th></tr>`;
  let num = 1;
  FUNCTIONALITY_REGISTRY.forEach(module => {
    html += `<tr class="module-header"><td colspan="4">${module.title} (${module.features.length} features)</td></tr>`;
    module.features.forEach(feature => {
      html += `<tr><td>${num++}</td><td>${module.title}</td><td>${feature.name}</td><td>${feature.status}</td></tr>`;
    });
  });
  html += `<tr style="font-weight:bold"><td colspan="3">TOTAL</td><td>${getTotalFeatures()} features</td></tr></table></body></html>`;
  return html;
}
