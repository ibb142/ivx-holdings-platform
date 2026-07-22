/**
 * Safe numeric value: returns 0 for null/undefined/NaN/invalid.
 * Use this as the first gate before any formatter to prevent $NaN.
 */
export const safeNumber = (value: unknown): number => {
  if (value === null || value === undefined || value === '') return 0;
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

/**
 * Checks if a numeric value is present and valid (not null/undefined/NaN).
 * Returns true ONLY when the value exists and is a finite number.
 */
export const isValidNumber = (value: unknown): value is number => {
  if (value === null || value === undefined || value === '') return false;
  const num = Number(value);
  return Number.isFinite(num);
};

export const formatCurrency = (amount: number, compact = false): string => {
  // Guard against NaN/undefined/null — never render "$NaN"
  const safe = Number.isFinite(amount) ? amount : 0;
  if (compact) {
    if (safe >= 1000000000) return `${(safe / 1000000000).toFixed(2)}B`;
    if (safe >= 1000000) return `${(safe / 1000000).toFixed(2)}M`;
    if (safe >= 1000) return `${(safe / 1000).toFixed(1)}K`;
    return `${safe.toFixed(2)}`;
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(safe);
};

export const formatCurrencyWithDecimals = (amount: number): string => {
  const safe = Number.isFinite(amount) ? amount : 0;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safe);
};

export const formatCurrencyCompact = (amount: number): string => {
  const safe = Number.isFinite(amount) ? amount : 0;
  if (safe >= 1000000000) return `${(safe / 1000000000).toFixed(2)}B`;
  if (safe >= 1000000) return `${(safe / 1000000).toFixed(2)}M`;
  if (safe >= 1000) return `${new Intl.NumberFormat('en-US').format(Math.round(safe))}`;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(safe);
};

export const formatDollar = (amount: number): string => {
  const safe = Number.isFinite(amount) ? amount : 0;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(safe);
};

export const formatDollarWhole = (amount: number): string => {
  const safe = Number.isFinite(amount) ? amount : 0;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(safe);
};

export const formatDollarCompact = (amount: number): string => {
  const safe = Number.isFinite(amount) ? amount : 0;
  if (safe >= 1000000000) return `${(safe / 1000000000).toFixed(2)}B`;
  if (safe >= 1000000) return `${(safe / 1000000).toFixed(2)}M`;
  if (safe >= 1000) return `${new Intl.NumberFormat('en-US').format(Math.round(safe))}`;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(safe);
};

export const formatNumber = (value: number): string => {
  const safe = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat('en-US').format(safe);
};

export const formatCompactNumber = (value: number): string => {
  const safe = Number.isFinite(value) ? value : 0;
  if (safe >= 1000000000) return `${(safe / 1000000000).toFixed(1)}B`;
  if (safe >= 1000000) return `${(safe / 1000000).toFixed(1)}M`;
  if (safe >= 1000) return `${(safe / 1000).toFixed(1)}K`;
  return new Intl.NumberFormat('en-US').format(safe);
};

export const formatDate = (dateString: string): string => {
  const { formatTimestamp, loadTimezoneProfile } = require('./time-service');
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

export const formatDateTime = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/**
 * Format a UTC timestamp using the user's saved timezone profile.
 * Async version that loads the timezone from AsyncStorage.
 */
export async function formatDateTimeTz(dateString: string): Promise<string> {
  const { formatTimestamp, loadTimezoneProfile } = await import('./time-service');
  const profile = await loadTimezoneProfile();
  if (profile) {
    const result = formatTimestamp(dateString, profile.timezone, profile.locale, profile.hour_preference);
    return result.formatted_full;
  }
  return formatDateTime(dateString);
}

/**
 * Format a UTC timestamp using a specific timezone.
 */
export function formatDateTimeInTz(dateString: string, timezone: string, hourPreference: '12h' | '24h' = '12h'): string {
  const { formatTimestamp } = require('./time-service');
  try {
    const result = formatTimestamp(dateString, timezone, 'en-US', hourPreference);
    return result.formatted_full;
  } catch {
    return formatDateTime(dateString);
  }
}

export const formatRelativeTime = (dateString: string): string => {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return formatDate(dateString);
};

export const formatPercentage = (value: number, decimals = 2): string => {
  const safe = Number.isFinite(value) ? value : 0;
  return `${safe >= 0 ? '+' : ''}${safe.toFixed(decimals)}%`;
};

/**
 * Safe percentage formatter — never renders "NaN%" or "undefined%".
 * Returns "Not entered" when the value is missing, "Invalid data" when malformed.
 */
export const formatPercentageSafe = (value: unknown, decimals = 2): string => {
  if (value === null || value === undefined || value === '') return 'Not entered';
  const num = Number(value);
  if (!Number.isFinite(num)) return 'Invalid data';
  return `${num >= 0 ? '+' : ''}${num.toFixed(decimals)}%`;
};

/**
 * Safe currency formatter — never renders "$NaN" or "$undefined".
 * Returns "Not entered" when the value is missing, "Invalid data" when malformed.
 * Confirmed zero → "$0".
 */
export const formatCurrencySafe = (value: unknown, compact = false): string => {
  if (value === null || value === undefined || value === '') return 'Not entered';
  const num = Number(value);
  if (!Number.isFinite(num)) return 'Invalid data';
  return formatCurrency(num, compact);
};

export const formatPhoneNumber = (phone: string): string => {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }
  if (cleaned.length === 11 && cleaned[0] === '1') {
    return `+1 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
  }
  return phone;
};

export const truncateText = (text: string, maxLength: number): string => {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
};

export const capitalize = (text: string): string => {
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
};

export const formatFileSize = (bytes: number): string => {
  const safe = Number.isFinite(bytes) ? bytes : 0;
  if (safe < 1024) return `${safe} B`;
  if (safe < 1024 * 1024) return `${(safe / 1024).toFixed(1)} KB`;
  if (safe < 1024 * 1024 * 1024) return `${(safe / (1024 * 1024)).toFixed(1)} MB`;
  return `${(safe / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

export const formatAmountInput = (value: string): string => {
  const numericValue = value.replace(/[^0-9.]/g, '');
  const parts = numericValue.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
};

export const parseAmountInput = (value: string): string => {
  return value.replace(/,/g, '');
};

export const formatSharesInput = (value: string): string => {
  const numericValue = value.replace(/[^0-9]/g, '');
  return numericValue.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

export const parseSharesInput = (value: string): number => {
  return parseInt(value.replace(/,/g, ''), 10) || 0;
};
