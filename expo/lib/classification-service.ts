/**
 * IVX Member Classification Service — Client-Side API
 *
 * Fetches the calling member's own classification (tier + status only).
 * Financial details are never exposed to client code.
 */

const API_BASE = process.env.EXPO_PUBLIC_IVX_API_BASE_URL
  ? process.env.EXPO_PUBLIC_IVX_API_BASE_URL.replace(/\/+$/, '')
  : 'https://api.ivxholding.com';

export type MemberTier = 'PENDING' | 'REGULAR' | 'INVESTOR' | 'VIP';
export type InvestorStatus = 'NOT_VERIFIED' | 'ACTIVE' | 'RESTRICTED_OR_PENDING' | 'SUSPENDED';

export interface MemberClassification {
  member_tier: MemberTier;
  investor_status: InvestorStatus;
  classification_reason: string | null;
  classification_updated_at: string | null;
}

export interface ClassificationResult {
  ok: boolean;
  classification?: MemberClassification;
  error?: string;
}

/**
 * Get the calling member's own classification.
 * Requires a valid Supabase auth token.
 */
export async function getMyClassification(accessToken: string): Promise<ClassificationResult> {
  try {
    const response = await fetch(`${API_BASE}/api/members/classification`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      return {
        ok: false,
        error: (errorBody as Record<string, string>)?.error || `Request failed (${response.status})`,
      };
    }

    const data = await response.json() as { ok: boolean; classification: MemberClassification };
    return {
      ok: true,
      classification: data.classification,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Network error',
    };
  }
}

/**
 * Tier display metadata for badges.
 */
export const TIER_META: Record<MemberTier, {
  label: string;
  shortLabel: string;
  color: string;
  bgColor: string;
  borderColor: string;
  icon: string;
  description: string;
}> = {
  PENDING: {
    label: 'Pending Verification',
    shortLabel: 'PENDING',
    color: '#8E8E93',
    bgColor: 'rgba(142, 142, 147, 0.12)',
    borderColor: 'rgba(142, 142, 147, 0.3)',
    icon: 'clock',
    description: 'Basic verification incomplete',
  },
  REGULAR: {
    label: 'Regular Member',
    shortLabel: 'MEMBER',
    color: '#007AFF',
    bgColor: 'rgba(0, 122, 255, 0.12)',
    borderColor: 'rgba(0, 122, 255, 0.3)',
    icon: 'user',
    description: 'Verified registration, zero completed transactions',
  },
  INVESTOR: {
    label: 'Verified Investor',
    shortLabel: 'INVESTOR',
    color: '#34C759',
    bgColor: 'rgba(52, 199, 89, 0.12)',
    borderColor: 'rgba(52, 199, 89, 0.3)',
    icon: 'briefcase',
    description: 'KYC approved with completed investment transactions',
  },
  VIP: {
    label: 'VIP Investor',
    shortLabel: 'VIP',
    color: '#FFD60A',
    bgColor: 'rgba(255, 214, 10, 0.15)',
    borderColor: 'rgba(255, 214, 10, 0.4)',
    icon: 'crown',
    description: 'Qualifying invested capital ≥ $500,000',
  },
};

export const INVESTOR_STATUS_META: Record<InvestorStatus, {
  label: string;
  color: string;
}> = {
  NOT_VERIFIED: { label: 'Not Verified', color: '#8E8E93' },
  ACTIVE: { label: 'Active', color: '#34C759' },
  RESTRICTED_OR_PENDING: { label: 'Restricted/Pending', color: '#FF9500' },
  SUSPENDED: { label: 'Suspended', color: '#FF3B30' },
};