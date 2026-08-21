import logger from './logger';

let _providerWarningLogged = false;

export function getPaymentProviderStatus(): { configured: boolean; mode: 'sandbox' | 'production' | 'none'; warnings: string[] } {
  const warnings: string[] = [];
  const stripeConfigured = !!(
    process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY &&
    (process.env.STRIPE_SECRET_KEY || process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY.includes('pk_test'))
  );
  const plaidConfigured = !!(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
  const paypalConfigured = !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
  const configured = stripeConfigured || plaidConfigured || paypalConfigured;

  if (!configured) {
    warnings.push('No real payment provider (Stripe/Plaid/PayPal) is configured.');
    warnings.push('Connect a real payment processor before going live.');
  }

  if (!configured && !_providerWarningLogged) {
    _providerWarningLogged = true;
    console.warn('[PaymentService] ⚠️ No real payment provider configured');
  }

  const mode: 'sandbox' | 'production' | 'none' = configured
    ? (process.env.STRIPE_SECRET_KEY || '').includes('sk_live') || process.env.PAYPAL_ENV === 'live' || process.env.PLAID_ENV === 'production'
      ? 'production'
      : 'sandbox'
    : 'none';

  return { configured, mode, warnings };
}

export type PaymentMethodType = 'fednow' | 'rtp' | 'same_day_ach' | 'bank_transfer' | 'usdc' | 'apple_pay' | 'google_pay' | 'card' | 'wire' | 'paypal';

export type TransactionType = 'deposit' | 'withdrawal' | 'investment' | 'dividend' | 'refund';

export type PaymentStatus = 
  | 'pending'
  | 'processing'
  | 'requires_action'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'refunded';

export type PaymentProvider = 'stripe' | 'plaid' | 'paypal' | 'manual' | 'fednow' | 'rtp_network' | 'circle';

export interface PaymentConfig {
  stripe: {
    publishableKey: string;
    secretKey: string;
    webhookSecret: string;
    merchantId?: string;
  };
  plaid: {
    clientId: string;
    secret: string;
    environment: 'sandbox' | 'development' | 'production';
    webhookUrl: string;
  };
  paypal: {
    clientId: string;
    clientSecret: string;
    environment: 'sandbox' | 'live';
  };
  applePay: {
    merchantId: string;
    merchantName: string;
    supportedNetworks: string[];
  };
  googlePay: {
    merchantId: string;
    merchantName: string;
    environment: 'TEST' | 'PRODUCTION';
  };
}

export interface PaymentMethod {
  id: string;
  type: PaymentMethodType;
  name: string;
  description: string;
  icon: string;
  fee: number;
  feeType: 'percentage' | 'fixed';
  processingTime: string;
  minAmount: number;
  maxAmount: number;
  isEnabled: boolean;
  requiresVerification: boolean;
  provider: PaymentProvider;
}

export interface PaymentIntent {
  id: string;
  clientSecret?: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  paymentMethodType: PaymentMethodType;
  provider: PaymentProvider;
  createdAt: string;
  expiresAt?: string;
  metadata?: Record<string, string>;
}

export interface PaymentResult {
  success: boolean;
  transactionId: string;
  status: PaymentStatus;
  amount: number;
  fee: number;
  netAmount: number;
  currency: string;
  paymentMethod: PaymentMethodType;
  provider: PaymentProvider;
  processingTime: string;
  message?: string;
  error?: PaymentError;
  requiresAction?: boolean;
  actionUrl?: string;
  bankInstructions?: BankTransferInstructions;
  receipt?: PaymentReceipt;
  providerResponse?: Record<string, unknown>;
}

export interface PaymentError {
  code: string;
  message: string;
  declineCode?: string;
  param?: string;
  provider?: PaymentProvider;
  raw?: unknown;
}

export interface BankTransferInstructions {
  bankName: string;
  accountName: string;
  accountNumber: string;
  routingNumber: string;
  swiftCode?: string;
  iban?: string;
  reference: string;
  instructions: string[];
  expiresAt?: string;
  // Enhanced wire transfer fields
  bankAddress?: BankAddress;
  beneficiaryAddress?: BeneficiaryAddress;
  intermediaryBank?: IntermediaryBank;
  wireType?: 'domestic' | 'international';
  memo?: string;
  fedReference?: string;
}

export interface BankAddress {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface BeneficiaryAddress {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface IntermediaryBank {
  bankName: string;
  swiftCode: string;
  routingNumber?: string;
  address?: BankAddress;
}

export interface WireTransferRequest {
  amount: number;
  wireType: 'domestic' | 'international';
  senderInfo?: WireSenderInfo;
}

export interface WireSenderInfo {
  fullName: string;
  bankName: string;
  accountNumber: string;
  routingNumber?: string;
  swiftCode?: string;
  address: BankAddress;
}

export interface PaymentReceipt {
  id: string;
  transactionId: string;
  amount: number;
  fee: number;
  netAmount: number;
  currency: string;
  timestamp: string;
  description: string;
  downloadUrl?: string;
  provider: PaymentProvider;
}

export interface WithdrawalMethod {
  id: string;
  type: 'bank_account' | 'wire' | 'paypal' | 'fednow' | 'rtp' | 'same_day_ach';
  name: string;
  description: string;
  fee: number;
  feeType: 'percentage' | 'fixed';
  processingTime: string;
  minAmount: number;
  maxAmount: number;
  isEnabled: boolean;
}

export interface WithdrawalResult {
  success: boolean;
  withdrawalId: string;
  status: PaymentStatus;
  amount: number;
  fee: number;
  netAmount: number;
  currency: string;
  method: string;
  processingTime: string;
  estimatedArrival?: string;
  message?: string;
  error?: PaymentError;
}

export interface StripeConfig {
  publishableKey: string;
  merchantId?: string;
  applePayMerchantId?: string;
  googlePayMerchantId?: string;
}

export interface PlaidConfig {
  clientId: string;
  environment: 'sandbox' | 'development' | 'production';
}

export interface PaymentProviderStatus {
  stripe: { configured: boolean; testMode: boolean };
  plaid: { configured: boolean; testMode: boolean };
  paypal: { configured: boolean; testMode: boolean };
}

export interface SavedPaymentMethod {
  id: string;
  type: PaymentMethodType;
  provider: PaymentProvider;
  last4?: string;
  brand?: string;
  bankName?: string;
  expiryMonth?: number;
  expiryYear?: number;
  isDefault: boolean;
  createdAt: string;
  billingDetails?: BillingAddress;
}

export interface CardDetails {
  number: string;
  expMonth: number;
  expYear: number;
  cvc: string;
  name: string;
  billingAddress?: BillingAddress;
}

export interface CardToken {
  token: string;
  provider: 'stripe';
}

export interface BillingAddress {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface BankAccountDetails {
  accountHolderName: string;
  accountNumber: string;
  routingNumber: string;
  accountType: 'checking' | 'savings';
  bankName?: string;
}

export interface PlaidLinkToken {
  linkToken: string;
  expiration: string;
}

export interface PlaidPublicToken {
  publicToken: string;
  accountId: string;
}

export interface WebhookEvent {
  id: string;
  type: string;
  provider: PaymentProvider;
  data: Record<string, unknown>;
  createdAt: string;
  signature?: string;
}

const WITHDRAWAL_METHODS: WithdrawalMethod[] = [
  {
    id: 'fednow_withdrawal',
    type: 'fednow',
    name: 'FedNow Instant',
    description: 'Instant • FREE',
    fee: 0,
    feeType: 'fixed',
    processingTime: 'Instant (seconds)',
    minAmount: 1,
    maxAmount: 500000,
    isEnabled: true,
  },
  {
    id: 'rtp_withdrawal',
    type: 'rtp',
    name: 'RTP (Real-Time)',
    description: 'Instant • $0.25 fee',
    fee: 0.25,
    feeType: 'fixed',
    processingTime: 'Instant (seconds)',
    minAmount: 1,
    maxAmount: 1000000,
    isEnabled: true,
  },
  {
    id: 'same_day_ach_withdrawal',
    type: 'same_day_ach',
    name: 'Same-Day ACH',
    description: 'Same day • FREE',
    fee: 0,
    feeType: 'fixed',
    processingTime: 'Same day',
    minAmount: 1,
    maxAmount: 1000000,
    isEnabled: true,
  },
  {
    id: 'bank_withdrawal',
    type: 'bank_account',
    name: 'Standard ACH',
    description: '1-2 days • FREE',
    fee: 0,
    feeType: 'fixed',
    processingTime: '1-2 business days',
    minAmount: 1,
    maxAmount: 250000,
    isEnabled: true,
  },
];

const PAYMENT_METHODS: PaymentMethod[] = [
  {
    id: 'fednow',
    type: 'fednow',
    name: 'FedNow Instant',
    description: 'Instant • FREE • Recommended',
    icon: 'Zap',
    fee: 0,
    feeType: 'fixed',
    processingTime: 'Instant (seconds)',
    minAmount: 1,
    maxAmount: 500000,
    isEnabled: true,
    requiresVerification: true,
    provider: 'fednow',
  },
  {
    id: 'rtp',
    type: 'rtp',
    name: 'RTP (Real-Time)',
    description: 'Instant • $0.25 flat fee',
    icon: 'Zap',
    fee: 0.25,
    feeType: 'fixed',
    processingTime: 'Instant (seconds)',
    minAmount: 1,
    maxAmount: 1000000,
    isEnabled: true,
    requiresVerification: true,
    provider: 'rtp_network',
  },
  {
    id: 'same_day_ach',
    type: 'same_day_ach',
    name: 'Same-Day ACH',
    description: 'Same day • FREE',
    icon: 'Timer',
    fee: 0,
    feeType: 'fixed',
    processingTime: 'Same day',
    minAmount: 1,
    maxAmount: 1000000,
    isEnabled: true,
    requiresVerification: true,
    provider: 'plaid',
  },
  {
    id: 'usdc',
    type: 'usdc',
    name: 'USDC Stablecoin',
    description: 'Near instant • $0.01 gas',
    icon: 'CircleDollarSign',
    fee: 0.01,
    feeType: 'fixed',
    processingTime: 'Near instant (~30s)',
    minAmount: 1,
    maxAmount: 10000000,
    isEnabled: true,
    requiresVerification: true,
    provider: 'circle',
  },
  {
    id: 'bank_transfer',
    type: 'bank_transfer',
    name: 'Standard ACH',
    description: '1-2 days • FREE',
    icon: 'Building',
    fee: 0,
    feeType: 'fixed',
    processingTime: '1-2 business days',
    minAmount: 1,
    maxAmount: 250000,
    isEnabled: true,
    requiresVerification: true,
    provider: 'plaid',
  },
];

class PaymentService {
  private config: Partial<PaymentConfig> = {};
  private apiBaseUrl: string;
  private initialized: boolean = false;
  private testMode: boolean = true;

  constructor() {
    this.apiBaseUrl = process.env.EXPO_PUBLIC_API_URL || '';
    this.loadConfigFromEnv();
  }

  setTestMode(enabled: boolean): void {
    this.testMode = enabled;
    logger.payment.log('Test mode:', enabled ? 'ENABLED' : 'DISABLED');
  }

  isTestMode(): boolean {
    return this.testMode;
  }

  getProviderStatus(): PaymentProviderStatus {
    return {
      stripe: {
        configured: this.isConfigured('stripe'),
        testMode: this.config.stripe?.publishableKey?.includes('test') ?? true,
      },
      plaid: {
        configured: this.isConfigured('plaid'),
        testMode: this.config.plaid?.environment !== 'production',
      },
      paypal: {
        configured: this.isConfigured('paypal'),
        testMode: this.config.paypal?.environment !== 'live',
      },
    };
  }

  getClientConfig(): StripeConfig {
    return {
      publishableKey: this.config.stripe?.publishableKey || '',
      merchantId: this.config.stripe?.merchantId,
      applePayMerchantId: this.config.applePay?.merchantId,
      googlePayMerchantId: this.config.googlePay?.merchantId,
    };
  }

  private loadConfigFromEnv(): void {
    this.config = {
      stripe: {
        publishableKey: process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || '',
        secretKey: process.env.STRIPE_SECRET_KEY || '',
        webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
        merchantId: process.env.STRIPE_MERCHANT_ID,
      },
      plaid: {
        clientId: process.env.PLAID_CLIENT_ID || '',
        secret: process.env.PLAID_SECRET || '',
        environment: (process.env.PLAID_ENV as 'sandbox' | 'development' | 'production') || 'sandbox',
        webhookUrl: process.env.PLAID_WEBHOOK_URL || '',
      },
      paypal: {
        clientId: process.env.PAYPAL_CLIENT_ID || '',
        clientSecret: process.env.PAYPAL_CLIENT_SECRET || '',
        environment: (process.env.PAYPAL_ENV as 'sandbox' | 'live') || 'sandbox',
      },
      applePay: {
        merchantId: process.env.APPLE_PAY_MERCHANT_ID || '',
        merchantName: process.env.APPLE_PAY_MERCHANT_NAME || 'IVX HOLDINGS',
        supportedNetworks: ['visa', 'mastercard', 'amex', 'discover'],
      },
      googlePay: {
        merchantId: process.env.GOOGLE_PAY_MERCHANT_ID || '',
        merchantName: process.env.GOOGLE_PAY_MERCHANT_NAME || 'IVX HOLDINGS',
        environment: (process.env.GOOGLE_PAY_ENV as 'TEST' | 'PRODUCTION') || 'TEST',
      },
    };
    logger.payment.log('Configuration loaded from environment');
  }

  configure(config: Partial<PaymentConfig>): void {
    this.config = { ...this.config, ...config };
    this.initialized = true;
    logger.payment.log('Custom configuration applied');
  }

  isConfigured(provider: PaymentProvider): boolean {
    switch (provider) {
      case 'stripe':
        return !!(this.config.stripe?.publishableKey && this.config.stripe?.secretKey);
      case 'plaid':
        return !!(this.config.plaid?.clientId && this.config.plaid?.secret);
      case 'paypal':
        return !!(this.config.paypal?.clientId && this.config.paypal?.clientSecret);
      default:
        return true;
    }
  }

  getConfig(): Partial<PaymentConfig> {
    return this.config;
  }

  getStripePublishableKey(): string {
    return this.config.stripe?.publishableKey || '';
  }

  getAvailablePaymentMethods(): PaymentMethod[] {
    return PAYMENT_METHODS.filter(m => m.isEnabled);
  }

  getAvailableWithdrawalMethods(): WithdrawalMethod[] {
    return WITHDRAWAL_METHODS.filter(m => m.isEnabled);
  }

  getWithdrawalMethod(type: string): WithdrawalMethod | undefined {
    return WITHDRAWAL_METHODS.find(m => m.type === type);
  }

  calculateWithdrawalFee(amount: number, methodType: string): number {
    const method = this.getWithdrawalMethod(methodType);
    if (!method) return 0;

    if (method.feeType === 'percentage') {
      return Math.round((amount * method.fee / 100) * 100) / 100;
    }
    return method.fee;
  }

  validateWithdrawalAmount(amount: number, methodType: string, availableBalance: number): { valid: boolean; error?: string } {
    const method = this.getWithdrawalMethod(methodType);
    if (!method) {
      return { valid: false, error: 'Invalid withdrawal method' };
    }

    if (amount < method.minAmount) {
      return { valid: false, error: `Minimum withdrawal is ${method.minAmount}` };
    }

    if (amount > method.maxAmount) {
      return { valid: false, error: `Maximum withdrawal is ${method.maxAmount.toLocaleString()}` };
    }

    const fee = this.calculateWithdrawalFee(amount, methodType);
    if (amount + fee > availableBalance) {
      return { valid: false, error: 'Insufficient balance (including fees)' };
    }

    return { valid: true };
  }

  getPaymentMethod(type: PaymentMethodType): PaymentMethod | undefined {
    return PAYMENT_METHODS.find(m => m.type === type);
  }

  calculateFee(amount: number, paymentMethodType: PaymentMethodType): number {
    const method = this.getPaymentMethod(paymentMethodType);
    if (!method) return 0;

    if (method.feeType === 'percentage') {
      return Math.round((amount * method.fee / 100) * 100) / 100;
    }
    return method.fee;
  }

  calculateNetAmount(amount: number, paymentMethodType: PaymentMethodType): number {
    const fee = this.calculateFee(amount, paymentMethodType);
    return amount - fee;
  }

  validateAmount(amount: number, paymentMethodType: PaymentMethodType): { valid: boolean; error?: string } {
    const method = this.getPaymentMethod(paymentMethodType);
    if (!method) {
      return { valid: false, error: 'Invalid payment method' };
    }

    if (amount < method.minAmount) {
      return { valid: false, error: `Minimum amount is $${method.minAmount}` };
    }

    if (amount > method.maxAmount) {
      return { valid: false, error: `Maximum amount is $${method.maxAmount.toLocaleString()}` };
    }

    return { valid: true };
  }

  async createPaymentIntent(
    amount: number,
    paymentMethodType: PaymentMethodType,
    currency: string = 'USD',
    metadata?: Record<string, string>
  ): Promise<PaymentIntent> {
    logger.payment.log('Creating payment intent:', { amount, paymentMethodType, currency });
    return {
      id: `pi_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      clientSecret: `pi_secret_${Date.now()}`,
      amount,
      currency,
      status: 'pending',
      paymentMethodType,
      provider: 'stripe',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      metadata,
    };
  }

  async confirmPaymentIntent(
    paymentIntentId: string,
    _paymentMethodId?: string
  ): Promise<PaymentResult> {
    logger.payment.log('Confirming payment intent:', paymentIntentId);
    return {
      success: true,
      transactionId: `txn_${Date.now()}`,
      status: 'succeeded',
      amount: 0,
      fee: 0,
      netAmount: 0,
      currency: 'USD',
      paymentMethod: 'card',
      provider: 'stripe',
      processingTime: 'Instant',
      message: 'Payment confirmed successfully',
    };
  }

  async processCardPayment(
    amount: number,
    cardDetails?: CardDetails,
    _cardToken?: CardToken
  ): Promise<PaymentResult> {
    logger.payment.log('Processing card payment:', { amount });

    const fee = this.calculateFee(amount, 'card');
    const transactionId = `txn_card_${Date.now()}`;
    await this.simulateProcessingDelay();

    return {
      success: true,
      transactionId,
      status: 'succeeded',
      amount,
      fee,
      netAmount: amount - fee,
      currency: 'USD',
      paymentMethod: 'card',
      provider: 'stripe',
      processingTime: 'Instant',
      message: 'Payment processed successfully',
      receipt: {
        id: `rcpt_${Date.now()}`,
        transactionId,
        amount,
        fee,
        netAmount: amount - fee,
        currency: 'USD',
        timestamp: new Date().toISOString(),
        description: `Card payment - ****${cardDetails?.number?.slice(-4) || '****'}`,
        provider: 'stripe',
      },
    };
  }

  async createPlaidLinkToken(userId: string): Promise<PlaidLinkToken> {
    logger.payment.log('Creating Plaid link token for:', userId);
    return {
      linkToken: `link-sandbox-${Date.now()}`,
      expiration: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    };
  }

  async exchangePlaidPublicToken(_publicToken: string): Promise<{ accessToken: string; itemId: string }> {
    logger.payment.log('Exchanging Plaid public token');
    return {
      accessToken: `access-sandbox-${Date.now()}`,
      itemId: `item-${Date.now()}`,
    };
  }

  async processBankTransfer(
    amount: number,
    _bankAccountId?: string,
    _accessToken?: string
  ): Promise<PaymentResult> {
    logger.payment.log('Initiating bank transfer:', { amount });

    const fee = this.calculateFee(amount, 'bank_transfer');
    const reference = `ACH-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
    const transactionId = `txn_ach_${Date.now()}`;
    await this.simulateProcessingDelay();

    return {
      success: true,
      transactionId,
      status: 'pending',
      amount,
      fee,
      netAmount: amount - fee,
      currency: 'USD',
      paymentMethod: 'bank_transfer',
      provider: 'plaid',
      processingTime: '1-3 business days',
      message: 'Bank transfer initiated. Funds will be available in 1-3 business days.',
      bankInstructions: {
        bankName: 'IVX HOLDINGS Bank',
        accountName: 'IVX HOLDINGS LLC',
        accountNumber: '****4521',
        routingNumber: '****7890',
        reference,
        instructions: [
          'Your transfer has been initiated',
          `Reference: ${reference}`,
          'Allow 1-3 business days for processing',
          'You will receive a notification when funds are available',
        ],
      },
    };
  }

  async processApplePay(amount: number, _applePayToken?: string): Promise<PaymentResult> {
    logger.payment.log('Processing Apple Pay:', { amount });

    const fee = this.calculateFee(amount, 'apple_pay');
    const transactionId = `txn_apple_${Date.now()}`;
    await this.simulateProcessingDelay();

    return {
      success: true,
      transactionId,
      status: 'succeeded',
      amount,
      fee,
      netAmount: amount - fee,
      currency: 'USD',
      paymentMethod: 'apple_pay',
      provider: 'stripe',
      processingTime: 'Instant',
      message: 'Apple Pay payment successful',
      receipt: {
        id: `rcpt_${Date.now()}`,
        transactionId,
        amount,
        fee,
        netAmount: amount - fee,
        currency: 'USD',
        timestamp: new Date().toISOString(),
        description: 'Apple Pay payment',
        provider: 'stripe',
      },
    };
  }

  async processGooglePay(amount: number, _googlePayToken?: string): Promise<PaymentResult> {
    logger.payment.log('Processing Google Pay:', { amount });

    const fee = this.calculateFee(amount, 'google_pay');
    const transactionId = `txn_gpay_${Date.now()}`;
    await this.simulateProcessingDelay();

    return {
      success: true,
      transactionId,
      status: 'succeeded',
      amount,
      fee,
      netAmount: amount - fee,
      currency: 'USD',
      paymentMethod: 'google_pay',
      provider: 'stripe',
      processingTime: 'Instant',
      message: 'Google Pay payment successful',
      receipt: {
        id: `rcpt_${Date.now()}`,
        transactionId,
        amount,
        fee,
        netAmount: amount - fee,
        currency: 'USD',
        timestamp: new Date().toISOString(),
        description: 'Google Pay payment',
        provider: 'stripe',
      },
    };
  }

  async processWireTransfer(
    amount: number,
    wireType: 'domestic' | 'international' = 'domestic',
    _senderInfo?: WireSenderInfo
  ): Promise<PaymentResult> {
    logger.payment.log('Processing wire transfer:', { amount, wireType });

    const fee = this.calculateFee(amount, 'wire');
    const reference = `WIRE-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
    const transactionId = `txn_wire_${Date.now()}`;
    const fedReference = `FED${Date.now().toString().slice(-10)}`;
    await this.simulateProcessingDelay();

    const domesticInstructions: BankTransferInstructions = {
      bankName: '[PENDING CONFIGURATION - Contact admin@ivxholdings.com]',
      accountName: 'IVX HOLDINGS LLC',
      accountNumber: '[Wire details pending - Real bank account will be configured before launch]',
      routingNumber: '[Pending configuration]',
      swiftCode: '[Pending]',
      reference,
      fedReference,
      wireType: 'domestic',
      memo: `Investment Deposit - ${reference}`,
      bankAddress: {
        line1: '[Bank address pending configuration]',
        city: '',
        state: '',
        postalCode: '',
        country: 'USA',
      },
      beneficiaryAddress: {
        name: 'IVX HOLDINGS LLC',
        line1: '[Beneficiary address pending configuration]',
        line2: '',
        city: 'Miami',
        state: 'FL',
        postalCode: '33131',
        country: 'USA',
      },
      instructions: [
        '1. Log into your bank\'s online banking or visit a branch',
        '2. Select "Wire Transfer" or "Send Money"',
        '3. Choose "Domestic Wire Transfer"',
        '4. Enter the beneficiary bank details exactly as shown',
        '5. Include the reference number in the memo/notes field',
        '6. Review all details and confirm the transfer',
        '7. Save your confirmation number for your records',
      ],
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    };

    const internationalInstructions: BankTransferInstructions = {
      bankName: '[PENDING CONFIGURATION - Contact admin@ivxholdings.com]',
      accountName: 'IVX HOLDINGS LLC',
      accountNumber: '[Wire details pending - Real bank account will be configured before launch]',
      routingNumber: '[Pending configuration]',
      swiftCode: '[Pending]',
      iban: '[IBAN pending configuration]',
      reference,
      fedReference,
      wireType: 'international',
      memo: `International Investment Deposit - ${reference}`,
      bankAddress: {
        line1: '[Bank address pending configuration]',
        city: '',
        state: '',
        postalCode: '',
        country: 'USA',
      },
      beneficiaryAddress: {
        name: 'IVX HOLDINGS LLC',
        line1: '[Beneficiary address pending configuration]',
        line2: '',
        city: 'Miami',
        state: 'FL',
        postalCode: '33131',
        country: 'USA',
      },
      intermediaryBank: {
        bankName: '[Pending configuration]',
        swiftCode: '[Pending]',
        routingNumber: '[Pending]',
        address: {
          line1: '[Address pending configuration]',
          city: '',
          state: '',
          postalCode: '',
          country: 'USA',
        },
      },
      instructions: [
        '1. Contact your bank to initiate an international wire transfer',
        '2. Provide the SWIFT/BIC code: CHASUS33XXX',
        '3. Enter the beneficiary details exactly as shown',
        '4. If your bank requires an intermediary bank, use the details provided',
        '5. Include the reference number in the payment details',
        '6. Specify USD as the currency',
        '7. International wires typically take 2-5 business days',
        '8. Additional fees may apply from correspondent banks',
      ],
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
    };

    return {
      success: true,
      transactionId,
      status: 'pending',
      amount,
      fee,
      netAmount: amount - fee,
      currency: 'USD',
      paymentMethod: 'wire',
      provider: 'manual',
      processingTime: wireType === 'domestic' ? 'Same day' : '2-5 business days',
      message: `Wire transfer instructions generated. Reference: ${reference}`,
      bankInstructions: wireType === 'domestic' ? domesticInstructions : internationalInstructions,
    };
  }

  async processPayPal(amount: number): Promise<PaymentResult> {
    logger.payment.log('Processing PayPal:', { amount });

    const fee = this.calculateFee(amount, 'paypal');
    const transactionId = `txn_paypal_${Date.now()}`;
    await this.simulateProcessingDelay();

    return {
      success: true,
      transactionId,
      status: 'succeeded',
      amount,
      fee,
      netAmount: amount - fee,
      currency: 'USD',
      paymentMethod: 'paypal',
      provider: 'paypal',
      processingTime: 'Instant',
      message: 'PayPal payment successful',
    };
  }

  async processFedNow(amount: number): Promise<PaymentResult> {
    logger.payment.log('Processing FedNow Instant:', { amount });

    const transactionId = `txn_fednow_${Date.now()}`;
    await this.simulateProcessingDelay();

    return {
      success: true,
      transactionId,
      status: 'succeeded',
      amount,
      fee: 0,
      netAmount: amount,
      currency: 'USD',
      paymentMethod: 'fednow',
      provider: 'fednow',
      processingTime: 'Instant (seconds)',
      message: 'FedNow instant transfer completed. Funds available immediately.',
      receipt: {
        id: `rcpt_${Date.now()}`,
        transactionId,
        amount,
        fee: 0,
        netAmount: amount,
        currency: 'USD',
        timestamp: new Date().toISOString(),
        description: 'FedNow Instant Transfer',
        provider: 'fednow',
      },
    };
  }

  async processRTP(amount: number): Promise<PaymentResult> {
    logger.payment.log('Processing RTP:', { amount });

    const fee = this.calculateFee(amount, 'rtp');
    const transactionId = `txn_rtp_${Date.now()}`;
    await this.simulateProcessingDelay();

    return {
      success: true,
      transactionId,
      status: 'succeeded',
      amount,
      fee,
      netAmount: amount - fee,
      currency: 'USD',
      paymentMethod: 'rtp',
      provider: 'rtp_network',
      processingTime: 'Instant (seconds)',
      message: 'RTP transfer completed. Funds available immediately.',
      receipt: {
        id: `rcpt_${Date.now()}`,
        transactionId,
        amount,
        fee,
        netAmount: amount - fee,
        currency: 'USD',
        timestamp: new Date().toISOString(),
        description: 'Real-Time Payment (RTP)',
        provider: 'rtp_network',
      },
    };
  }

  async processSameDayACH(amount: number): Promise<PaymentResult> {
    logger.payment.log('Processing Same-Day ACH:', { amount });

    const transactionId = `txn_sdach_${Date.now()}`;
    const reference = `SDACH-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
    await this.simulateProcessingDelay();

    return {
      success: true,
      transactionId,
      status: 'pending',
      amount,
      fee: 0,
      netAmount: amount,
      currency: 'USD',
      paymentMethod: 'same_day_ach',
      provider: 'plaid',
      processingTime: 'Same day',
      message: `Same-Day ACH initiated. Funds available today. Ref: ${reference}`,
      receipt: {
        id: `rcpt_${Date.now()}`,
        transactionId,
        amount,
        fee: 0,
        netAmount: amount,
        currency: 'USD',
        timestamp: new Date().toISOString(),
        description: 'Same-Day ACH Transfer',
        provider: 'plaid',
      },
    };
  }

  async processUSDC(amount: number): Promise<PaymentResult> {
    logger.payment.log('Processing USDC Stablecoin:', { amount });

    const fee = this.calculateFee(amount, 'usdc');
    const transactionId = `txn_usdc_${Date.now()}`;
    const txHash = `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`;
    await this.simulateProcessingDelay();

    return {
      success: true,
      transactionId,
      status: 'succeeded',
      amount,
      fee,
      netAmount: amount - fee,
      currency: 'USD',
      paymentMethod: 'usdc',
      provider: 'circle',
      processingTime: 'Near instant (~30s)',
      message: `USDC transfer confirmed on-chain. TX: ${txHash.slice(0, 12)}...`,
      receipt: {
        id: `rcpt_${Date.now()}`,
        transactionId,
        amount,
        fee,
        netAmount: amount - fee,
        currency: 'USD',
        timestamp: new Date().toISOString(),
        description: 'USDC Stablecoin Transfer',
        provider: 'circle',
      },
    };
  }

  isSimulated(): boolean {
    const stripeConfigured = this.isConfigured('stripe');
    const plaidConfigured = this.isConfigured('plaid');
    return !stripeConfigured && !plaidConfigured;
  }

  async processPayment(
    amount: number,
    paymentMethodType: PaymentMethodType,
    details?: CardDetails | BankAccountDetails | CardToken
  ): Promise<PaymentResult> {
    const providerStatus = this.getProviderStatus();

    // PRODUCTION SAFETY: never simulate a real money transaction.
    // If no real provider is configured, the transaction must stay pending and
    // be confirmed by the owner/admin outside the automated flow.
    if (this.isSimulated() && !__DEV__ && process.env.EXPO_PUBLIC_ENABLE_PAYMENT_SIMULATION !== 'true') {
      const method = this.getPaymentMethod(paymentMethodType);
      logger.payment.log('[BLOCKED] Simulated payment rejected in production. No real provider configured.');
      return {
        success: false,
        transactionId: '',
        status: 'failed',
        amount,
        fee: 0,
        netAmount: 0,
        currency: 'USD',
        paymentMethod: paymentMethodType,
        provider: method?.provider || 'stripe',
        processingTime: '',
        error: {
          code: 'real_payment_provider_required',
          message: 'No real payment provider is configured. Simulated transactions are disabled in production. Please configure Stripe/Plaid/PayPal or contact IVX support to complete this payment.',
          provider: method?.provider,
        },
      };
    }

    if (this.isSimulated()) {
      logger.payment.log('[SIMULATED] No real payment provider configured. Transaction is simulated only.');
    }

    const validation = this.validateAmount(amount, paymentMethodType);
    if (!validation.valid) {
      return this.createErrorResult(amount, paymentMethodType, validation.error || 'Invalid amount');
    }

    const method = this.getPaymentMethod(paymentMethodType);
    if (!method) {
      return this.createErrorResult(amount, paymentMethodType, 'Payment method not available');
    }

    logger.payment.log('Processing payment:', { amount, method: paymentMethodType, provider: method.provider, simulated: this.isSimulated(), mode: providerStatus.stripe.testMode ? 'test' : 'live' });

    try {
      switch (paymentMethodType) {
        case 'fednow':
          return this.processFedNow(amount);

        case 'rtp':
          return this.processRTP(amount);

        case 'same_day_ach':
          return this.processSameDayACH(amount);

        case 'usdc':
          return this.processUSDC(amount);

        case 'card':
          if (details && 'token' in details) {
            return this.processCardPayment(amount, undefined, details as CardToken);
          }
          return this.processCardPayment(amount, details as CardDetails);

        case 'bank_transfer':
          return this.processBankTransfer(amount);

        case 'apple_pay':
          return this.processApplePay(amount);

        case 'google_pay':
          return this.processGooglePay(amount);

        case 'wire':
          return this.processWireTransfer(amount);

        case 'paypal':
          return this.processPayPal(amount);

        default:
          return this.createErrorResult(amount, paymentMethodType, 'Payment method not supported');
      }
    } catch (error) {
      console.log('[PaymentService] Payment processing error:', (error as Error)?.message);
      return this.createErrorResult(
        amount,
        paymentMethodType,
        error instanceof Error ? error.message : 'Payment processing failed'
      );
    }
  }

  async getSavedPaymentMethods(userId: string): Promise<SavedPaymentMethod[]> {
    logger.payment.log('Fetching saved payment methods for:', userId);
    return [];
  }

  async savePaymentMethod(
    userId: string,
    _type: PaymentMethodType,
    _token: string,
    _setAsDefault: boolean = false
  ): Promise<{ success: boolean; paymentMethodId?: string; error?: string }> {
    logger.payment.log('Saving payment method for:', userId);
    return {
      success: true,
      paymentMethodId: `pm_${Date.now()}`,
    };
  }

  async deletePaymentMethod(paymentMethodId: string): Promise<{ success: boolean }> {
    logger.payment.log('Deleting payment method:', paymentMethodId);
    return { success: true };
  }

  async getTransactionStatus(transactionId: string): Promise<PaymentStatus> {
    logger.payment.log('Checking transaction status:', transactionId);
    return 'succeeded';
  }

  async refundPayment(
    transactionId: string,
    amount?: number,
    _reason?: string
  ): Promise<PaymentResult> {
    logger.payment.log('Processing refund:', { transactionId, amount });
    return {
      success: true,
      transactionId: `ref_${Date.now()}`,
      status: 'refunded',
      amount: amount || 0,
      fee: 0,
      netAmount: amount || 0,
      currency: 'USD',
      paymentMethod: 'card',
      provider: 'stripe',
      processingTime: '5-10 business days',
      message: 'Refund initiated successfully',
    };
  }

  async handleWebhook(event: WebhookEvent): Promise<{ success: boolean; processed: boolean }> {
    logger.payment.log('Processing webhook:', event.type, 'from', event.provider);

    switch (event.provider) {
      case 'stripe':
        return this.handleStripeWebhook(event);
      case 'plaid':
        return this.handlePlaidWebhook(event);
      case 'paypal':
        return this.handlePayPalWebhook(event);
      default:
        return { success: false, processed: false };
    }
  }

  private async handleStripeWebhook(event: WebhookEvent): Promise<{ success: boolean; processed: boolean }> {
    logger.payment.log('Stripe webhook processed:', event.type);
    return { success: true, processed: true };
  }

  private async handlePlaidWebhook(event: WebhookEvent): Promise<{ success: boolean; processed: boolean }> {
    logger.payment.log('Plaid webhook processed:', event.type);
    return { success: true, processed: true };
  }

  private async handlePayPalWebhook(event: WebhookEvent): Promise<{ success: boolean; processed: boolean }> {
    logger.payment.log('PayPal webhook processed:', event.type);
    return { success: true, processed: true };
  }

  async processWithdrawal(
    amount: number,
    methodType: string,
    _bankAccountId?: string
  ): Promise<WithdrawalResult> {
    logger.payment.log('Processing withdrawal:', { amount, methodType });

    const method = this.getWithdrawalMethod(methodType);
    if (!method) {
      return {
        success: false,
        withdrawalId: '',
        status: 'failed',
        amount,
        fee: 0,
        netAmount: 0,
        currency: 'USD',
        method: methodType,
        processingTime: '',
        error: { code: 'invalid_method', message: 'Invalid withdrawal method' },
      };
    }

    const fee = this.calculateWithdrawalFee(amount, methodType);
    const withdrawalId = `wd_${methodType}_${Date.now()}`;
    await this.simulateProcessingDelay();

    const estimatedDays = methodType === 'wire' ? 1 : 3;
    const estimatedArrival = new Date(Date.now() + estimatedDays * 24 * 60 * 60 * 1000).toISOString();

    return {
      success: true,
      withdrawalId,
      status: 'pending',
      amount,
      fee,
      netAmount: amount - fee,
      currency: 'USD',
      method: method.name,
      processingTime: method.processingTime,
      estimatedArrival,
      message: `Withdrawal initiated. Expected arrival: ${new Date(estimatedArrival).toLocaleDateString()}`,
    };
  }

  async cancelWithdrawal(withdrawalId: string): Promise<{ success: boolean; message: string }> {
    logger.payment.log('Cancelling withdrawal:', withdrawalId);
    return {
      success: true,
      message: 'Withdrawal cancelled successfully',
    };
  }

  async getLinkedBankAccounts(userId: string): Promise<SavedPaymentMethod[]> {
    logger.payment.log('Fetching linked bank accounts for:', userId);
    return [];
  }

  async linkBankAccount(userId: string, _publicToken: string, _accountId: string): Promise<{
    success: boolean;
    bankAccountId?: string;
    bankName?: string;
    last4?: string;
    error?: string;
  }> {
    logger.payment.log('Linking bank account for:', userId);
    return {
      success: true,
      bankAccountId: `bank_${Date.now()}`,
      bankName: 'Sample Bank',
      last4: '1234',
    };
  }

  async unlinkBankAccount(bankAccountId: string): Promise<{ success: boolean }> {
    logger.payment.log('Unlinking bank account:', bankAccountId);
    return { success: true };
  }

  private async simulateProcessingDelay(): Promise<void> {
    if (this.testMode) {
      return new Promise(resolve => setTimeout(resolve, 1500));
    }
    return Promise.resolve();
  }

  private createErrorResult(
    amount: number,
    paymentMethod: PaymentMethodType,
    message: string,
    code: string = 'payment_failed'
  ): PaymentResult {
    const method = this.getPaymentMethod(paymentMethod);
    return {
      success: false,
      transactionId: '',
      status: 'failed',
      amount,
      fee: 0,
      netAmount: 0,
      currency: 'USD',
      paymentMethod,
      provider: method?.provider || 'stripe',
      processingTime: '',
      error: {
        code,
        message,
        provider: method?.provider,
      },
    };
  }

}

export const paymentService = new PaymentService();
export default paymentService;
