import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  Platform,
  Alert} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import {
  FileText,
  Shield,
  Scale,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Gavel,
  Lock,
  Eye,
  ArrowLeft,
  Landmark,
  BookOpen,
  BadgeCheck,
  Banknote,
  Globe,
  Mail} from 'lucide-react-native';
import Colors from '@/constants/colors';

interface LegalDocument {
  id: string;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  accentColor: string;
  lastUpdated: string;
  version: string;
  sections: LegalSection[];
}

interface LegalSection {
  heading: string;
  content: string;
}

const EFFECTIVE_DATE = 'February 1, 2026';
const COMPANY_NAME = 'IVX HOLDINGS LLC';
const COMPANY_ADDRESS = '1001 Brickell Bay Drive, Suite 2700, Miami, FL 33131';

const COMPANY_EMAIL_LEGAL = 'legal@ivxholding.com';
const COMPANY_EMAIL_PRIVACY = 'privacy@ivxholding.com';
const COMPANY_EMAIL_COMPLIANCE = 'compliance@ivxholding.com';
const COMPANY_PHONE = 'Contact by email only';


const LEGAL_DOCUMENTS: LegalDocument[] = [
  {
    id: 'terms',
    title: 'Terms of Service',
    subtitle: 'User agreement & platform rules',
    icon: <FileText size={22} color={Colors.primary} />,
    accentColor: Colors.primary,
    lastUpdated: EFFECTIVE_DATE,
    version: '3.0',
    sections: [
      {
        heading: '1. Acceptance of Terms',
        content: `By accessing, downloading, or using the ${COMPANY_NAME} mobile application, website, or any related services (collectively, the "Platform"), you ("User," "you," or "your") agree to be bound by these Terms of Service ("Terms"), our Privacy Policy, Risk Disclosure Statement, and all applicable laws and regulations. If you do not agree to these Terms, you must immediately cease use of the Platform.

These Terms constitute a legally binding agreement between you and ${COMPANY_NAME}, a Delaware limited liability company with its principal office at ${COMPANY_ADDRESS} ("Company," "we," "us," or "our").

We reserve the right to modify these Terms at any time. Material changes will be communicated via email or in-app notification at least thirty (30) days before taking effect. Your continued use of the Platform after such changes constitutes acceptance of the modified Terms.`},
      {
        heading: '2. Eligibility Requirements',
        content: `To use the Platform and invest, you must:

(a) Be at least eighteen (18) years of age, or the age of majority in your jurisdiction, whichever is greater;

(b) Be a legal resident of a jurisdiction where use of the Platform and investment in securities offered through the Platform is not prohibited by applicable law;

(c) Successfully complete our Know Your Customer ("KYC") and Anti-Money Laundering ("AML") verification process, including but not limited to providing valid government-issued photo identification, proof of address, and Social Security Number (for U.S. persons) or Tax Identification Number;

(d) Not be a person or entity sanctioned by the U.S. Department of the Treasury's Office of Foreign Assets Control ("OFAC"), or any other applicable sanctions authority;

(e) Not be a resident of, or located in, any jurisdiction where the offer, sale, or purchase of securities is restricted or prohibited (including, but not limited to, countries subject to comprehensive U.S. sanctions);

(f) Provide accurate, current, and complete registration information and maintain its accuracy;

(g) Acknowledge that all investment opportunities on the Platform are open to all eligible users who have completed KYC verification, regardless of accreditation status.

We reserve the right to refuse service, terminate accounts, or restrict access at our sole discretion if we determine that eligibility requirements are not met.`},
      {
        heading: '3. Account Registration & Security',
        content: `You are responsible for maintaining the confidentiality of your account credentials, including your password, biometric data, and any two-factor authentication codes. You agree to:

(a) Create only one account per person;
(b) Use a strong, unique password not used for any other service;
(c) Enable two-factor authentication (2FA) as required;
(d) Immediately notify us at ${COMPANY_EMAIL_LEGAL} of any unauthorized use of your account or any other breach of security;
(e) Not share, transfer, or sell your account to any third party.

You are solely responsible for all activities that occur under your account, whether or not authorized by you. ${COMPANY_NAME} will not be liable for any loss or damage arising from your failure to safeguard your account credentials.

We may suspend or terminate your account immediately if we suspect unauthorized access, fraudulent activity, or violation of these Terms.`},
      {
        heading: '4. Nature of Services',
        content: `${COMPANY_NAME} operates a technology platform that facilitates fractional real estate investment. Through the Platform, Users may:

(a) Browse and research real estate investment opportunities ("Offerings");
(b) Purchase fractional ownership interests ("Shares") in real estate properties;
(c) Receive dividend distributions from rental income generated by owned properties;
(d) Trade Shares on the Platform's secondary marketplace, subject to availability and applicable holding periods;
(e) Access portfolio analytics, property performance data, and investment tools.

IMPORTANT: ${COMPANY_NAME} is NOT a registered broker-dealer, investment adviser, or investment company under federal or state securities laws unless and until such registrations are obtained and disclosed. The Platform facilitates the offer and sale of securities issued by special purpose entities ("SPEs") that hold title to underlying real estate properties. Each Offering is made pursuant to an exemption from registration under the Securities Act.

The Platform does not provide personalized investment advice, tax advice, or legal counsel. Any information, projections, or analytics provided through the Platform are for informational purposes only and should not be construed as investment recommendations. You should consult with qualified financial, tax, and legal professionals before making any investment decisions.`},
      {
        heading: '5. Investment Process & Terms',
        content: `(a) Offering Documents: Each investment opportunity will be accompanied by an offering memorandum, subscription agreement, and/or other applicable disclosure documents (collectively, "Offering Documents"). These documents contain material information about the investment, including risk factors, property details, financial projections, and terms. You must carefully review all Offering Documents before investing.

(b) Subscription: By subscribing to an Offering, you represent that you have read, understood, and agree to the terms of the applicable Offering Documents, and that you meet all eligibility requirements.

(c) Minimum Investment: Minimum investment amounts are set for each Offering and disclosed in the Offering Documents. The general platform minimum is $1.00 per share, subject to Offering-specific requirements.

(d) Settlement: Investments are settled through our third-party payment processors and custodians. Settlement timing varies but typically occurs within three (3) to five (5) business days.

(e) Holding Period: Certain Offerings may be subject to holding period restrictions under applicable securities laws (e.g., Rule 144 under the Securities Act). You agree to comply with all such restrictions.

(f) Dividends & Distributions: Distributions from rental income or other property proceeds are made at the discretion of the SPE's managing member, typically on a quarterly basis. Distributions are not guaranteed and may vary.

(g) Secondary Market: The Platform may offer a secondary marketplace for trading Shares. Trading is subject to availability of buyers and sellers, applicable transfer restrictions, and Platform rules. ${COMPANY_NAME} does not guarantee liquidity or any particular price for Shares traded on the secondary market.`},
      {
        heading: '6. Fees & Charges',
        content: `(a) Platform Fees: ${COMPANY_NAME} charges fees as disclosed in the applicable Offering Documents and on the Platform's fee schedule, which may include:
  - Asset management fees (typically 1.0%–2.5% annually of property value)
  - Transaction fees on purchases and sales (typically 1.0%–2.0%)
  - Early redemption fees, if applicable
  - Wire transfer and payment processing fees

(b) Third-Party Fees: Additional fees may be charged by third-party service providers, including payment processors, custodians, and banks.

(c) Fee Changes: Fees are subject to change with at least thirty (30) days' prior written notice. Updated fee schedules will be posted on the Platform.

(d) Tax Withholding: We may be required to withhold taxes on distributions to certain investors, including non-U.S. persons, as required by applicable law.`},
      {
        heading: '7. Intellectual Property',
        content: `All content on the Platform, including but not limited to text, graphics, logos, icons, images, audio clips, software, and data compilations, is the property of ${COMPANY_NAME} or its licensors and is protected by United States and international copyright, trademark, and other intellectual property laws.

You are granted a limited, non-exclusive, non-transferable, revocable license to access and use the Platform for personal, non-commercial investment purposes. You may not:

(a) Copy, modify, distribute, sell, or lease any part of the Platform;
(b) Reverse engineer or attempt to extract the source code of the Platform;
(c) Use the Platform for any unlawful purpose or in violation of these Terms;
(d) Use automated means (bots, scrapers, crawlers) to access the Platform;
(e) Use the ${COMPANY_NAME} name, logo, or trademarks without prior written consent.`},
      {
        heading: '8. Limitation of Liability',
        content: `TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, ${COMPANY_NAME.toUpperCase()}, ITS OFFICERS, DIRECTORS, EMPLOYEES, AGENTS, AFFILIATES, AND LICENSORS SHALL NOT BE LIABLE FOR:

(a) ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO LOSS OF PROFITS, DATA, GOODWILL, OR OTHER INTANGIBLE LOSSES;

(b) ANY INVESTMENT LOSSES, INCLUDING PARTIAL OR TOTAL LOSS OF PRINCIPAL;

(c) ANY DAMAGES RESULTING FROM UNAUTHORIZED ACCESS TO OR ALTERATION OF YOUR TRANSMISSIONS OR DATA;

(d) ANY DAMAGES RESULTING FROM INTERRUPTION, SUSPENSION, OR TERMINATION OF THE PLATFORM;

(e) ANY DAMAGES RESULTING FROM THIRD-PARTY ACTIONS, INCLUDING BUT NOT LIMITED TO TENANT DEFAULTS, NATURAL DISASTERS, OR MARKET DOWNTURNS.

IN NO EVENT SHALL ${COMPANY_NAME.toUpperCase()}'S TOTAL LIABILITY TO YOU FOR ALL CLAIMS ARISING FROM OR RELATING TO THESE TERMS OR YOUR USE OF THE PLATFORM EXCEED THE GREATER OF (i) THE TOTAL FEES PAID BY YOU TO ${COMPANY_NAME.toUpperCase()} IN THE TWELVE (12) MONTHS PRECEDING THE CLAIM, OR (ii) ONE HUNDRED DOLLARS ($100.00).`},
      {
        heading: '9. Dispute Resolution & Arbitration',
        content: `(a) Mandatory Arbitration: Any dispute, claim, or controversy arising out of or relating to these Terms, or the breach, termination, enforcement, interpretation, or validity thereof, including the determination of the scope or applicability of this agreement to arbitrate, shall be determined by binding arbitration administered by the American Arbitration Association ("AAA") in accordance with its Commercial Arbitration Rules.

(b) Location: Arbitration shall take place in Miami-Dade County, Florida, unless the parties mutually agree otherwise.

(c) Class Action Waiver: YOU AGREE THAT ANY CLAIMS WILL BE ADJUDICATED ON AN INDIVIDUAL BASIS, AND YOU WAIVE THE RIGHT TO PARTICIPATE IN A CLASS, COLLECTIVE, OR REPRESENTATIVE ACTION OR ARBITRATION.

(d) Governing Law: These Terms shall be governed by and construed in accordance with the laws of the State of Florida, without regard to its conflict of law provisions.

(e) Small Claims Exception: Notwithstanding the foregoing, either party may bring an individual action in small claims court for claims within that court's jurisdiction.

(f) Injunctive Relief: Nothing in this Section shall prevent either party from seeking injunctive or other equitable relief in a court of competent jurisdiction.`},
      {
        heading: '10. Termination',
        content: `(a) You may close your account at any time by contacting ${COMPANY_EMAIL_LEGAL}. Account closure does not affect your existing investments, which will continue to be governed by the applicable Offering Documents.

(b) We may suspend or terminate your access to the Platform at any time, with or without cause, with or without notice, including but not limited to violations of these Terms, suspicious activity, or regulatory requirements.

(c) Upon termination, your right to use the Platform ceases immediately. Provisions that by their nature should survive termination shall survive, including but not limited to Sections 7, 8, 9, and 11.

(d) Liquidation of Holdings: Upon account closure, you may liquidate your holdings through the secondary market (subject to availability) or hold them until maturity/exit events as described in the Offering Documents.`},
      {
        heading: '11. General Provisions',
        content: `(a) Entire Agreement: These Terms, together with the Privacy Policy, Risk Disclosure, and applicable Offering Documents, constitute the entire agreement between you and ${COMPANY_NAME}.

(b) Severability: If any provision of these Terms is found to be unenforceable, the remaining provisions shall continue in full force and effect.

(c) Waiver: Failure to enforce any provision shall not constitute a waiver of that provision or any other provision.

(d) Assignment: You may not assign your rights or obligations under these Terms without our prior written consent. We may assign our rights and obligations without restriction.

(e) Force Majeure: ${COMPANY_NAME} shall not be liable for any failure or delay in performance resulting from causes beyond its reasonable control, including but not limited to acts of God, war, terrorism, pandemics, natural disasters, government actions, or failures of third-party systems.

(f) Notices: We may provide notices to you via email, in-app notifications, or posting on the Platform. You may provide notices to us at ${COMPANY_EMAIL_LEGAL}.

(g) Contact: For questions regarding these Terms, contact:
${COMPANY_NAME}
${COMPANY_ADDRESS}
Email: ${COMPANY_EMAIL_LEGAL}
Phone: ${COMPANY_PHONE}`},
    ]},
  {
    id: 'privacy',
    title: 'Privacy Policy',
    subtitle: 'Data collection, use & your rights',
    icon: <Shield size={22} color={Colors.success} />,
    accentColor: Colors.success,
    lastUpdated: EFFECTIVE_DATE,
    version: '3.0',
    sections: [
      {
        heading: '1. Introduction & Scope',
        content: `This Privacy Policy ("Policy") describes how ${COMPANY_NAME} ("Company," "we," "us," or "our") collects, uses, discloses, and protects your personal information when you use our mobile application, website, and related services (collectively, the "Platform").

This Policy applies to all Users of the Platform, including investors, property owners, visitors, and applicants. By using the Platform, you consent to the practices described in this Policy.

This Policy complies with:
• The California Consumer Privacy Act of 2018, as amended by the California Privacy Rights Act of 2020 ("CCPA/CPRA")
• The General Data Protection Regulation ("GDPR") (EU) 2016/679
• The Gramm-Leach-Bliley Act ("GLBA")
• Other applicable federal and state privacy laws

Data Controller: ${COMPANY_NAME}, ${COMPANY_ADDRESS}
Data Protection Officer: ${COMPANY_EMAIL_PRIVACY}`},
      {
        heading: '2. Information We Collect',
        content: `We collect the following categories of personal information:

(a) Identity Information: Full legal name, date of birth, gender, nationality, Social Security Number (SSN) or Tax Identification Number (TIN), government-issued photo ID (passport, driver's license, national ID).

(b) Contact Information: Email address, phone number, mailing address, country of residence.

(c) Financial Information: Bank account details, credit/debit card information (processed by PCI-DSS compliant third-party processors), investment history, income information, source of funds documentation.

(d) KYC/AML Verification Data: Identity verification results, sanctions screening results, PEP (Politically Exposed Person) status, watchlist screening data, biometric data (facial recognition for identity verification), document verification data.

(e) Transaction Data: Investment purchases, sales, dividends received, withdrawal requests, payment history, trading activity on the secondary market.

(f) Technical Data: IP address, device type and identifiers, operating system, browser type, app version, mobile carrier, time zone, language preferences.

(g) Usage Data: Pages visited, features used, click patterns, search queries, session duration, navigation paths, error logs.

(h) Communications Data: Customer support interactions, chat logs, emails, in-app messages, survey responses, feedback.

(i) Marketing Data: Advertising preferences, referral source, campaign interactions, email open/click rates.`},
      {
        heading: '3. How We Collect Information',
        content: `We collect information through:

(a) Direct Collection: Information you provide during registration, KYC verification, investment transactions, customer support interactions, and account settings updates.

(b) Automated Collection: Cookies, web beacons, pixels, SDKs, and similar technologies that automatically collect technical and usage data when you interact with the Platform.

(c) Third-Party Sources:
  • Identity verification providers (e.g., Jumio, Onfido, or similar)
  • Credit reporting agencies (with your consent)
  • Sanctions and watchlist databases (OFAC, EU sanctions lists)
  • Payment processors (Stripe, Plaid, or similar)
  • Analytics providers (for aggregated usage data)
  • Public records and databases
  • Social media platforms (if you use social login)

(d) Cookies & Tracking Technologies: We use:
  • Essential cookies (required for Platform functionality)
  • Analytics cookies (to understand usage patterns)
  • Performance cookies (to optimize Platform speed)
  We do NOT use third-party advertising or tracking cookies.

You can manage cookie preferences through your browser settings or our in-app privacy controls.`},
      {
        heading: '4. How We Use Your Information',
        content: `We use your personal information for the following purposes:

(a) Service Delivery: To create and manage your account, process investments and transactions, distribute dividends, facilitate secondary market trading, and provide customer support.

(b) Legal & Regulatory Compliance: To perform KYC/AML verification, comply with securities regulations (SEC, FINRA), file required tax documents (1099-DIV, 1099-B, K-1, FATCA/CRS), respond to legal process (subpoenas, court orders), and maintain required records.

(c) Security & Fraud Prevention: To detect and prevent fraud, money laundering, terrorist financing, and other illegal activities; to monitor for unauthorized account access; to verify identity and protect against identity theft.

(d) Platform Improvement: To analyze usage patterns, fix bugs, develop new features, conduct A/B testing, and improve user experience.

(e) Communications: To send transactional notifications (investment confirmations, dividend payments, account alerts), regulatory notices, and, with your consent, marketing communications about new offerings and platform updates.

(f) Legal Basis for Processing (GDPR):
  • Performance of contract (account management, transactions)
  • Legal obligation (KYC/AML, tax reporting, securities compliance)
  • Legitimate interests (fraud prevention, platform improvement, security)
  • Consent (marketing communications, non-essential cookies)`},
      {
        heading: '5. Information Sharing & Disclosure',
        content: `We do NOT sell your personal information. We share information only in the following circumstances:

(a) Service Providers: We engage trusted third-party service providers who process data on our behalf, including:
  • Payment processors (PCI-DSS Level 1 compliant)
  • Identity verification providers (SOC 2 certified)
  • Cloud hosting providers (AWS/GCP with SOC 2 Type II)
  • Customer support platforms
  • Email delivery services
  • Analytics providers (aggregated data only)
All service providers are bound by data processing agreements that limit their use of your data.

(b) Regulatory & Legal: We disclose information when required by:
  • Federal and state securities regulators (SEC, state securities commissions)
  • Tax authorities (IRS, state tax agencies, foreign tax authorities under FATCA/CRS)
  • Law enforcement agencies (pursuant to valid legal process)
  • Financial regulatory bodies (FinCEN, FINRA)
  • Court orders, subpoenas, or other legal requirements

(c) SPE Partners: Limited property and investment information may be shared with SPE managing members and property managers for operational purposes. Your personal identity is NOT shared with other investors.

(d) Business Transfers: In the event of a merger, acquisition, bankruptcy, or sale of assets, your information may be transferred to the acquiring entity, subject to the same privacy protections.

(e) With Your Consent: We may share information with third parties when you have explicitly consented to such sharing.`},
      {
        heading: '6. Data Security',
        content: `We implement industry-leading security measures to protect your personal information:

(a) Encryption: AES-256 encryption for data at rest; TLS 1.3 for data in transit; end-to-end encryption for sensitive communications.

(b) Access Controls: Role-based access controls (RBAC); principle of least privilege; multi-factor authentication for all employees accessing user data.

(c) Infrastructure: SOC 2 Type II certified cloud infrastructure; dedicated Virtual Private Cloud (VPC); intrusion detection and prevention systems (IDS/IPS); 24/7 security monitoring.

(d) Application Security: Regular penetration testing by independent security firms; vulnerability scanning; secure software development lifecycle (SSDLC); bug bounty program.

(e) Data Minimization: We collect only the minimum data necessary for each purpose and delete data when no longer needed, subject to regulatory retention requirements.

(f) Incident Response: We maintain a comprehensive incident response plan. In the event of a data breach affecting your personal information, we will notify you and applicable regulatory authorities within seventy-two (72) hours as required by applicable law.

No system is 100% secure. While we use commercially reasonable efforts to protect your data, we cannot guarantee absolute security.`},
      {
        heading: '7. Data Retention',
        content: `We retain your personal information for as long as necessary to fulfill the purposes outlined in this Policy, subject to the following retention periods:

(a) Account Data: Duration of account plus five (5) years after account closure (required by securities regulations).

(b) KYC/AML Records: Minimum five (5) years after account closure (required by the Bank Secrecy Act and FinCEN regulations).

(c) Transaction Records: Seven (7) years (required by SEC and IRS regulations).

(d) Tax Documents: Seven (7) years (required by IRS regulations).

(e) Communications: Three (3) years for customer support records.

(f) Technical/Usage Data: Twelve (12) months in identifiable form; indefinitely in anonymized/aggregated form.

(g) Marketing Preferences: Until you withdraw consent or close your account.

After the applicable retention period, data is securely deleted or anonymized in accordance with our data destruction procedures.`},
      {
        heading: '8. Your Rights',
        content: `Depending on your jurisdiction, you have the following rights regarding your personal information:

FOR ALL USERS:
• Right to Access: Request a copy of the personal information we hold about you.
• Right to Correction: Request correction of inaccurate or incomplete information.
• Right to Deletion: Request deletion of your personal information, subject to legal retention requirements.
• Right to Opt-Out: Opt out of marketing communications at any time.
• Right to Non-Discrimination: We will not discriminate against you for exercising your privacy rights.

ADDITIONAL RIGHTS UNDER CCPA/CPRA (California Residents):
• Right to Know: Request disclosure of specific categories and pieces of personal information collected, the purposes of collection, and categories of third parties with whom information was shared.
• Right to Delete: Request deletion of personal information collected.
• Right to Opt-Out of Sale: We do NOT sell personal information. If this changes, you will have the right to opt out.
• Right to Limit Use of Sensitive Personal Information: Right to limit the use of sensitive personal information to specified purposes.
• Right to Portability: Right to receive personal information in a portable format.

ADDITIONAL RIGHTS UNDER GDPR (EU/EEA/UK Residents):
• Right to Erasure ("Right to be Forgotten")
• Right to Restrict Processing
• Right to Data Portability
• Right to Object to processing based on legitimate interests
• Right to Withdraw Consent at any time
• Right to Lodge a Complaint with a supervisory authority

To exercise any of these rights, contact us at ${COMPANY_EMAIL_PRIVACY}. We will respond within thirty (30) days (CCPA) or one (1) month (GDPR). Identity verification is required for all requests.`},
      {
        heading: '9. International Data Transfers',
        content: `Your personal information may be transferred to and processed in the United States and other countries where our service providers operate. These countries may have different data protection laws than your country of residence.

For transfers from the EU/EEA/UK to the United States:
• We rely on the EU-U.S. Data Privacy Framework, where applicable
• Standard Contractual Clauses (SCCs) approved by the European Commission
• Other appropriate safeguards as required by GDPR

We ensure that all international data transfers are subject to appropriate safeguards and that your data receives an adequate level of protection.`},
      {
        heading: '10. Children\'s Privacy',
        content: `The Platform is not intended for individuals under the age of eighteen (18). We do not knowingly collect personal information from children under 18. If we become aware that we have collected personal information from a child under 18, we will take steps to delete such information promptly. If you believe we have collected information from a child under 18, please contact us at ${COMPANY_EMAIL_PRIVACY}.`},
      {
        heading: '11. Changes to This Policy',
        content: `We may update this Privacy Policy from time to time to reflect changes in our practices, technology, legal requirements, or other factors. When we make material changes:

• We will post the updated Policy on the Platform with a new "Last Updated" date
• We will notify you via email or in-app notification at least thirty (30) days before material changes take effect
• We will obtain your consent where required by applicable law

We encourage you to review this Policy periodically to stay informed about our data practices.`},
      {
        heading: '12. Contact Us',
        content: `For questions, concerns, or requests regarding this Privacy Policy or our data practices:

Privacy Team: ${COMPANY_EMAIL_PRIVACY}
Legal Team: ${COMPANY_EMAIL_LEGAL}
Mail: ${COMPANY_NAME}, Attn: Privacy Officer, ${COMPANY_ADDRESS}
Phone: ${COMPANY_PHONE}

For GDPR inquiries, you may also contact our EU Representative at: eu-representative@ivxholding.com

If you are unsatisfied with our response, you have the right to lodge a complaint with your local data protection authority.`},
    ]},
  {
    id: 'risk',
    title: 'Risk Disclosure',
    subtitle: 'Investment risk factors & warnings',
    icon: <AlertTriangle size={22} color={Colors.warning} />,
    accentColor: Colors.warning,
    lastUpdated: EFFECTIVE_DATE,
    version: '3.0',
    sections: [
      {
        heading: 'Important Notice',
        content: `THIS RISK DISCLOSURE STATEMENT HIGHLIGHTS CERTAIN RISKS ASSOCIATED WITH INVESTING THROUGH THE ${COMPANY_NAME.toUpperCase()} PLATFORM. THIS IS NOT AN EXHAUSTIVE LIST OF ALL RISKS. YOU SHOULD CAREFULLY CONSIDER THESE RISKS, ALONG WITH THE SPECIFIC RISK FACTORS DISCLOSED IN EACH OFFERING'S OFFERING DOCUMENTS, BEFORE MAKING ANY INVESTMENT DECISION.

INVESTING IN REAL ESTATE SECURITIES INVOLVES A HIGH DEGREE OF RISK. YOU SHOULD INVEST ONLY MONEY THAT YOU CAN AFFORD TO LOSE ENTIRELY.

${COMPANY_NAME.toUpperCase()} DOES NOT PROVIDE INVESTMENT ADVICE. NOTHING ON THIS PLATFORM CONSTITUTES A RECOMMENDATION TO BUY, SELL, OR HOLD ANY SECURITY. CONSULT WITH YOUR OWN FINANCIAL, TAX, AND LEGAL ADVISORS BEFORE INVESTING.`},
      {
        heading: '1. General Investment Risks',
        content: `(a) Loss of Principal: You may lose some or all of your invested capital. Real estate investments are speculative and there is no guarantee of returns.

(b) No Guaranteed Returns: Past performance is not indicative of future results. Projected returns, yields, and appreciation rates are estimates based on historical data and assumptions that may not materialize.

(c) Illiquidity Risk: While the Platform offers a secondary marketplace for trading Shares, there is no guarantee of liquidity. You may be unable to sell your Shares at your desired price, or at all.

(d) Long-Term Nature: Real estate investments are generally long-term in nature. You should be prepared to hold your investment for an extended period, potentially several years.

(e) Concentration Risk: Investing a significant portion of your portfolio in a single property or asset class increases risk. Diversification across multiple properties and asset classes is recommended.`},
      {
        heading: '2. Real Estate-Specific Risks',
        content: `(a) Market Risk: Real estate values fluctuate based on economic conditions, interest rates, supply and demand, demographic trends, and local market factors. Property values may decrease.

(b) Tenant and Vacancy Risk: Properties may experience tenant defaults, vacancies, or difficulty attracting tenants, resulting in reduced rental income and lower distributions.

(c) Property Damage: Properties are subject to damage from natural disasters (hurricanes, earthquakes, floods, fires), environmental hazards, structural defects, and other physical risks. While insurance is maintained, coverage may be insufficient.

(d) Environmental Risk: Properties may be subject to environmental contamination, regulatory changes, or liability under environmental laws.

(e) Development Risk: For properties under development or renovation, there is risk of construction delays, cost overruns, permitting issues, and failure to achieve projected values.

(f) Interest Rate Risk: Rising interest rates may decrease property values, increase financing costs, and reduce investment returns.

(g) Geographic Concentration: Properties located in specific regions are subject to local economic conditions, natural disaster risk, and regulatory environments.`},
      {
        heading: '3. Regulatory & Legal Risks',
        content: `(a) Securities Regulation: Changes in federal or state securities laws, regulations, or enforcement priorities could affect the ability to offer, sell, or trade Shares.

(b) Tax Law Changes: Changes in tax laws, including treatment of real estate income, capital gains, depreciation, or pass-through entities, could adversely affect after-tax returns.

(c) Zoning & Land Use: Changes in zoning laws, building codes, rent control regulations, or other local ordinances could affect property values or income.

(d) Litigation Risk: Properties or SPEs may become subject to litigation, including tenant disputes, construction defects, environmental claims, or regulatory actions.

(e) International Regulatory Risk: For properties located outside the United States, additional regulatory risks apply, including foreign ownership restrictions, currency controls, political instability, and varying legal systems.`},
      {
        heading: '4. Platform & Technology Risks',
        content: `(a) Platform Risk: The Platform may experience operational disruptions, technical failures, cybersecurity incidents, or other events that could affect your ability to access your account, execute trades, or receive distributions.

(b) Cybersecurity Risk: Despite robust security measures, no system is immune to cyberattacks. A breach could compromise personal information or investment data.

(c) Smart Contract Risk: To the extent the Platform utilizes blockchain or smart contract technology, there are risks associated with software bugs, vulnerabilities, and the evolving regulatory landscape for digital assets.

(d) Company Risk: ${COMPANY_NAME} is a relatively new company. There is risk that the Company may face financial difficulties, operational challenges, or may cease operations.

(e) Counterparty Risk: The Platform relies on third-party service providers (payment processors, custodians, property managers). Failure of any such provider could affect Platform operations.`},
      {
        heading: '5. Tax Risks',
        content: `(a) Tax Complexity: Real estate investments may generate complex tax implications, including passive activity income, depreciation recapture, state and local tax obligations in multiple jurisdictions, and potential UBTI (Unrelated Business Taxable Income) for tax-exempt investors.

(b) FIRPTA: Non-U.S. investors may be subject to the Foreign Investment in Real Property Tax Act ("FIRPTA"), which imposes withholding requirements on dispositions of U.S. real property interests.

(c) K-1 Reporting: Certain investments structured as partnerships may require you to file K-1 tax forms, which may complicate and delay your personal tax filing.

(d) State Tax Obligations: You may have state tax filing obligations in states where properties are located, even if you do not reside in those states.

You should consult with a qualified tax advisor regarding the tax implications of your investments.`},
      {
        heading: '6. Conflicts of Interest',
        content: `(a) ${COMPANY_NAME} and its affiliates, officers, directors, and employees may have interests that conflict with those of investors, including:
  • Receiving fees from Offerings and property management
  • Having financial interests in properties offered on the Platform
  • Making decisions that affect the value and management of properties

(b) Property Valuations: While independent appraisals are obtained, ${COMPANY_NAME} may have an interest in higher property valuations, which could result in overpaying for properties.

(c) Related Party Transactions: ${COMPANY_NAME} may engage in transactions with related parties, including property management agreements, financing arrangements, or service contracts.

All material conflicts of interest are disclosed in the applicable Offering Documents.`},
    ]},
  {
    id: 'compliance',
    title: 'SEC & Regulatory Compliance',
    subtitle: 'Securities law, KYC/AML, reporting',
    icon: <Landmark size={22} color={Colors.info} />,
    accentColor: Colors.info,
    lastUpdated: EFFECTIVE_DATE,
    version: '3.0',
    sections: [
      {
        heading: '1. Securities Regulatory Framework',
        content: `${COMPANY_NAME} structures its fractional real estate offerings as securities in compliance with applicable federal and state securities laws.

(a) Regulation A+ (Tier 2): Offerings are primarily made under Regulation A+ (Tier 2), which permits offerings of up to $75 million per year to ALL investors — both accredited and non-accredited — with no individual investment limits beyond standard suitability. This is subject to:
  • SEC qualification of the offering statement
  • Ongoing annual reporting requirements (Form 1-K)
  • Semi-annual reporting (Form 1-SA)
  • Current event reporting (Form 1-U)

(b) Regulation CF: Certain Offerings may also be made under Regulation Crowdfunding, open to all investors.

(c) Our platform is designed to make real estate investment accessible to everyone. There are no accredited investor requirements — any verified user can purchase shares in any property listed on the platform.

(d) State Securities Laws (Blue Sky Laws): We comply with applicable state securities registration and notice filing requirements in all states where we operate.

The specific regulatory framework applicable to each Offering is disclosed in the Offering Documents.`},
      {
        heading: '2. Know Your Customer (KYC) Program',
        content: `${COMPANY_NAME} maintains a comprehensive KYC program in compliance with the USA PATRIOT Act, the Bank Secrecy Act, and FinCEN regulations.

Our KYC process includes:

(a) Customer Identification Program (CIP):
  • Collection and verification of full legal name, date of birth, address, and government-issued identification number (SSN/TIN for U.S. persons)
  • Document verification using automated identity verification technology
  • Biometric facial recognition matching (document photo to live selfie)
  • Address verification through utility bills, bank statements, or government correspondence

(b) Customer Due Diligence (CDD):
  • Determination of the nature and purpose of the customer relationship
  • Assessment of risk level based on customer profile
  • Identification and verification of beneficial owners (for entity accounts)

(c) Enhanced Due Diligence (EDD):
  Applied to high-risk customers, including:
  • Politically Exposed Persons (PEPs) and their associates
  • Customers from high-risk jurisdictions
  • Customers with unusual transaction patterns
  • Large-value transactions exceeding specified thresholds

(d) Ongoing Monitoring:
  • Continuous transaction monitoring for suspicious activity
  • Periodic review and refresh of customer information
  • Sanctions screening against updated OFAC, EU, and UN sanctions lists
  • Adverse media monitoring`},
      {
        heading: '3. Anti-Money Laundering (AML) Compliance',
        content: `${COMPANY_NAME} maintains a robust AML compliance program that includes:

(a) AML Policy: A written AML policy approved by senior management, reviewed and updated annually.

(b) BSA/AML Compliance Officer: A designated BSA/AML Compliance Officer responsible for overseeing the AML program.

(c) Suspicious Activity Reporting (SAR): We monitor for and report suspicious activity to FinCEN as required by law. Indicators of suspicious activity include:
  • Transactions inconsistent with a customer's known profile
  • Attempts to structure transactions to avoid reporting thresholds
  • Use of multiple accounts or identities
  • Rapid movement of funds with no apparent economic purpose
  • Connections to sanctioned individuals or entities

(d) Currency Transaction Reporting (CTR): We file CTRs for transactions exceeding $10,000 as required by the BSA.

(e) OFAC Compliance: We screen all customers, transactions, and counterparties against OFAC's Specially Designated Nationals (SDN) List and other sanctions lists.

(f) Employee Training: All employees receive annual AML training covering:
  • Identification of suspicious activity
  • Reporting obligations
  • Record-keeping requirements
  • Sanctions compliance

(g) Independent Testing: Our AML program is subject to independent testing by qualified third parties on an annual basis.`},
      {
        heading: '4. Investor Eligibility — Open to Everyone',
        content: `${COMPANY_NAME} is committed to making real estate investment accessible to all people. Unlike traditional platforms that restrict access to accredited investors only, our platform operates under regulatory frameworks that allow ALL verified users to invest.

Eligibility Requirements:

(a) Identity Verification: Successfully complete our KYC (Know Your Customer) process including government-issued photo ID and proof of address.

(b) Age Requirement: Be at least 18 years of age (or the age of majority in your jurisdiction).

(c) Funding Source: Have a verified bank account or payment method linked to your account.

(d) Platform Agreement: Accept our Terms of Service and understand the risks associated with real estate investment.

There is NO minimum income requirement, NO net worth threshold, and NO accredited investor verification needed. Anyone who completes KYC verification can purchase shares in any property on our platform — just like buying everyday items at a store.

This open access model is what makes ${COMPANY_NAME} unique in the real estate investment space.`},
      {
        heading: '5. Tax Reporting & Compliance',
        content: `${COMPANY_NAME} provides the following tax documents and reporting:

(a) Form 1099-DIV: Issued annually for dividend distributions exceeding $10.

(b) Form 1099-B: Issued for proceeds from the sale of Shares on the secondary market.

(c) Schedule K-1: Issued for investments structured as partnership interests, reporting each investor's share of income, deductions, and credits.

(d) FATCA Compliance: We comply with the Foreign Account Tax Compliance Act, including:
  • Collection of Form W-9 (U.S. persons) or applicable Form W-8 (non-U.S. persons)
  • Withholding requirements on payments to non-compliant foreign financial institutions
  • Reporting to the IRS as required

(e) CRS Compliance: For non-U.S. jurisdictions, we comply with the Common Reporting Standard for automatic exchange of financial account information.

(f) State Tax Reporting: We provide applicable state tax information for properties located in various states.

Tax documents are typically available by March 15th of each year for the prior tax year.`},
      {
        heading: '6. Investor Protection Measures',
        content: `(a) Escrow Accounts: All investor funds are held in FDIC-insured escrow accounts at major banking institutions until an Offering closes. If an Offering does not reach its minimum target, funds are returned to investors.

(b) Independent Custodian: Investor assets are held by a qualified independent custodian, segregated from ${COMPANY_NAME}'s corporate assets.

(c) Title Insurance: Every property carries comprehensive title insurance from A-rated insurance carriers, protecting against ownership disputes, liens, and defects.

(d) Property Insurance: Full replacement cost insurance is maintained on all properties, including general liability, property damage, natural disaster coverage, and umbrella policies.

(e) Annual Audits: Property financials and investor distributions are subject to annual audit by an independent accounting firm.

(f) Quarterly Reporting: Investors receive quarterly reports detailing property performance, financials, occupancy, and distribution information.

(g) FDIC Notice: INVESTMENTS IN SECURITIES OFFERED THROUGH THE PLATFORM ARE NOT FDIC INSURED, NOT BANK GUARANTEED, AND MAY LOSE VALUE. Cash held in FDIC-insured custody accounts is protected up to applicable FDIC limits ($250,000 per depositor, per institution).`},
      {
        heading: '7. Regulatory Filings & Disclosures',
        content: `${COMPANY_NAME} makes the following regulatory filings as applicable:

• SEC Form D: Filed for each Regulation D Offering
• SEC Form 1-A: Offering Statement for Regulation A+ Offerings
• SEC Form 1-K: Annual Report for Regulation A+ issuers
• SEC Form 1-SA: Semi-Annual Report for Regulation A+ issuers
• SEC Form 1-U: Current Event Report for material events
• FinCEN Filings: SARs, CTRs, and other BSA-required reports
• State Filings: Blue Sky notice filings in applicable states
• EDGAR: All SEC filings are publicly available on the SEC's EDGAR database

Investors may request copies of applicable regulatory filings by contacting ${COMPANY_EMAIL_COMPLIANCE}.`},
    ]},
  {
    id: 'aml',
    title: 'AML & Sanctions Policy',
    subtitle: 'Anti-money laundering program',
    icon: <Eye size={22} color="#FF6B6B" />,
    accentColor: '#FF6B6B',
    lastUpdated: EFFECTIVE_DATE,
    version: '2.0',
    sections: [
      {
        heading: '1. Policy Statement',
        content: `${COMPANY_NAME} is committed to the highest standards of Anti-Money Laundering ("AML") and Counter-Terrorism Financing ("CTF") compliance. We prohibit and actively work to prevent money laundering, terrorist financing, and other financial crimes through our Platform.

This policy applies to all officers, directors, employees, contractors, and agents of ${COMPANY_NAME}, as well as all Users of the Platform.

${COMPANY_NAME} complies with:
• The Bank Secrecy Act (BSA) of 1970
• The USA PATRIOT Act of 2001
• FinCEN regulations (31 CFR Chapter X)
• OFAC sanctions programs
• Applicable state money transmission laws
• International AML/CTF standards (FATF Recommendations)`},
      {
        heading: '2. Prohibited Activities',
        content: `The following activities are strictly prohibited on the Platform:

(a) Using the Platform to launder money or facilitate money laundering by third parties;
(b) Using the Platform to finance terrorism or provide material support to terrorist organizations;
(c) Using the Platform to evade economic sanctions imposed by the U.S. government or international bodies;
(d) Structuring transactions to avoid reporting thresholds or detection;
(e) Providing false, misleading, or incomplete information during registration or verification;
(f) Using another person's identity or account to transact;
(g) Using the Platform to process proceeds of illegal activity;
(h) Circumventing or attempting to circumvent the Platform's AML controls.

Violations will result in immediate account suspension, reporting to appropriate law enforcement and regulatory authorities, and potential criminal prosecution.`},
      {
        heading: '3. Transaction Monitoring',
        content: `${COMPANY_NAME} employs automated and manual transaction monitoring systems to detect potentially suspicious activity, including:

(a) Rule-based monitoring for transactions exceeding specified thresholds;
(b) Pattern analysis to detect unusual transaction sequences or volumes;
(c) Behavioral analytics comparing activity to established customer profiles;
(d) Peer group analysis comparing activity to similar customer segments;
(e) Adverse media monitoring for negative news about customers;
(f) Real-time sanctions screening on all transactions.

Alerts generated by monitoring systems are reviewed by trained compliance personnel. When suspicious activity is identified, a Suspicious Activity Report (SAR) is filed with FinCEN within thirty (30) days.

${COMPANY_NAME} is prohibited by law from disclosing to any person that a SAR has been filed (the "tipping off" prohibition).`},
      {
        heading: '4. Record Retention',
        content: `In compliance with BSA requirements, ${COMPANY_NAME} retains the following records:

(a) Customer identification and verification records: Minimum five (5) years after account closure;
(b) Transaction records: Minimum five (5) years from the date of the transaction;
(c) SARs and supporting documentation: Minimum five (5) years from the date of filing;
(d) CTRs and supporting documentation: Minimum five (5) years from the date of filing;
(e) AML training records: Duration of employment plus two (2) years;
(f) Independent testing reports: Minimum five (5) years.

Records are maintained in a manner that allows timely retrieval in response to regulatory requests.`},
    ]},
  {
    id: 'econsent',
    title: 'E-Sign & Electronic Consent',
    subtitle: 'Electronic communications agreement',
    icon: <BookOpen size={22} color="#8B5CF6" />,
    accentColor: '#8B5CF6',
    lastUpdated: EFFECTIVE_DATE,
    version: '2.0',
    sections: [
      {
        heading: '1. Consent to Electronic Communications',
        content: `By creating an account on the Platform, you consent to receive all communications, agreements, disclosures, notices, and other documents ("Communications") from ${COMPANY_NAME} electronically, including but not limited to:

• Account statements and confirmations
• Offering Documents (offering memorandums, subscription agreements)
• Dividend and distribution notices
• Tax documents (1099-DIV, 1099-B, K-1)
• Privacy Policy and Terms of Service updates
• Regulatory notices and disclosures
• Customer support communications
• Marketing communications (with separate opt-in)

This consent is provided pursuant to the Electronic Signatures in Global and National Commerce Act ("E-SIGN Act"), 15 U.S.C. §§ 7001-7006.`},
      {
        heading: '2. Hardware & Software Requirements',
        content: `To receive and retain electronic Communications, you need:

• A smartphone or tablet with iOS 15+ or Android 10+, OR a computer with a current web browser (Chrome, Firefox, Safari, or Edge)
• An active internet connection
• An active email address registered with your account
• Sufficient storage space to save Communications or an installed printer to print them
• The ability to view PDF documents (Adobe Acrobat Reader or equivalent)

You are responsible for ensuring that your hardware and software meet these requirements and that your email address is current.`},
      {
        heading: '3. Withdrawing Consent',
        content: `You have the right to withdraw your consent to receive electronic Communications at any time by contacting us at ${COMPANY_EMAIL_LEGAL}. However, please note that:

(a) Withdrawal of consent may result in the closure of your account, as electronic communication is necessary for the operation of your account;
(b) Withdrawal does not affect the legal validity or enforceability of Communications previously provided electronically;
(c) Certain regulatory Communications may still be sent electronically as permitted by law.

If you withdraw consent, we will provide paper copies of Communications upon request, and may charge a reasonable fee for printing and mailing costs.`},
      {
        heading: '4. Electronic Signatures',
        content: `By using the Platform, you agree that your electronic signatures on subscription agreements, account applications, and other documents are legally binding and have the same force and effect as handwritten signatures.

Electronic signatures include:
• Clicking "I Agree," "Accept," "Sign," or similar buttons
• Typing your name in a signature field
• Using biometric authentication to confirm transactions
• Any other electronic method of indicating acceptance

You agree not to contest the validity or enforceability of any electronically signed document solely on the basis that it was signed electronically.`},
    ]},
  {
    id: 'cookies',
    title: 'Cookie Policy',
    subtitle: 'How we use cookies & tracking technologies',
    icon: <Globe size={22} color="#45B7D1" />,
    accentColor: '#45B7D1',
    lastUpdated: EFFECTIVE_DATE,
    version: '2.0',
    sections: [
      {
        heading: '1. What Are Cookies',
        content: `Cookies are small text files placed on your device when you visit the ${COMPANY_NAME} Platform. They help us provide a better experience by remembering your preferences, understanding usage patterns, and improving our services.\n\nThis Cookie Policy explains what cookies are, how we use them, the types of cookies we use, and how you can control your cookie preferences. This Policy should be read together with our Privacy Policy.\n\nThis Policy complies with:\n• The EU ePrivacy Directive (Cookie Law)\n• The General Data Protection Regulation (GDPR)\n• The California Consumer Privacy Act (CCPA/CPRA)\n• Other applicable federal and state privacy regulations`},
      {
        heading: '2. Types of Cookies We Use',
        content: `(a) Strictly Necessary Cookies: Essential for Platform functionality. These cannot be disabled.\n  • User authentication and session management\n  • Security features (CSRF protection, fraud detection)\n  • Load balancing and server routing\n  • Transaction processing and payment security\n\n(b) Functional Cookies: Enable enhanced functionality and personalization:\n  • Language and region preferences\n  • User interface customization (dark/light mode)\n  • Remember login status and display preferences\n\n(c) Analytics Cookies: Help us understand Platform usage:\n  • Page view tracking and navigation patterns\n  • Feature usage analytics (anonymized)\n  • Performance monitoring and error tracking\n  We use only anonymized and aggregated data from analytics cookies.\n\n(d) Performance Cookies: Optimize Platform speed:\n  • Page load time monitoring\n  • API response time tracking\n  • Resource optimization\n\nIMPORTANT: We do NOT use third-party advertising cookies, retargeting cookies, or cross-site tracking cookies.`},
      {
        heading: '3. Cookie Duration & Storage',
        content: `Cookies used on our Platform have varying durations:\n\n(a) Session Cookies: Temporary cookies that expire when you close your browser or app:\n  • Session management and authentication\n  • Temporary form data storage\n  • Security tokens\n\n(b) Persistent Cookies: Remain on your device for a set period:\n  • Authentication tokens: Up to 30 days\n  • Preference cookies: Up to 12 months\n  • Analytics cookies: Up to 24 months\n  • Security cookies: Up to 6 months\n\nAll persistent cookies can be deleted through your browser or device settings at any time.`},
      {
        heading: '4. Third-Party Cookies',
        content: `Our Platform may include limited third-party cookies from trusted service providers:\n\n(a) Analytics Providers: Anonymized usage data collection for Platform improvement.\n\n(b) Payment Processors: Essential cookies for secure transaction processing (PCI-DSS compliant).\n\n(c) Identity Verification: Cookies used during the KYC verification process.\n\n(d) CDN Providers: Performance cookies for content delivery optimization.\n\nAll third-party cookie providers are bound by data processing agreements and are required to comply with applicable privacy laws. We regularly audit third-party cookies to ensure compliance with our privacy standards.`},
      {
        heading: '5. Managing Your Cookie Preferences',
        content: `You can manage your cookie preferences through:\n\n(a) In-App Settings: Navigate to Settings > Privacy > Cookie Preferences to customize which optional cookies are enabled.\n\n(b) Browser Settings: Most browsers allow you to block all cookies, block third-party cookies, delete existing cookies, or set preferences for specific websites.\n\n(c) Device Settings: Mobile devices typically offer cookie controls in their privacy settings.\n\nPlease note that disabling certain cookies may affect Platform functionality. Strictly necessary cookies cannot be disabled as the Platform requires them to function.\n\nFor more information about managing cookies, consult your browser or device documentation.`},
      {
        heading: '6. Updates to This Policy',
        content: `We may update this Cookie Policy to reflect changes in the cookies we use or for operational, legal, or regulatory reasons. When we make material changes, we will notify you through:\n\n• An updated "Last Updated" date on this Policy\n• A notification banner on the Platform\n• Email notification for significant changes\n\nWe encourage you to review this Policy periodically.\n\nFor questions about our use of cookies, contact us at ${COMPANY_EMAIL_PRIVACY}.`},
    ]},
  {
    id: 'investment-disclosure',
    title: 'Investment Disclosure',
    subtitle: 'Offering structure, fees & conflicts',
    icon: <Banknote size={22} color="#10B981" />,
    accentColor: '#10B981',
    lastUpdated: EFFECTIVE_DATE,
    version: '2.0',
    sections: [
      {
        heading: '1. Nature of Offerings',
        content: `IMPORTANT: ALL INVESTMENTS OFFERED THROUGH THE ${COMPANY_NAME.toUpperCase()} PLATFORM ARE SPECULATIVE AND INVOLVE A HIGH DEGREE OF RISK. YOU SHOULD NOT INVEST ANY FUNDS THAT YOU CANNOT AFFORD TO LOSE ENTIRELY.

${COMPANY_NAME} facilitates fractional real estate investments through special purpose entities ("SPEs"). Each property is held by a separate SPE, and investors purchase fractional ownership interests ("Shares") in the SPE, not direct ownership of the underlying real estate.

Offerings may be conducted under one or more of the following regulatory frameworks:

(a) Regulation A+ (Tier 2): Qualified offerings of up to $75 million per year, available to ALL investors with no accreditation requirements, subject to SEC qualification and ongoing reporting.

(b) Regulation CF: Crowdfunding offerings open to all investors.

Our platform is designed so that any verified user can invest in any property — no accredited investor status required.

The specific exemption applicable to each Offering is disclosed in the Offering Documents. Shares have not been, and will not be, registered under the Securities Act of 1933, as amended, and may not be resold except in compliance with applicable securities laws.`},
      {
        heading: '2. Fee Disclosure',
        content: `${COMPANY_NAME} charges the following fees in connection with investments made through the Platform. All fees are disclosed prior to each investment and are detailed in the applicable Offering Documents.

(a) ACQUISITION & ORIGINATION FEES:
  • Acquisition fee: 1.0% – 3.0% of property purchase price (one-time)
  • Due diligence costs: Passed through at cost
  • Legal and structuring costs: Passed through at cost

(b) ONGOING MANAGEMENT FEES:
  • Asset management fee: 1.0% – 2.5% per annum of gross asset value
  • Property management fee: 6.0% – 10.0% of gross rental income (paid to third-party manager)
  • Administrative fee: 0.25% – 0.50% per annum

(c) TRANSACTION FEES:
  • Primary market purchase: 1.0% – 2.0% of transaction amount
  • Secondary market sale: 1.0% of transaction amount (charged to both buyer and seller)
  • Wire transfer: $25 per domestic wire; $50 per international wire
  • ACH transfer: Free for deposits; $5 for withdrawals

(d) DISPOSITION FEES:
  • Disposition fee: 1.0% – 2.0% of gross sale price upon property sale
  • Carried interest / performance fee: 20% of profits above an 8% preferred return hurdle (where applicable)

(e) EARLY REDEMPTION:
  • Redemption within 12 months of purchase: 3.0% penalty
  • Redemption between 12–24 months: 1.5% penalty
  • Redemption after 24 months: No penalty (subject to liquidity availability)

Fees are subject to change with 30 days' written notice. The fee schedule applicable at the time of your investment governs your investment.`},
      {
        heading: '3. Conflicts of Interest',
        content: `${COMPANY_NAME} and its affiliates, officers, directors, and employees may have interests that conflict with those of investors. Material conflicts include:

(a) COMPENSATION CONFLICTS:
  • ${COMPANY_NAME} earns fees from the acquisition, management, and disposition of properties, creating an incentive to acquire and hold properties regardless of whether it is in investors' best interests.
  • Performance fees create an incentive to take on higher-risk investments to generate higher returns.

(b) VALUATION CONFLICTS:
  • ${COMPANY_NAME} may be involved in setting or influencing property valuations, which affect fee calculations and reported investor returns. Independent third-party appraisals are obtained to mitigate this conflict.

(c) ALLOCATION CONFLICTS:
  • When multiple investment opportunities are available, ${COMPANY_NAME} must decide how to allocate opportunities among various offerings. We maintain allocation policies designed to ensure fair treatment of all investors.

(d) RELATED PARTY TRANSACTIONS:
  • ${COMPANY_NAME} or its affiliates may provide property management, construction management, or other services to SPEs, for which they receive fees. All related party transactions are disclosed in the applicable Offering Documents and are conducted at arm's length.

(e) MULTIPLE ROLES:
  • ${COMPANY_NAME} may serve simultaneously as the platform operator, asset manager, and managing member of SPEs, which creates inherent conflicts between its duties to investors and its own economic interests.

MITIGATION MEASURES:
  • Independent property appraisals for all acquisitions
  • Annual audits by independent accounting firms
  • Quarterly reporting to investors
  • Independent board oversight
  • Written conflict of interest policies
  • Disclosure of all material conflicts in Offering Documents`},
      {
        heading: '4. Forward-Looking Statements',
        content: `THE PLATFORM AND OFFERING DOCUMENTS MAY CONTAIN FORWARD-LOOKING STATEMENTS, INCLUDING PROJECTIONS OF RENTAL INCOME, PROPERTY APPRECIATION, OCCUPANCY RATES, CAP RATES, INTERNAL RATES OF RETURN (IRR), AND OTHER FINANCIAL METRICS.

FORWARD-LOOKING STATEMENTS ARE IDENTIFIED BY WORDS SUCH AS "EXPECTS," "ANTICIPATES," "PROJECTS," "ESTIMATES," "BELIEVES," "INTENDS," "PLANS," "MAY," "WILL," "SHOULD," AND SIMILAR EXPRESSIONS.

THESE STATEMENTS ARE BASED ON CURRENT EXPECTATIONS AND ASSUMPTIONS THAT ARE SUBJECT TO RISKS AND UNCERTAINTIES. ACTUAL RESULTS MAY DIFFER MATERIALLY FROM THOSE PROJECTED. FACTORS THAT COULD CAUSE ACTUAL RESULTS TO DIFFER INCLUDE:

• Changes in real estate market conditions
• Changes in interest rates and credit markets
• Tenant defaults, vacancies, and lease terminations
• Changes in tax laws, zoning regulations, or environmental laws
• Natural disasters, pandemics, or other force majeure events
• Construction delays, cost overruns, or permitting issues
• General economic conditions and recession risk
• Changes in the competitive landscape
• Regulatory changes affecting securities offerings
• Failure to achieve projected occupancy or rental rates

${COMPANY_NAME.toUpperCase()} DOES NOT UNDERTAKE ANY OBLIGATION TO UPDATE OR REVISE FORWARD-LOOKING STATEMENTS, WHETHER AS A RESULT OF NEW INFORMATION, FUTURE EVENTS, OR OTHERWISE.

PAST PERFORMANCE IS NOT INDICATIVE OF FUTURE RESULTS. ANY HISTORICAL RETURNS, EXPECTED RETURNS, OR PROBABILITY PROJECTIONS MAY NOT REFLECT ACTUAL FUTURE PERFORMANCE.`},
      {
        heading: '5. Investor Suitability',
        content: `Investing in real estate securities through the Platform may not be suitable for all investors. Before investing, you should consider:

(a) FINANCIAL SITUATION:
  • Your current income, net worth, and liquid assets
  • Your existing investment portfolio and diversification
  • Your ability to bear the loss of your entire investment
  • Your need for liquidity (real estate investments are generally illiquid)

(b) INVESTMENT OBJECTIVES:
  • Your investment time horizon (minimum recommended: 3-5 years)
  • Your desired risk/return profile
  • Your need for current income vs. capital appreciation
  • Your tax situation and the tax implications of real estate investments

(c) EXPERIENCE:
  • Your experience with real estate investments
  • Your understanding of fractional ownership structures
  • Your familiarity with securities regulations and restrictions
  • Your ability to evaluate offering documents and risk factors

(d) OPEN ACCESS INVESTING:
  ${COMPANY_NAME} does not impose accredited investor requirements or investment limits based on income or net worth. All verified users can invest in any property listed on the platform without restrictions.

${COMPANY_NAME} does not provide personalized investment advice. The availability of an investment on the Platform does not constitute a recommendation. You should consult with your own financial, tax, and legal advisors before making any investment decision.

Contact: ${COMPANY_EMAIL_COMPLIANCE}`},
      {
        heading: '6. FINRA & Broker-Dealer Disclosures',
        content: `${COMPANY_NAME} is not currently registered as a broker-dealer with the U.S. Securities and Exchange Commission ("SEC") or the Financial Industry Regulatory Authority ("FINRA").

Securities offered through the Platform are offered directly by the issuing SPEs under applicable exemptions from broker-dealer registration. ${COMPANY_NAME} acts as a technology platform facilitating the offer and sale of securities.

If ${COMPANY_NAME} determines that broker-dealer registration is required or advisable, it will either:
(a) Register as a broker-dealer with the SEC and become a member of FINRA; or
(b) Engage a registered broker-dealer to facilitate offerings on the Platform.

Any changes to ${COMPANY_NAME}'s regulatory status will be disclosed to investors promptly.

INVESTOR PROTECTION NOTICE:
• Investments are NOT insured by the FDIC or any government agency
• Investments are NOT guaranteed by any bank or financial institution
• Investments MAY LOSE VALUE, including total loss of principal
• The secondary market for Shares is limited and NOT guaranteed
• There is NO public trading market for the securities offered

For regulatory inquiries or complaints:
${COMPANY_NAME} Compliance Department
${COMPANY_ADDRESS}
Email: ${COMPANY_EMAIL_COMPLIANCE}
Phone: ${COMPANY_PHONE}

You may also contact:
SEC Office of Investor Education and Advocacy: (800) 732-0330
FINRA Investor Complaint Center: www.finra.org/investors/have-problem`},
    ]},
  {
    id: 'acceptable-use',
    title: 'Acceptable Use Policy',
    subtitle: 'Platform usage rules & restrictions',
    icon: <Banknote size={22} color="#F59E0B" />,
    accentColor: '#F59E0B',
    lastUpdated: EFFECTIVE_DATE,
    version: '2.0',
    sections: [
      {
        heading: '1. Purpose & Scope',
        content: `This Acceptable Use Policy ("AUP") sets forth the rules and guidelines for using the ${COMPANY_NAME} Platform. This AUP is incorporated into and forms part of the Terms of Service.\n\nBy accessing or using the Platform, you agree to comply with this AUP. Violations may result in immediate suspension or termination of your account, forfeiture of any pending transactions, and reporting to law enforcement or regulatory authorities where applicable.\n\n${COMPANY_NAME} reserves the right to investigate suspected violations and take appropriate action, including removing content, suspending accounts, and cooperating with law enforcement.`},
      {
        heading: '2. Permitted Uses',
        content: `The Platform may only be used for the following lawful purposes:\n\n(a) Browsing and researching real estate investment opportunities offered through the Platform;\n\n(b) Creating and maintaining one personal investment account;\n\n(c) Purchasing, holding, and selling fractional ownership interests ("Shares") in properties offered on the Platform;\n\n(d) Receiving and reinvesting dividend distributions;\n\n(e) Participating in the secondary marketplace for trading Shares;\n\n(f) Accessing portfolio analytics, property data, and investment tools;\n\n(g) Communicating with ${COMPANY_NAME} customer support;\n\n(h) Referring friends and family through the official referral program;\n\n(i) Accessing educational content and resources provided on the Platform.`},
      {
        heading: '3. Prohibited Activities',
        content: `You may NOT use the Platform to:\n\n(a) Financial Misconduct:\n  • Engage in money laundering, terrorist financing, or any financial crime\n  • Structure transactions to avoid reporting thresholds\n  • Use the Platform to process proceeds of illegal activity\n  • Engage in market manipulation, wash trading, or artificial price inflation\n  • Front-running or trading on material non-public information\n\n(b) Identity & Account Violations:\n  • Create multiple accounts or use false identities\n  • Share, sell, or transfer your account credentials\n  • Access another user's account without authorization\n  • Impersonate any person, entity, or ${COMPANY_NAME} employee\n  • Provide false, inaccurate, or misleading information\n\n(c) Technical Abuse:\n  • Use automated systems (bots, scrapers, crawlers) to access the Platform\n  • Attempt to bypass security measures or access controls\n  • Exploit bugs, vulnerabilities, or glitches in the Platform\n  • Interfere with or disrupt the Platform's infrastructure\n  • Attempt to reverse engineer, decompile, or extract source code\n  • Introduce malware, viruses, or other malicious software\n\n(d) Content & Communication Violations:\n  • Post or transmit abusive, threatening, or harassing content\n  • Distribute spam, unsolicited advertising, or promotional material\n  • Infringe on intellectual property rights of ${COMPANY_NAME} or third parties\n  • Publish false or misleading information about properties or the Platform`},
      {
        heading: '4. Transaction Rules',
        content: `When executing transactions on the Platform, you must:\n\n(a) Use only your own funds from verified funding sources;\n\n(b) Ensure sufficient funds are available before initiating transactions;\n\n(c) Not engage in rapid-fire trading designed to manipulate market prices;\n\n(d) Comply with all applicable holding period restrictions;\n\n(e) Not attempt to circumvent minimum or maximum investment limits;\n\n(f) Report any transaction errors or discrepancies promptly to ${COMPANY_EMAIL_COMPLIANCE};\n\n(g) Not use the Platform to facilitate transactions on behalf of undisclosed third parties;\n\n(h) Comply with all applicable tax obligations arising from Platform transactions.`},
      {
        heading: '5. Reporting Violations',
        content: `If you become aware of any violation of this AUP, please report it immediately to:\n\nEmail: ${COMPANY_EMAIL_COMPLIANCE}\nPhone: ${COMPANY_PHONE}\n\nYou may also report violations through the in-app reporting feature under Settings > Report an Issue.\n\n${COMPANY_NAME} investigates all reported violations promptly. We may, at our sole discretion:\n\n(a) Issue a warning to the violating user;\n(b) Temporarily suspend the user's account;\n(c) Permanently terminate the user's account;\n(d) Freeze or reverse transactions related to the violation;\n(e) Report the violation to law enforcement or regulatory authorities;\n(f) Pursue legal action to recover damages.\n\nWe will not retaliate against any user who reports a violation in good faith.`},
      {
        heading: '6. Consequences of Violation',
        content: `Violations of this AUP may result in one or more of the following consequences:\n\n(a) First Offense (Minor): Written warning and education about the violated policy.\n\n(b) Second Offense or Serious Violation: Temporary account suspension (7-30 days) and mandatory policy review.\n\n(c) Severe or Repeated Violations: Permanent account termination, forfeiture of any referral bonuses or rewards, and potential reporting to regulatory authorities.\n\n(d) Criminal Activity: Immediate account freeze, preservation of evidence, and referral to law enforcement.\n\n${COMPANY_NAME} reserves the right to determine the severity of any violation and the appropriate response. Users whose accounts are terminated for AUP violations may be prohibited from creating new accounts.\n\nFor questions regarding this Acceptable Use Policy, contact:\n${COMPANY_NAME}\n${COMPANY_ADDRESS}\nEmail: ${COMPANY_EMAIL_COMPLIANCE}\nPhone: ${COMPANY_PHONE}`},
    ]},
];

function DocumentCard({
  document,
  isExpanded,
  onToggle}: {
  document: LegalDocument;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set());
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 350,
      useNativeDriver: true}).start();
  }, [fadeAnim]);

  const toggleSection = useCallback((index: number) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setExpandedSections(new Set(document.sections.map((_, i) => i)));
  }, [document.sections]);

  const collapseAll = useCallback(() => {
    setExpandedSections(new Set());
  }, []);

  return (
    <Animated.View style={[styles.documentCard, { opacity: fadeAnim }]}>
      <TouchableOpacity
        style={styles.documentHeader}
        onPress={onToggle}
        activeOpacity={0.7}
        testID={`legal-doc-${document.id}`}
      >
        <View style={styles.documentHeaderLeft}>
          <View style={[styles.documentIcon, { backgroundColor: document.accentColor + '18' }]}>
            {document.icon}
          </View>
          <View style={styles.documentMeta}>
            <Text style={styles.documentTitle}>{document.title}</Text>
            <Text style={styles.documentSubtitle}>{document.subtitle}</Text>
          </View>
        </View>
        {isExpanded ? (
          <ChevronUp size={22} color={Colors.textTertiary} />
        ) : (
          <ChevronDown size={22} color={Colors.textTertiary} />
        )}
      </TouchableOpacity>

      {isExpanded && (
        <View style={styles.documentBody}>
          <View style={styles.documentInfoBar}>
            <View style={styles.documentInfoItem}>
              <Text style={styles.documentInfoLabel}>Version</Text>
              <Text style={styles.documentInfoValue}>{document.version}</Text>
            </View>
            <View style={styles.documentInfoDivider} />
            <View style={styles.documentInfoItem}>
              <Text style={styles.documentInfoLabel}>Effective</Text>
              <Text style={styles.documentInfoValue}>{document.lastUpdated}</Text>
            </View>
            <View style={styles.documentInfoDivider} />
            <TouchableOpacity
              style={styles.expandAllBtn}
              onPress={expandedSections.size === document.sections.length ? collapseAll : expandAll}
            >
              <Text style={styles.expandAllBtnText}>
                {expandedSections.size === document.sections.length ? 'Collapse All' : 'Expand All'}
              </Text>
            </TouchableOpacity>
          </View>

          {document.sections.map((section, index) => {
            const isSectionExpanded = expandedSections.has(index);
            return (
              <View key={index} style={styles.sectionItem}>
                <TouchableOpacity
                  style={styles.sectionHeader}
                  onPress={() => toggleSection(index)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.sectionHeading} numberOfLines={2}>
                    {section.heading}
                  </Text>
                  {isSectionExpanded ? (
                    <ChevronUp size={18} color={Colors.textTertiary} />
                  ) : (
                    <ChevronDown size={18} color={Colors.textTertiary} />
                  )}
                </TouchableOpacity>
                {isSectionExpanded && (
                  <View style={styles.sectionContent}>
                    <Text style={styles.sectionText} selectable>
                      {section.content}
                    </Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}
    </Animated.View>
  );
}

export default function LegalScreen() {
  const router = useRouter();
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null);


  const toggleDocument = useCallback((id: string) => {
    setExpandedDoc(prev => (prev === id ? null : id));
  }, []);

  const copyEmail = useCallback(async (email: string) => {
    try {
      if (Platform.OS === 'web') {
        await navigator.clipboard.writeText(email);
      } else {
        const Clipboard = require('expo-clipboard');
        await Clipboard.setStringAsync(email);
      }
      Alert.alert('Email Copied', `${email} has been copied to your clipboard.`);
    } catch {
      Alert.alert('Contact Email', email);
    }
  }, []);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton} testID="legal-back">
            <ArrowLeft size={22} color={Colors.text} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>Legal & Compliance</Text>
            <Text style={styles.headerSubtitle}>{COMPANY_NAME}</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
        >
          <View style={styles.legalBanner}>
            <View style={styles.bannerIconRow}>
              <View style={styles.bannerIcon}>
                <Scale size={20} color={Colors.primary} />
              </View>
              <View style={styles.bannerIcon}>
                <Shield size={20} color={Colors.success} />
              </View>
              <View style={styles.bannerIcon}>
                <Landmark size={20} color={Colors.info} />
              </View>
            </View>
            <Text style={styles.bannerTitle}>Regulated & Compliant</Text>
            <Text style={styles.bannerSubtitle}>
              SEC-registered offerings {'\u2022'} KYC/AML verified {'\u2022'} GDPR & CCPA compliant
            </Text>
          </View>

          <View style={styles.quickLinksRow}>
            <TouchableOpacity
              style={styles.quickLink}
              onPress={() => copyEmail(COMPANY_EMAIL_LEGAL)}
              onLongPress={() => toggleDocument('terms')}
            >
              <Mail size={16} color={Colors.primary} />
              <Text style={styles.quickLinkText}>Legal Team</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.quickLink}
              onPress={() => toggleDocument('privacy')}
            >
              <Lock size={16} color={Colors.success} />
              <Text style={styles.quickLinkText}>Privacy</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.quickLink}
              onPress={() => toggleDocument('compliance')}
            >
              <BadgeCheck size={16} color={Colors.info} />
              <Text style={styles.quickLinkText}>Compliance</Text>
            </TouchableOpacity>
          </View>

          {LEGAL_DOCUMENTS.map(doc => (
            <DocumentCard
              key={doc.id}
              document={doc}
              isExpanded={expandedDoc === doc.id}
              onToggle={() => toggleDocument(doc.id)}
            />
          ))}

          <View style={styles.disclaimerCard}>
            <AlertTriangle size={18} color={Colors.warning} />
            <View style={styles.disclaimerContent}>
              <Text style={styles.disclaimerTitle}>Important Notice</Text>
              <Text style={styles.disclaimerText}>
                These documents are provided for informational purposes. Investment in securities involves risk, including possible loss of principal. {COMPANY_NAME} recommends consulting with qualified legal, tax, and financial advisors before investing. Securities offered through the Platform are not FDIC insured, not bank guaranteed, and may lose value.
              </Text>
            </View>
          </View>

          <View style={styles.footer}>
            <View style={styles.footerLogo}>
              <Gavel size={16} color={Colors.textTertiary} />
              <Text style={styles.footerCompany}>{COMPANY_NAME}</Text>
            </View>
            <Text style={styles.footerAddress}>{COMPANY_ADDRESS}</Text>
            <Text style={styles.footerContact}>
              {COMPANY_EMAIL_LEGAL} {'\u2022'} {COMPANY_PHONE}
            </Text>
            <Text style={styles.footerCopyright}>
              {'\u00A9'} {new Date().getFullYear()} {COMPANY_NAME}. All rights reserved.
            </Text>
            <Text style={styles.footerVersion}>
              Documents last updated: {EFFECTIVE_DATE}
            </Text>
          </View>

          <View style={styles.bottomPadding} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  safeArea: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  backButton: { padding: 8 },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { color: Colors.text, fontSize: 20, fontWeight: '800' as const },
  headerSubtitle: { color: Colors.textSecondary, fontSize: 13, marginTop: 4 },
  scrollContent: { padding: 20, paddingBottom: 140 },
  legalBanner: { backgroundColor: Colors.surface, borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  bannerIconRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bannerIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  bannerTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const },
  bannerSubtitle: { color: Colors.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 18, marginTop: 4 },
  quickLinksRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  quickLink: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: Colors.surface, borderRadius: 12, paddingVertical: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  quickLinkText: { color: Colors.text, fontSize: 12, fontWeight: '600' as const },
  documentCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  documentHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  documentHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  documentIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  documentMeta: { flex: 1 },
  documentTitle: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  documentSubtitle: { color: Colors.textTertiary, fontSize: 12, marginTop: 2 },
  documentBody: { marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: Colors.surfaceBorder + '50' },
  documentInfoBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.background, borderRadius: 12, padding: 12, marginBottom: 12 },
  documentInfoItem: { alignItems: 'center' },
  documentInfoLabel: { color: Colors.textTertiary, fontSize: 11, marginBottom: 2 },
  documentInfoValue: { color: Colors.text, fontSize: 13, fontWeight: '700' as const },
  documentInfoDivider: { width: 1, height: 28, backgroundColor: Colors.surfaceBorder, marginHorizontal: 16 },
  expandAllBtn: { marginLeft: 'auto' as const, paddingVertical: 6, paddingHorizontal: 14, borderRadius: 8, backgroundColor: Colors.primary + '15' },
  expandAllBtnText: { color: Colors.primary, fontWeight: '700' as const, fontSize: 12 },
  sectionItem: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder + '40' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14 },
  sectionHeading: { flex: 1, color: Colors.text, fontSize: 14, fontWeight: '600' as const, marginRight: 8 },
  sectionContent: { paddingBottom: 14 },
  sectionText: { color: Colors.textSecondary, fontSize: 13, lineHeight: 20 },
  disclaimerCard: { flexDirection: 'row', backgroundColor: Colors.warning + '10', borderRadius: 14, padding: 16, marginTop: 8, marginBottom: 12, borderWidth: 1, borderColor: Colors.warning + '25', gap: 12, alignItems: 'flex-start' },
  disclaimerContent: { flex: 1 },
  disclaimerTitle: { color: Colors.text, fontSize: 14, fontWeight: '700' as const, marginBottom: 4 },
  disclaimerText: { color: Colors.textSecondary, fontSize: 12, lineHeight: 18 },
  footer: { alignItems: 'center', paddingVertical: 20, marginTop: 16, borderTopWidth: 1, borderTopColor: Colors.surfaceBorder },
  footerLogo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 8 },
  footerCompany: { color: Colors.text, fontSize: 14, fontWeight: '700' as const, textAlign: 'center' },
  footerAddress: { color: Colors.textTertiary, fontSize: 12, textAlign: 'center', marginTop: 4 },
  footerContact: { color: Colors.textTertiary, fontSize: 12, textAlign: 'center', marginTop: 2 },
  footerCopyright: { color: Colors.textTertiary, fontSize: 11, textAlign: 'center', marginTop: 8 },
  footerVersion: { color: Colors.textTertiary, fontSize: 10, textAlign: 'center', marginTop: 2 },
  bottomPadding: { height: 120 },
  scrollView: { backgroundColor: Colors.background }});
