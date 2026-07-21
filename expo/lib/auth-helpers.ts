const ADMIN_ROLES = ['owner', 'admin', 'ceo', 'staff', 'manager', 'analyst', 'support'] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];
export type UserRole = AdminRole | 'investor';

const ROLE_ALIASES: Record<string, UserRole> = {
  super_admin: 'admin',
  superadmin: 'admin',
  administrator: 'admin',
  admin_user: 'admin',
  adminuser: 'admin',
  owner_admin: 'owner',
  owneradmin: 'owner',
  chief_executive_officer: 'ceo',
  chiefexecutiveofficer: 'ceo',
  staff_member: 'staff',
  staffmember: 'staff',
  team_manager: 'manager',
  teammanager: 'manager',
  support_staff: 'support',
  supportstaff: 'support',
  support_agent: 'support',
  supportagent: 'support',
  customer_support: 'support',
  customersupport: 'support',
};

export function canonicalizeRole(role: string | null | undefined): string {
  return role?.trim().toLowerCase().replace(/[\s-]+/g, '_') ?? '';
}

export function normalizeRole(role: string | null | undefined): UserRole {
  const normalized = canonicalizeRole(role);
  if (!normalized) return 'investor';

  const aliasedRole = ROLE_ALIASES[normalized] ?? normalized;
  if (ADMIN_ROLES.includes(aliasedRole as AdminRole)) {
    return aliasedRole as AdminRole;
  }

  return 'investor';
}

export function isAdminRole(role: string | null | undefined): boolean {
  return normalizeRole(role) !== 'investor';
}

export function validateEmail(email: string): boolean {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

/**
 * Enterprise password policy (Phase 5):
 * - minimum 12 characters
 * - at least 1 uppercase letter
 * - at least 1 number
 * - maximum 128 characters (allow long passphrases)
 * - symbols and spaces are accepted (never rejected)
 * - password-manager-generated passwords are supported
 */
export function validatePassword(password: string): { valid: boolean; reason?: string } {
  if (password.length < 12) {
    return { valid: false, reason: 'Password must be at least 12 characters.' };
  }
  if (password.length > 128) {
    return { valid: false, reason: 'Password must be at most 128 characters.' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, reason: 'Password must contain at least 1 uppercase letter.' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, reason: 'Password must contain at least 1 number.' };
  }
  return { valid: true };
}

export function validatePhone(phone: string): boolean {
  const re = /^\+?[\d\s\-()]{10,}$/;
  return re.test(phone);
}

export function sanitizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Use for password sign-in only; trims accidental leading/trailing whitespace from the field. */
export function sanitizePasswordForSignIn(password: string): string {
  return password.trim();
}

/** Auto-format birthday digits into MM/DD/YYYY as the user types. */
export function formatBirthdayInput(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/** Validate MM/DD/YYYY birthday: real date, age 18-120. Returns ISO date (YYYY-MM-DD) or error. */
export function parseBirthday(value: string): { iso: string | null; error: string | null } {
  if (!value.trim()) {
    return { iso: null, error: 'Date of birth is required.' };
  }
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) {
    return { iso: null, error: 'Enter your date of birth as MM/DD/YYYY.' };
  }
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12) {
    return { iso: null, error: 'Please enter a valid month (01-12).' };
  }
  const daysInMonth = new Date(year, month, 0).getDate();
  if (day < 1 || day > daysInMonth) {
    return { iso: null, error: 'Please enter a valid day for that month.' };
  }
  const now = new Date();
  if (year < now.getFullYear() - 120 || year > now.getFullYear()) {
    return { iso: null, error: 'Please enter a valid year.' };
  }
  let age = now.getFullYear() - year;
  const hadBirthdayThisYear =
    now.getMonth() + 1 > month || (now.getMonth() + 1 === month && now.getDate() >= day);
  if (!hadBirthdayThisYear) age -= 1;
  if (age < 18) {
    return { iso: null, error: 'You must be at least 18 years old to create an account.' };
  }
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { iso, error: null };
}
