/**
 * IVX Enterprise Registration — Shared Form State, Validation, and API Client
 *
 * Used by both the Expo React Native app (expo/app/enterprise-register.tsx)
 * and the web landing page (expo/ivxholding-landing/enterprise-register.html).
 *
 * Flow:
 *   STEP 1 (Account)   → register individual member → get authUserId
 *   STEP 2 (Role)      → select primary role → maps to registration_type = enterprise
 *   STEP 3 (Enterprise) → company details → POST /api/ivx/enterprise-registration/register
 *   REVIEW → SUBMIT → CONFIRMATION
 *
 * Security:
 *   - Passwords are never persisted in drafts (only a flag that a password was entered)
 *   - Drafts expire after 24 hours
 *   - Idempotency keys prevent duplicate submissions
 *   - No secrets, tokens, or service-role keys in client code
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const API_BASE_URL =
  (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_API_BASE_URL?.trim()?.replace(/\/$/, '')) ||
  'https://api.ivxholding.com';

export const ENTERPRISE_REGISTER_ENDPOINT = '/api/ivx/enterprise-registration/register';
export const MEMBER_REGISTER_ENDPOINT = '/api/members/register';

export const DRAFT_STORAGE_KEY = 'ivx_enterprise_registration_draft';
export const DRAFT_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

export const STEPS = ['account', 'role', 'enterprise', 'review', 'confirmation'] as const;
export type Step = (typeof STEPS)[number];

export const VISIBLE_STEPS: Step[] = ['account', 'role', 'enterprise'];

// ---------------------------------------------------------------------------
// Role options (STEP 2)
// ---------------------------------------------------------------------------

export interface RoleOption {
  id: EnterprisePrimaryRole;
  label: string;
  description: string;
}

export type EnterprisePrimaryRole =
  | 'enterprise'
  | 'investor'
  | 'buyer'
  | 'jv_partner'
  | 'tokenized_interest'
  | 'broker_agent'
  | 'lender'
  | 'vendor_contractor';

export const ROLE_OPTIONS: RoleOption[] = [
  { id: 'enterprise', label: 'Enterprise', description: 'Register a company entity as the primary account holder.' },
  { id: 'investor', label: 'Investor', description: 'Capital partner seeking real estate investment opportunities.' },
  { id: 'buyer', label: 'Buyer', description: 'Acquiring properties directly through the platform.' },
  { id: 'jv_partner', label: 'JV Partner', description: 'Joint venture partnership for shared deals.' },
  { id: 'tokenized_interest', label: 'Tokenized Interest', description: 'Fractional tokenized property interests.' },
  { id: 'broker_agent', label: 'Broker or Agent', description: 'Licensed broker or agent facilitating transactions.' },
  { id: 'lender', label: 'Lender', description: 'Providing capital or financing for deals.' },
  { id: 'vendor_contractor', label: 'Vendor or Contractor', description: 'Service provider for real estate projects.' },
];

// ---------------------------------------------------------------------------
// Company type options (STEP 3)
// ---------------------------------------------------------------------------

export const COMPANY_TYPES = [
  'llc', 'c_corp', 's_corp', 'partnership', 'sole_proprietor', 'trust', 'nonprofit', 'other',
] as const;
export type CompanyType = (typeof COMPANY_TYPES)[number];

export const COMPANY_TYPE_LABELS: Record<CompanyType, string> = {
  llc: 'LLC',
  c_corp: 'C Corporation',
  s_corp: 'S Corporation',
  partnership: 'Partnership',
  sole_proprietor: 'Sole Proprietor',
  trust: 'Trust',
  nonprofit: 'Nonprofit',
  other: 'Other',
};

export const INDUSTRIES = [
  'Real Estate', 'Technology', 'Finance', 'Healthcare', 'Construction',
  'Manufacturing', 'Retail', 'Hospitality', 'Energy', 'Agriculture', 'Other',
] as const;

export const BUSINESS_CATEGORIES = [
  'Investment', 'Development', 'Brokerage', 'Lending', 'Construction',
  'Property Management', 'Consulting', 'Other',
] as const;

// ---------------------------------------------------------------------------
// Form values
// ---------------------------------------------------------------------------

export interface EnterpriseRegistrationFormValues {
  // STEP 1 — Account
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
  dateOfBirth: string;
  gender: string;
  country: string;
  countryCode: string;
  dialCode: string;
  zipCode: string;
  acceptTerms: boolean;
  acceptPrivacy: boolean;

  // STEP 2 — Role
  primaryRole: EnterprisePrimaryRole | '';

  // STEP 3 — Enterprise details
  legalName: string;
  displayName: string;
  companyType: CompanyType | '';
  industry: string;
  website: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  enterpriseCountry: string;
  authorizedRepresentative: string;
  representativeTitle: string;
  teamSize: string;
  businessCategory: string;
  supportingDocumentName: string;
}

export function createEmptyFormValues(): EnterpriseRegistrationFormValues {
  return {
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    password: '',
    dateOfBirth: '',
    gender: '',
    country: 'United States',
    countryCode: 'US',
    dialCode: '+1',
    zipCode: '',
    acceptTerms: false,
    acceptPrivacy: false,
    primaryRole: '',
    legalName: '',
    displayName: '',
    companyType: '',
    industry: '',
    website: '',
    address: '',
    city: '',
    state: '',
    postalCode: '',
    enterpriseCountry: 'United States',
    authorizedRepresentative: '',
    representativeTitle: '',
    teamSize: '',
    businessCategory: '',
    supportingDocumentName: '',
  };
}

// ---------------------------------------------------------------------------
// Submission state
// ---------------------------------------------------------------------------

export type SubmissionStatus = 'idle' | 'submitting' | 'success' | 'error';

export interface EnterpriseRegistrationState {
  currentStep: Step;
  formValues: EnterpriseRegistrationFormValues;
  validationErrors: ValidationErrorMap;
  submissionStatus: SubmissionStatus;
  serverError: string;
  serverErrorCode: string;
  enterpriseId: string;
  memberId: string;
  authUserId: string;
  traceId: string;
  draftUpdatedAt: string;
  idempotencyKey: string;
}

export type ValidationErrorMap = Partial<Record<keyof EnterpriseRegistrationFormValues | 'form', string>>;

export function createInitialState(): EnterpriseRegistrationState {
  return {
    currentStep: 'account',
    formValues: createEmptyFormValues(),
    validationErrors: {},
    submissionStatus: 'idle',
    serverError: '',
    serverErrorCode: '',
    enterpriseId: '',
    memberId: '',
    authUserId: '',
    traceId: '',
    draftUpdatedAt: '',
    idempotencyKey: generateIdempotencyKey(),
  };
}

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

export function generateIdempotencyKey(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 10);
  return `ivx-ent-reg-${ts}-${rand}`;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^\+?[\d\s\-()]{10,}$/;
const ZIP_REGEX = /^[A-Za-z0-9\s\-]{3,10}$/;

export function validateEmail(email: string): boolean {
  return EMAIL_REGEX.test(email.trim().toLowerCase());
}

export function validatePhone(phone: string): boolean {
  return PHONE_REGEX.test(phone.trim());
}

export function validatePassword(password: string): { valid: boolean; reason?: string } {
  if (password.length < 12) return { valid: false, reason: 'Password must be at least 12 characters.' };
  if (password.length > 128) return { valid: false, reason: 'Password must be at most 128 characters.' };
  if (!/[A-Z]/.test(password)) return { valid: false, reason: 'Password must contain at least 1 uppercase letter.' };
  if (!/[0-9]/.test(password)) return { valid: false, reason: 'Password must contain at least 1 number.' };
  return { valid: true };
}

export function validateWebsite(website: string): boolean {
  if (!website.trim()) return true; // optional
  try {
    const withPrefix = website.startsWith('http') ? website : `https://${website}`;
    new URL(withPrefix);
    return true;
  } catch {
    return false;
  }
}

export function validateZip(zip: string): boolean {
  return ZIP_REGEX.test(zip.trim());
}

export function validateStep1(values: EnterpriseRegistrationFormValues): ValidationErrorMap {
  const errors: ValidationErrorMap = {};
  if (!values.firstName.trim()) errors.firstName = 'First name is required.';
  if (!values.lastName.trim()) errors.lastName = 'Last name is required.';
  if (!values.email.trim()) {
    errors.email = 'Email is required.';
  } else if (!validateEmail(values.email)) {
    errors.email = 'Please enter a valid email address.';
  }
  if (!values.phone.trim()) {
    errors.phone = 'Phone number is required.';
  } else if (!validatePhone(values.phone)) {
    errors.phone = 'Please enter a valid phone number.';
  }
  const pwCheck = validatePassword(values.password);
  if (!pwCheck.valid) errors.password = pwCheck.reason;
  if (!values.dateOfBirth.trim()) errors.dateOfBirth = 'Date of birth is required.';
  if (!values.gender.trim()) errors.gender = 'Gender is required.';
  if (!values.zipCode.trim()) errors.zipCode = 'ZIP / postal code is required.';
  else if (!validateZip(values.zipCode)) errors.zipCode = 'Please enter a valid ZIP / postal code.';
  if (!values.acceptTerms) errors.acceptTerms = 'You must accept the Terms of Service.';
  if (!values.acceptPrivacy) errors.acceptPrivacy = 'You must accept the Privacy Policy.';
  return errors;
}

export function validateStep2(values: EnterpriseRegistrationFormValues): ValidationErrorMap {
  const errors: ValidationErrorMap = {};
  if (!values.primaryRole) errors.primaryRole = 'Please select a primary role.';
  return errors;
}

export function validateStep3(values: EnterpriseRegistrationFormValues): ValidationErrorMap {
  const errors: ValidationErrorMap = {};
  if (!values.legalName.trim() || values.legalName.trim().length < 2) {
    errors.legalName = 'Legal company name is required (minimum 2 characters).';
  }
  if (!values.displayName.trim()) {
    errors.displayName = 'Display company name is required.';
  }
  if (!values.companyType) errors.companyType = 'Please select a company type.';
  if (!values.industry.trim()) errors.industry = 'Please select an industry.';
  if (values.website.trim() && !validateWebsite(values.website)) {
    errors.website = 'Please enter a valid website URL.';
  }
  if (!values.address.trim()) errors.address = 'Business address is required.';
  if (!values.city.trim()) errors.city = 'City is required.';
  if (!values.state.trim()) errors.state = 'State / province is required.';
  if (!values.postalCode.trim()) errors.postalCode = 'ZIP / postal code is required.';
  else if (!validateZip(values.postalCode)) errors.postalCode = 'Please enter a valid ZIP / postal code.';
  if (!values.authorizedRepresentative.trim() || values.authorizedRepresentative.trim().length < 2) {
    errors.authorizedRepresentative = 'Authorized representative is required.';
  }
  if (!values.representativeTitle.trim()) errors.representativeTitle = 'Representative title is required.';
  const teamSizeNum = parseInt(values.teamSize, 10);
  if (!values.teamSize.trim() || isNaN(teamSizeNum) || teamSizeNum < 1 || teamSizeNum > 100000) {
    errors.teamSize = 'Team size must be a number between 1 and 100,000.';
  }
  if (!values.businessCategory.trim()) errors.businessCategory = 'Please select a business category.';
  return errors;
}

export function validateStep(step: Step, values: EnterpriseRegistrationFormValues): ValidationErrorMap {
  switch (step) {
    case 'account': return validateStep1(values);
    case 'role': return validateStep2(values);
    case 'enterprise': return validateStep3(values);
    default: return {};
  }
}

export function isStepValid(step: Step, values: EnterpriseRegistrationFormValues): boolean {
  return Object.keys(validateStep(step, values)).length === 0;
}

// ---------------------------------------------------------------------------
// API types
// ---------------------------------------------------------------------------

export interface IndividualRegistrationResult {
  ok: boolean;
  stage?: string;
  authUserId?: string;
  email?: string;
  traceId?: string;
  registrationRequestId?: string;
  code?: string;
  message?: string;
  error?: string;
}

export interface EnterpriseRegistrationResult {
  ok: boolean;
  enterpriseId?: string;
  membershipId?: string;
  duplicate?: boolean;
  duplicateReason?: string;
  error?: string;
  errorCode?: string;
  traceId: string;
  deploymentMarker?: string;
}

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

export interface IndividualRegisterPayload {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  phone: string;
  country: string;
  zipCode: string;
  roles: string[];
  acceptTerms: boolean;
  registrationRequestId: string;
}

/**
 * Register an individual member (STEP 1).
 * Calls POST /api/members/register on the production backend.
 */
export async function registerIndividualMember(
  payload: IndividualRegisterPayload
): Promise<IndividualRegistrationResult> {
  const url = `${API_BASE_URL}${MEMBER_REGISTER_ENDPOINT}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  return data as IndividualRegistrationResult;
}

export interface EnterpriseRegisterPayload {
  ownerAuthUserId: string;
  legalName: string;
  displayName: string;
  companyType: string;
  industry: string;
  website: string;
  address: string;
  authorizedRepresentative: string;
  representativeJobTitle: string;
  teamSize: number;
  businessCategory: string;
  sourceChannel: string;
  traceId?: string;
}

/**
 * Register an enterprise entity (STEP 3).
 * Calls POST /api/ivx/enterprise-registration/register on the production backend.
 * Requires the authUserId from STEP 1.
 */
export async function registerEnterpriseEntity(
  payload: EnterpriseRegisterPayload
): Promise<EnterpriseRegistrationResult> {
  const url = `${API_BASE_URL}${ENTERPRISE_REGISTER_ENDPOINT}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  return data as EnterpriseRegistrationResult;
}

// ---------------------------------------------------------------------------
// Error message mapping
// ---------------------------------------------------------------------------

export function getUserFriendlyError(errorCode: string, fallback: string): string {
  const map: Record<string, string> = {
    INVALID_INPUT: 'Please check all required fields and try again.',
    DUPLICATE_ENTERPRISE: 'An enterprise with this legal name or website already exists.',
    DUPLICATE_LEGAL_NAME: 'An enterprise with this legal name already exists.',
    DUPLICATE_DOMAIN: 'An enterprise with this website domain already exists.',
    CREATION_FAILED: 'We could not create the enterprise. Please try again.',
    MEMBERSHIP_FAILED: 'Enterprise created, but membership binding failed. Contact support.',
    AUDIT_FAILED: 'Enterprise created, but audit logging failed. Contact support.',
    NOT_AUTHORIZED: 'You are not authorized to perform this action.',
    INVALID_EMAIL: 'This email is already registered. Please sign in instead.',
    WEAK_PASSWORD: 'Password does not meet the minimum requirements.',
    AUTH_CREATION_FAILED: 'A previous attempt is still processing. Please wait and try again.',
    UNKNOWN_ERROR: 'An unexpected error occurred. Please try again.',
  };
  return map[errorCode] || fallback || 'An error occurred. Please try again.';
}

// ---------------------------------------------------------------------------
// Draft storage (platform-agnostic interface)
// ---------------------------------------------------------------------------

export interface DraftStorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/**
 * Serializable draft (no password — only a flag that password was entered).
 */
export interface EnterpriseRegistrationDraft {
  formValues: Omit<EnterpriseRegistrationFormValues, 'password'> & { passwordEntered: boolean };
  currentStep: Step;
  draftUpdatedAt: string;
  idempotencyKey: string;
}

export function formValuesToDraft(values: EnterpriseRegistrationFormValues, step: Step, idempotencyKey: string): EnterpriseRegistrationDraft {
  const { password, ...rest } = values;
  return {
    formValues: { ...rest, passwordEntered: !!password },
    currentStep: step,
    draftUpdatedAt: new Date().toISOString(),
    idempotencyKey,
  };
}

export function draftToFormValues(draft: EnterpriseRegistrationDraft): EnterpriseRegistrationFormValues {
  const { passwordEntered, ...rest } = draft.formValues;
  return {
    ...createEmptyFormValues(),
    ...rest,
    password: '', // Never restore password — user must re-enter
    currentStep: draft.currentStep,
  } as EnterpriseRegistrationFormValues;
}

export function isDraftExpired(draft: EnterpriseRegistrationDraft): boolean {
  const updated = new Date(draft.draftUpdatedAt).getTime();
  if (isNaN(updated)) return true;
  return Date.now() - updated > DRAFT_EXPIRY_MS;
}

export async function saveDraft(adapter: DraftStorageAdapter, values: EnterpriseRegistrationFormValues, step: Step, idempotencyKey: string): Promise<void> {
  const draft = formValuesToDraft(values, step, idempotencyKey);
  try {
    await adapter.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch (err) {
    console.warn('[EnterpriseReg] Failed to save draft:', err);
  }
}

export async function loadDraft(adapter: DraftStorageAdapter): Promise<EnterpriseRegistrationDraft | null> {
  try {
    const raw = await adapter.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as EnterpriseRegistrationDraft;
    if (isDraftExpired(draft)) {
      await adapter.removeItem(DRAFT_STORAGE_KEY);
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

export async function clearDraft(adapter: DraftStorageAdapter): Promise<void> {
  try {
    await adapter.removeItem(DRAFT_STORAGE_KEY);
  } catch (err) {
    console.warn('[EnterpriseReg] Failed to clear draft:', err);
  }
}

// ---------------------------------------------------------------------------
// Full submission flow (orchestrates STEP 1 + STEP 3 API calls)
// ---------------------------------------------------------------------------

export interface FullSubmissionInput {
  formValues: EnterpriseRegistrationFormValues;
  idempotencyKey: string;
}

export interface FullSubmissionResult {
  ok: boolean;
  authUserId?: string;
  enterpriseId?: string;
  membershipId?: string;
  traceId?: string;
  memberTraceId?: string;
  error?: string;
  errorCode?: string;
  stage?: string;
}

/**
 * Map an enterprise primary role to a valid individual member role
 * for the individual registration step. The enterprise-specific identity
 * (registration_type=enterprise, primary_role=enterprise_owner) is set by
 * the enterprise registration API call, not the individual member registration.
 */
function mapToIndividualRole(primaryRole: EnterprisePrimaryRole): string {
  const map: Record<EnterprisePrimaryRole, string> = {
    enterprise: 'investor',
    investor: 'investor',
    buyer: 'buyer',
    jv_partner: 'jv_partner',
    tokenized_interest: 'tokenized',
    broker_agent: 'broker',
    lender: 'investor',
    vendor_contractor: 'investor',
  };
  return map[primaryRole] || 'investor';
}

/**
 * Execute the full enterprise registration flow:
 *   1. Register individual member → get authUserId
 *   2. Register enterprise entity with authUserId → get enterpriseId
 *
 * The idempotency key is used as the registrationRequestId for the individual
 * member registration. If the same key is submitted again, the backend returns
 * the existing completed result instead of creating a duplicate.
 */
export async function executeFullEnterpriseRegistration(
  input: FullSubmissionInput
): Promise<FullSubmissionResult> {
  const { formValues: v, idempotencyKey } = input;

  // STEP 1: Register individual member
  const individualResult = await registerIndividualMember({
    email: v.email.trim().toLowerCase(),
    password: v.password,
    firstName: v.firstName.trim(),
    lastName: v.lastName.trim(),
    dateOfBirth: v.dateOfBirth,
    gender: v.gender,
    phone: v.phone.trim(),
    country: v.country,
    zipCode: v.zipCode.trim(),
    roles: [mapToIndividualRole(v.primaryRole as EnterprisePrimaryRole)],
    acceptTerms: v.acceptTerms,
    registrationRequestId: idempotencyKey,
  });

  if (!individualResult.ok || !individualResult.authUserId) {
    return {
      ok: false,
      error: getUserFriendlyError(individualResult.code || '', individualResult.message || individualResult.error || ''),
      errorCode: individualResult.code || 'UNKNOWN_ERROR',
      stage: 'individual_registration',
      memberTraceId: individualResult.traceId,
    };
  }

  const authUserId = individualResult.authUserId;

  // STEP 3: Register enterprise entity
  const enterpriseResult = await registerEnterpriseEntity({
    ownerAuthUserId: authUserId,
    legalName: v.legalName.trim(),
    displayName: v.displayName.trim(),
    companyType: v.companyType,
    industry: v.industry,
    website: v.website.trim(),
    address: `${v.address.trim()}, ${v.city.trim()}, ${v.state.trim()} ${v.postalCode.trim()}, ${v.enterpriseCountry}`,
    authorizedRepresentative: v.authorizedRepresentative.trim(),
    representativeJobTitle: v.representativeTitle.trim(),
    teamSize: parseInt(v.teamSize, 10) || 1,
    businessCategory: v.businessCategory,
    sourceChannel: 'enterprise_registration_ui',
    traceId: individualResult.traceId,
  });

  if (!enterpriseResult.ok || !enterpriseResult.enterpriseId) {
    return {
      ok: false,
      authUserId,
      error: getUserFriendlyError(enterpriseResult.errorCode || '', enterpriseResult.error || ''),
      errorCode: enterpriseResult.errorCode || 'UNKNOWN_ERROR',
      stage: 'enterprise_registration',
      traceId: enterpriseResult.traceId,
      memberTraceId: individualResult.traceId,
    };
  }

  return {
    ok: true,
    authUserId,
    enterpriseId: enterpriseResult.enterpriseId,
    membershipId: enterpriseResult.membershipId,
    traceId: enterpriseResult.traceId,
    memberTraceId: individualResult.traceId,
    stage: 'COMPLETED',
  };
}
