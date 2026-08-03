import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import Colors from '@/constants/colors';
import { renderSafeViewChildren } from '@/components/SafeViewChildren';

const MOCK_W = Dimensions.get('window').width - 64;
const PHONE_H = 280;
const BAR_H = 22;

const PhoneFrame = ({ children, themeColor }: { children: React.ReactNode; themeColor: string }) => (
  <View style={[mockStyles.phoneFrame, { borderColor: themeColor + '30' }]}>
    <View style={mockStyles.statusBar}>
      <Text style={mockStyles.statusTime}>9:41</Text>
      <View style={mockStyles.statusRight}>
        <View style={mockStyles.signalDot} />
        <View style={mockStyles.signalDot} />
        <View style={mockStyles.signalDot} />
        <View style={[mockStyles.batteryIcon, { backgroundColor: themeColor }]} />
      </View>
    </View>
    <View style={mockStyles.phoneContent}>{renderSafeViewChildren(children)}</View>
    <View style={mockStyles.homeIndicator}>
      <View style={mockStyles.homeBar} />
    </View>
  </View>
);

const MiniCard = ({ color, title, value, sub }: { color: string; title: string; value: string; sub?: string }) => (
  <View style={[mockStyles.miniCard, { borderColor: color + '20' }]}>
    <View style={[mockStyles.miniCardDot, { backgroundColor: color }]} />
    <Text style={mockStyles.miniCardTitle} numberOfLines={1}>{title}</Text>
    <Text style={[mockStyles.miniCardValue, { color }]}>{value}</Text>
    {sub ? <Text style={mockStyles.miniCardSub}>{sub}</Text> : null}
  </View>
);

const MiniRow = ({ label, value, color }: { label: string; value: string; color?: string }) => (
  <View style={mockStyles.miniRow}>
    <View style={[mockStyles.miniRowDot, { backgroundColor: color || Colors.textTertiary }]} />
    <Text style={mockStyles.miniRowLabel} numberOfLines={1}>{label}</Text>
    <Text style={[mockStyles.miniRowValue, color ? { color } : {}]}>{value}</Text>
  </View>
);

const MiniBar = ({ pct, color }: { pct: number; color: string }) => (
  <View style={mockStyles.miniBarBg}>
    <View style={[mockStyles.miniBarFill, { width: `${pct}%`, backgroundColor: color }]} />
  </View>
);

const MiniBtn = ({ label, color, filled }: { label: string; color: string; filled?: boolean }) => (
  <View style={[mockStyles.miniBtn, filled ? { backgroundColor: color } : { borderColor: color + '40', borderWidth: 1 }]}>
    <Text style={[mockStyles.miniBtnText, { color: filled ? '#000' : color }]}>{label}</Text>
  </View>
);

const ScreenHeader = ({ title, color }: { title: string; color: string }) => (
  <View style={mockStyles.screenHeader}>
    <View style={mockStyles.backChevron}>
      <Text style={{ color: Colors.textSecondary, fontSize: 10 }}>{'‹'}</Text>
    </View>
    <Text style={[mockStyles.screenHeaderTitle, { color }]} numberOfLines={1}>{title}</Text>
    <View style={{ width: 16 }} />
  </View>
);

export function IntroMockup() {
  return (
    <PhoneFrame themeColor="#FFD700">
      <View style={mockStyles.introScreen}>
        <View style={mockStyles.introLogoWrap}>
          <View style={[mockStyles.introLogo, { backgroundColor: '#FFD700' }]}>
            <Text style={{ fontSize: 14, fontWeight: '900' as const, color: '#000' }}>IVX</Text>
          </View>
        </View>
        <Text style={mockStyles.introTitle}>IVXHOLDINGS</Text>
        <Text style={mockStyles.introSub}>Invest in Premium Properties</Text>
        <View style={mockStyles.introMetrics}>
          <View style={mockStyles.introMetric}>
            <Text style={[mockStyles.introMetricVal, { color: '#FFD700' }]}>$326T</Text>
            <Text style={mockStyles.introMetricLbl}>Market Size</Text>
          </View>
          <View style={mockStyles.introMetricDivider} />
          <View style={mockStyles.introMetric}>
            <Text style={[mockStyles.introMetricVal, { color: '#00C48C' }]}>340+</Text>
            <Text style={mockStyles.introMetricLbl}>Features</Text>
          </View>
          <View style={mockStyles.introMetricDivider} />
          <View style={mockStyles.introMetric}>
            <Text style={[mockStyles.introMetricVal, { color: '#4A90D9' }]}>$100</Text>
            <Text style={mockStyles.introMetricLbl}>Min Invest</Text>
          </View>
        </View>
        <MiniBtn label="Get Started" color="#FFD700" filled />
        <MiniBtn label="Sign In" color="#FFD700" />
      </View>
    </PhoneFrame>
  );
}

export function OpportunityMockup() {
  return (
    <PhoneFrame themeColor="#4A90D9">
      <ScreenHeader title="Market Opportunity" color="#4A90D9" />
      <View style={mockStyles.padded}>
        <View style={mockStyles.chartArea}>
          <Text style={{ fontSize: 8, color: Colors.textTertiary, marginBottom: 2 }}>GLOBAL RE MARKET</Text>
          <Text style={{ fontSize: 16, fontWeight: '800' as const, color: '#4A90D9' }}>$326 Trillion</Text>
          <View style={mockStyles.miniChartLine}>
            {[30, 42, 38, 55, 50, 68, 62, 78, 85, 92].map((h, i) => (
              <View key={i} style={[mockStyles.chartBarItem, { height: h * 0.5, backgroundColor: i >= 8 ? '#FFD700' : '#4A90D9' + (i > 5 ? 'CC' : '60') }]} />
            ))}
          </View>
        </View>
        <MiniRow label="Millionaires via RE" value="90%" color="#FFD700" />
        <MiniRow label="Americans investing" value="15%" color="#FF4D4D" />
        <MiniRow label="Annual growth rate" value="+8.2%" color="#00C48C" />
        <MiniRow label="Barrier removed" value="Yes" color="#4A90D9" />
      </View>
    </PhoneFrame>
  );
}

export function PlatformMockup() {
  return (
    <PhoneFrame themeColor="#00C48C">
      <ScreenHeader title="Platform Overview" color="#00C48C" />
      <View style={mockStyles.padded}>
        <View style={mockStyles.featureGrid}>
          {[
            { icon: '🏠', label: 'Marketplace', count: '45+' },
            { icon: '📊', label: 'Analytics', count: '30+' },
            { icon: '💰', label: 'Wallet', count: '25+' },
            { icon: '🤖', label: 'AI Suite', count: '40+' },
            { icon: '🛡️', label: 'Security', count: '35+' },
            { icon: '👑', label: 'Admin', count: '45+' },
          ].map((f, i) => (
            <View key={i} style={mockStyles.featureGridItem}>
              <Text style={{ fontSize: 14 }}>{f.icon}</Text>
              <Text style={{ fontSize: 7, color: Colors.text, fontWeight: '600' as const }}>{f.label}</Text>
              <Text style={{ fontSize: 7, color: '#00C48C' }}>{f.count}</Text>
            </View>
          ))}
        </View>
        <View style={mockStyles.totalFeatBar}>
          <Text style={{ fontSize: 8, color: Colors.textSecondary }}>Total Features</Text>
          <Text style={{ fontSize: 14, fontWeight: '800' as const, color: '#00C48C' }}>340+</Text>
        </View>
        <MiniBar pct={85} color="#00C48C" />
        <MiniRow label="iOS + Android + Web" value="✓" color="#00C48C" />
        <MiniRow label="SEC Compliant" value="✓" color="#FFD700" />
      </View>
    </PhoneFrame>
  );
}

export function OnboardingMockup() {
  return (
    <PhoneFrame themeColor="#9B59B6">
      <ScreenHeader title="KYC Verification" color="#9B59B6" />
      <View style={mockStyles.padded}>
        <View style={mockStyles.kycSteps}>
          {[
            { step: '1', label: 'Personal Info', status: 'done' },
            { step: '2', label: 'ID Verification', status: 'active' },
            { step: '3', label: 'Accreditation', status: 'pending' },
            { step: '4', label: 'Biometric Auth', status: 'pending' },
          ].map((s, i) => (
            <View key={i} style={mockStyles.kycStep}>
              <View style={[
                mockStyles.kycStepCircle,
                s.status === 'done' ? { backgroundColor: '#00C48C' } :
                s.status === 'active' ? { backgroundColor: '#9B59B6' } :
                { backgroundColor: Colors.backgroundTertiary }
              ]}>
                <Text style={{ fontSize: 8, color: '#fff', fontWeight: '700' as const }}>
                  {s.status === 'done' ? '✓' : s.step}
                </Text>
              </View>
              <Text style={[mockStyles.kycStepLabel, s.status === 'active' && { color: '#9B59B6' }]}>{s.label}</Text>
              {i < 3 && <View style={[mockStyles.kycLine, s.status === 'done' && { backgroundColor: '#00C48C' }]} />}
            </View>
          ))}
        </View>
        <View style={mockStyles.idCard}>
          <View style={mockStyles.idCardPhoto} />
          <View style={{ flex: 1, gap: 3 }}>
            <View style={[mockStyles.idCardLine, { width: '80%' }]} />
            <View style={[mockStyles.idCardLine, { width: '60%' }]} />
            <View style={[mockStyles.idCardLine, { width: '40%', backgroundColor: '#9B59B6' + '40' }]} />
          </View>
        </View>
        <View style={mockStyles.verifyBadge}>
          <Text style={{ fontSize: 8, color: '#9B59B6', fontWeight: '700' as const }}>🔐 AI-Powered Document Scan</Text>
        </View>
        <MiniBtn label="Continue Verification" color="#9B59B6" filled />
      </View>
    </PhoneFrame>
  );
}

export function MarketplaceMockup() {
  return (
    <PhoneFrame themeColor="#FF6B6B">
      <ScreenHeader title="Property Marketplace" color="#FF6B6B" />
      <View style={mockStyles.padded}>
        <View style={mockStyles.searchBar}>
          <Text style={{ fontSize: 8, color: Colors.textTertiary }}>🔍 Search properties...</Text>
          <View style={mockStyles.filterChip}><Text style={{ fontSize: 7, color: '#FF6B6B' }}>Filters</Text></View>
        </View>
        {[
          { name: 'Sunset Tower', loc: 'Miami, FL', price: '$2.4M', roi: '+12.8%', pct: 72 },
          { name: 'Harbor View', loc: 'NYC, NY', price: '$5.1M', roi: '+9.4%', pct: 45 },
        ].map((p, i) => (
          <View key={i} style={mockStyles.propertyCard}>
            <View style={[mockStyles.propertyImg, { backgroundColor: i === 0 ? '#FF6B6B' + '15' : '#4A90D9' + '15' }]}>
              <Text style={{ fontSize: 16 }}>{i === 0 ? '🏢' : '🏙️'}</Text>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontSize: 9, fontWeight: '700' as const, color: Colors.text }}>{p.name}</Text>
              <Text style={{ fontSize: 7, color: Colors.textTertiary }}>{p.loc}</Text>
              <View style={{ flexDirection: 'row' as const, justifyContent: 'space-between' as const }}>
                <Text style={{ fontSize: 8, fontWeight: '700' as const, color: '#FFD700' }}>{p.price}</Text>
                <Text style={{ fontSize: 8, fontWeight: '600' as const, color: '#00C48C' }}>{p.roi}</Text>
              </View>
              <MiniBar pct={p.pct} color="#FF6B6B" />
            </View>
          </View>
        ))}
      </View>
    </PhoneFrame>
  );
}

export function TradingMockup() {
  return (
    <PhoneFrame themeColor="#FFB800">
      <ScreenHeader title="Investment Engine" color="#FFB800" />
      <View style={mockStyles.padded}>
        <View style={mockStyles.tradeHeader}>
          <Text style={{ fontSize: 12, fontWeight: '800' as const, color: Colors.text }}>Sunset Tower</Text>
          <Text style={{ fontSize: 10, fontWeight: '700' as const, color: '#00C48C' }}>$24.50 / share</Text>
        </View>
        <View style={mockStyles.miniChartLine}>
          {[40, 45, 42, 50, 55, 48, 60, 65, 58, 70, 72, 78].map((h, i) => (
            <View key={i} style={[mockStyles.chartBarItem, { height: h * 0.5, backgroundColor: '#00C48C' + (i > 8 ? 'FF' : '60') }]} />
          ))}
        </View>
        <View style={mockStyles.tradeTypes}>
          <View style={[mockStyles.tradeType, { backgroundColor: '#FFB800' }]}>
            <Text style={{ fontSize: 8, fontWeight: '700' as const, color: '#000' }}>Market</Text>
          </View>
          <View style={mockStyles.tradeType}>
            <Text style={{ fontSize: 8, fontWeight: '600' as const, color: Colors.textSecondary }}>Limit</Text>
          </View>
          <View style={mockStyles.tradeType}>
            <Text style={{ fontSize: 8, fontWeight: '600' as const, color: Colors.textSecondary }}>DRIP</Text>
          </View>
        </View>
        <View style={mockStyles.tradeInput}>
          <Text style={{ fontSize: 8, color: Colors.textTertiary }}>Amount</Text>
          <Text style={{ fontSize: 14, fontWeight: '800' as const, color: Colors.text }}>$500.00</Text>
          <Text style={{ fontSize: 7, color: Colors.textTertiary }}>≈ 20.4 shares</Text>
        </View>
        <MiniBtn label="Buy Shares" color="#00C48C" filled />
      </View>
    </PhoneFrame>
  );
}

export function PortfolioMockup() {
  return (
    <PhoneFrame themeColor="#4A90D9">
      <ScreenHeader title="My Portfolio" color="#4A90D9" />
      <View style={mockStyles.padded}>
        <View style={mockStyles.portfolioTotal}>
          <Text style={{ fontSize: 8, color: Colors.textTertiary }}>TOTAL VALUE</Text>
          <Text style={{ fontSize: 18, fontWeight: '900' as const, color: Colors.text }}>$47,832</Text>
          <Text style={{ fontSize: 9, fontWeight: '600' as const, color: '#00C48C' }}>+$3,241 (7.2%) ↑</Text>
        </View>
        <View style={mockStyles.donutChart}>
          <View style={[mockStyles.donutSegment, { backgroundColor: '#FFD700', transform: [{ rotate: '0deg' }] }]} />
          <View style={[mockStyles.donutSegment, { backgroundColor: '#4A90D9', transform: [{ rotate: '120deg' }] }]} />
          <View style={[mockStyles.donutSegment, { backgroundColor: '#00C48C', transform: [{ rotate: '240deg' }] }]} />
          <View style={mockStyles.donutCenter}>
            <Text style={{ fontSize: 7, color: Colors.textTertiary }}>3 Assets</Text>
          </View>
        </View>
        <MiniRow label="Sunset Tower" value="+12.8%" color="#FFD700" />
        <MiniRow label="Harbor View" value="+9.4%" color="#4A90D9" />
        <MiniRow label="Palm Gardens" value="+5.1%" color="#00C48C" />
      </View>
    </PhoneFrame>
  );
}

export function WalletMockup() {
  return (
    <PhoneFrame themeColor="#2ECC71">
      <ScreenHeader title="Digital Wallet" color="#2ECC71" />
      <View style={mockStyles.padded}>
        <View style={[mockStyles.walletBalance, { borderColor: '#2ECC71' + '30' }]}>
          <Text style={{ fontSize: 8, color: Colors.textTertiary }}>AVAILABLE BALANCE</Text>
          <Text style={{ fontSize: 20, fontWeight: '900' as const, color: Colors.text }}>$12,450</Text>
        </View>
        <View style={mockStyles.paymentGrid}>
          {[
            { icon: '🏦', label: 'ACH' },
            { icon: '💳', label: 'Card' },
            { icon: '🔗', label: 'Wire' },
            { icon: '₿', label: 'Crypto' },
          ].map((p, i) => (
            <View key={i} style={mockStyles.paymentItem}>
              <Text style={{ fontSize: 12 }}>{p.icon}</Text>
              <Text style={{ fontSize: 7, color: Colors.textSecondary }}>{p.label}</Text>
            </View>
          ))}
        </View>
        <MiniRow label="Deposit" value="+ $5,000" color="#00C48C" />
        <MiniRow label="Investment" value="- $2,500" color="#FF4D4D" />
        <MiniRow label="Dividend" value="+ $180" color="#FFD700" />
        <MiniBtn label="Add Funds" color="#2ECC71" filled />
      </View>
    </PhoneFrame>
  );
}

export function TokenomicsMockup() {
  return (
    <PhoneFrame themeColor="#F39C12">
      <ScreenHeader title="IVXHOLDINGS Token" color="#F39C12" />
      <View style={mockStyles.padded}>
        <View style={mockStyles.tokenBalance}>
          <View style={[mockStyles.tokenIcon, { backgroundColor: '#F39C12' }]}>
            <Text style={{ fontSize: 10, fontWeight: '900' as const, color: '#000' }}>IVX</Text>
          </View>
          <View>
            <Text style={{ fontSize: 14, fontWeight: '800' as const, color: Colors.text }}>2,450 IVX</Text>
            <Text style={{ fontSize: 8, color: Colors.textTertiary }}>≈ $1,225.00</Text>
          </View>
        </View>
        <View style={mockStyles.stakingCard}>
          <Text style={{ fontSize: 8, color: Colors.textTertiary }}>STAKING REWARDS</Text>
          <Text style={{ fontSize: 14, fontWeight: '800' as const, color: '#F39C12' }}>12.5% APY</Text>
          <MiniBar pct={65} color="#F39C12" />
          <Text style={{ fontSize: 7, color: Colors.textTertiary }}>1,592 / 2,450 staked</Text>
        </View>
        <MiniRow label="Governance Votes" value="Active" color="#F39C12" />
        <MiniRow label="Tier Status" value="Gold" color="#FFD700" />
        <MiniRow label="Referral Bonus" value="2.5x" color="#00C48C" />
      </View>
    </PhoneFrame>
  );
}

export function AIMockup() {
  return (
    <PhoneFrame themeColor="#E91E63">
      <ScreenHeader title="AI Assistant" color="#E91E63" />
      <View style={mockStyles.padded}>
        <View style={mockStyles.chatBubbleAI}>
          <View style={[mockStyles.aiAvatar, { backgroundColor: '#E91E63' }]}>
            <Text style={{ fontSize: 8, color: '#fff', fontWeight: '700' as const }}>AI</Text>
          </View>
          <View style={mockStyles.chatBubbleContent}>
            <Text style={{ fontSize: 8, color: Colors.text, lineHeight: 12 }}>
              Based on your portfolio, I recommend diversifying into commercial RE. Sunset Tower shows strong 12.8% returns.
            </Text>
          </View>
        </View>
        <View style={mockStyles.chatBubbleUser}>
          <View style={mockStyles.chatBubbleContentUser}>
            <Text style={{ fontSize: 8, color: '#000', lineHeight: 12 }}>Show me top properties under $3M</Text>
          </View>
        </View>
        <View style={mockStyles.aiSuggestions}>
          {['Portfolio Analysis', 'Market Trends', 'Tax Optimization'].map((s, i) => (
            <View key={i} style={[mockStyles.aiSuggestionChip, { borderColor: '#E91E63' + '30' }]}>
              <Text style={{ fontSize: 7, color: '#E91E63' }}>{s}</Text>
            </View>
          ))}
        </View>
        <View style={mockStyles.aiInputBar}>
          <View style={mockStyles.aiInput}>
            <Text style={{ fontSize: 8, color: Colors.textTertiary }}>Ask anything about investments...</Text>
          </View>
          <View style={[mockStyles.aiSendBtn, { backgroundColor: '#E91E63' }]}>
            <Text style={{ fontSize: 8, color: '#fff' }}>↑</Text>
          </View>
        </View>
      </View>
    </PhoneFrame>
  );
}

export function AdminMockup() {
  return (
    <PhoneFrame themeColor="#FFD700">
      <ScreenHeader title="Admin Command Center" color="#FFD700" />
      <View style={mockStyles.padded}>
        <View style={mockStyles.adminStats}>
          {[
            { label: 'Users', value: '12.4K', color: '#4A90D9' },
            { label: 'Revenue', value: '$2.1M', color: '#00C48C' },
            { label: 'Trades', value: '8,432', color: '#FFD700' },
          ].map((s, i) => (
            <View key={i} style={mockStyles.adminStatItem}>
              <Text style={{ fontSize: 7, color: Colors.textTertiary }}>{s.label}</Text>
              <Text style={{ fontSize: 11, fontWeight: '800' as const, color: s.color }}>{s.value}</Text>
            </View>
          ))}
        </View>
        <View style={mockStyles.adminGrid}>
          {[
            { icon: '👥', label: 'Members' },
            { icon: '💳', label: 'Transactions' },
            { icon: '📧', label: 'Email Engine' },
            { icon: '📊', label: 'Analytics' },
            { icon: '🎯', label: 'Marketing' },
            { icon: '🔔', label: 'Alerts' },
          ].map((t, i) => (
            <View key={i} style={mockStyles.adminGridItem}>
              <Text style={{ fontSize: 12 }}>{t.icon}</Text>
              <Text style={{ fontSize: 7, color: Colors.textSecondary }}>{t.label}</Text>
            </View>
          ))}
        </View>
        <MiniRow label="Active Sessions" value="1,247" color="#00C48C" />
        <MiniRow label="Pending KYC" value="38" color="#FFB800" />
      </View>
    </PhoneFrame>
  );
}

export function SecurityMockup() {
  return (
    <PhoneFrame themeColor="#607D8B">
      <ScreenHeader title="Security Center" color="#607D8B" />
      <View style={mockStyles.padded}>
        <View style={mockStyles.securityScore}>
          <View style={[mockStyles.shieldIcon, { borderColor: '#00C48C' }]}>
            <Text style={{ fontSize: 14 }}>🛡️</Text>
          </View>
          <Text style={{ fontSize: 10, fontWeight: '700' as const, color: '#00C48C' }}>Security Score: 98/100</Text>
        </View>
        {[
          { label: 'End-to-End Encryption', status: 'Active', color: '#00C48C' },
          { label: 'Two-Factor Auth', status: 'Enabled', color: '#00C48C' },
          { label: 'SEC Compliance', status: 'Verified', color: '#FFD700' },
          { label: 'GDPR Ready', status: 'Compliant', color: '#4A90D9' },
          { label: 'Threat Monitoring', status: '24/7', color: '#00C48C' },
        ].map((s, i) => (
          <View key={i} style={mockStyles.securityItem}>
            <View style={[mockStyles.securityDot, { backgroundColor: s.color }]} />
            <Text style={{ fontSize: 8, color: Colors.text, flex: 1 }}>{s.label}</Text>
            <Text style={{ fontSize: 7, fontWeight: '600' as const, color: s.color }}>{s.status}</Text>
          </View>
        ))}
      </View>
    </PhoneFrame>
  );
}

export function GrowthMockup() {
  return (
    <PhoneFrame themeColor="#00BCD4">
      <ScreenHeader title="Growth Engine" color="#00BCD4" />
      <View style={mockStyles.padded}>
        <View style={mockStyles.referralCard}>
          <Text style={{ fontSize: 8, color: Colors.textTertiary }}>YOUR REFERRAL CODE</Text>
          <View style={mockStyles.referralCode}>
            <Text style={{ fontSize: 12, fontWeight: '800' as const, color: '#FFD700', letterSpacing: 2 }}>IVXHOLDINGS-G7K2M</Text>
          </View>
          <Text style={{ fontSize: 7, color: Colors.textTertiary }}>Share & earn up to $500 per referral</Text>
        </View>
        <View style={mockStyles.referralStats}>
          <MiniCard color="#00BCD4" title="Referrals" value="24" />
          <MiniCard color="#FFD700" title="Earned" value="$4,800" />
        </View>
        <MiniRow label="Tier 1 Referrals" value="18" color="#00BCD4" />
        <MiniRow label="Tier 2 Referrals" value="6" color="#4A90D9" />
        <MiniRow label="Influencer Status" value="Active" color="#00C48C" />
      </View>
    </PhoneFrame>
  );
}

export function MetricsMockup() {
  return (
    <PhoneFrame themeColor="#FF5722">
      <ScreenHeader title="Key Metrics" color="#FF5722" />
      <View style={mockStyles.padded}>
        <View style={mockStyles.metricsGrid}>
          {[
            { label: 'User Growth', value: '+32%', color: '#00C48C' },
            { label: 'Txn Volume', value: '$4.2M', color: '#FFD700' },
            { label: 'Avg Return', value: '9.8%', color: '#4A90D9' },
            { label: 'NPS Score', value: '72', color: '#FF5722' },
          ].map((m, i) => (
            <View key={i} style={mockStyles.metricBox}>
              <Text style={{ fontSize: 7, color: Colors.textTertiary }}>{m.label}</Text>
              <Text style={{ fontSize: 13, fontWeight: '800' as const, color: m.color }}>{m.value}</Text>
              <MiniBar pct={60 + i * 10} color={m.color} />
            </View>
          ))}
        </View>
        <View style={mockStyles.miniChartLine}>
          {[25, 35, 30, 45, 55, 50, 65, 70, 68, 80, 85, 92].map((h, i) => (
            <View key={i} style={[mockStyles.chartBarItem, { height: h * 0.45, backgroundColor: '#FF5722' + (i > 8 ? 'FF' : '50') }]} />
          ))}
        </View>
      </View>
    </PhoneFrame>
  );
}

export function ClosingMockup() {
  return (
    <PhoneFrame themeColor="#FFD700">
      <View style={mockStyles.closingScreen}>
        <View style={[mockStyles.closingLogo, { backgroundColor: '#FFD700' }]}>
          <Text style={{ fontSize: 16, fontWeight: '900' as const, color: '#000' }}>IVX</Text>
        </View>
        <Text style={mockStyles.closingTitle}>Start Building Your{'\n'}Real Estate Empire</Text>
        <Text style={mockStyles.closingSub}>Join thousands of investors already{'\n'}earning passive income</Text>
        <View style={mockStyles.closingFeats}>
          {['Start from $100', 'SEC Compliant', '340+ Features'].map((f, i) => (
            <View key={i} style={mockStyles.closingFeatItem}>
              <View style={[mockStyles.closingCheck, { backgroundColor: '#FFD700' }]}>
                <Text style={{ fontSize: 7, color: '#000', fontWeight: '700' as const }}>✓</Text>
              </View>
              <Text style={{ fontSize: 8, color: Colors.text }}>{f}</Text>
            </View>
          ))}
        </View>
        <MiniBtn label="Download Now - Free" color="#FFD700" filled />
        <Text style={{ fontSize: 7, color: Colors.textTertiary, textAlign: 'center' as const, marginTop: 6 }}>
          Available on iOS, Android & Web
        </Text>
      </View>
    </PhoneFrame>
  );
}

export const SCREEN_MOCKUP_MAP: Record<string, React.FC> = {
  intro: IntroMockup,
  opportunity: OpportunityMockup,
  platform: PlatformMockup,
  onboarding: OnboardingMockup,
  marketplace: MarketplaceMockup,
  trading: TradingMockup,
  portfolio: PortfolioMockup,
  wallet: WalletMockup,
  tokenomics: TokenomicsMockup,
  ai: AIMockup,
  admin: AdminMockup,
  security: SecurityMockup,
  growth: GrowthMockup,
  metrics: MetricsMockup,
  closing: ClosingMockup};

const mockStyles = StyleSheet.create({
  phoneFrame: {
    width: '100%',
    height: PHONE_H,
    backgroundColor: '#0C0C0C',
    borderRadius: 20,
    borderWidth: 1.5,
    overflow: 'hidden'},
  statusBar: {
    height: BAR_H,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    backgroundColor: '#0A0A0A'},
  statusTime: {
    fontSize: 8,
    fontWeight: '600' as const,
    color: Colors.text},
  statusRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3},
  signalDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: Colors.textTertiary},
  batteryIcon: {
    width: 14,
    height: 7,
    borderRadius: 2,
    marginLeft: 3},
  phoneContent: {
    flex: 1,
    backgroundColor: '#0A0A0A'},
  homeIndicator: {
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0A0A0A'},
  homeBar: {
    width: 40,
    height: 3,
    borderRadius: 2,
    backgroundColor: Colors.textTertiary},
  padded: {
    paddingHorizontal: 10,
    gap: 5},
  screenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 6},
  backChevron: {
    width: 16,
    height: 16,
    borderRadius: 5,
    backgroundColor: Colors.backgroundTertiary,
    justifyContent: 'center',
    alignItems: 'center'},
  screenHeaderTitle: {
    fontSize: 11,
    fontWeight: '700' as const,
    flex: 1},
  introScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    gap: 6},
  introLogoWrap: {
    marginBottom: 4},
  introLogo: {
    width: 44,
    height: 44,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center'},
  introTitle: {
    fontSize: 16,
    fontWeight: '900' as const,
    color: Colors.text,
    textAlign: 'center'},
  introSub: {
    fontSize: 8,
    color: Colors.textSecondary,
    textAlign: 'center'},
  introMetrics: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginVertical: 8},
  introMetric: {
    alignItems: 'center'},
  introMetricVal: {
    fontSize: 12,
    fontWeight: '800' as const},
  introMetricLbl: {
    fontSize: 7,
    color: Colors.textTertiary},
  introMetricDivider: {
    width: 1,
    height: 20,
    backgroundColor: Colors.border},
  chartArea: {
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 8,
    padding: 8,
    marginBottom: 2},
  miniChartLine: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 40,
    gap: 2,
    marginTop: 4},
  chartBarItem: {
    flex: 1,
    borderRadius: 2,
    minHeight: 3},
  miniCard: {
    flex: 1,
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    gap: 2},
  miniCardDot: {
    width: 5,
    height: 5,
    borderRadius: 3},
  miniCardTitle: {
    fontSize: 7,
    color: Colors.textTertiary},
  miniCardValue: {
    fontSize: 12,
    fontWeight: '800' as const},
  miniCardSub: {
    fontSize: 6,
    color: Colors.textTertiary},
  miniRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    gap: 6},
  miniRowDot: {
    width: 4,
    height: 4,
    borderRadius: 2},
  miniRowLabel: {
    fontSize: 8,
    color: Colors.textSecondary,
    flex: 1},
  miniRowValue: {
    fontSize: 8,
    fontWeight: '700' as const,
    color: Colors.text},
  miniBarBg: {
    height: 3,
    backgroundColor: Colors.border,
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 2},
  miniBarFill: {
    height: '100%',
    borderRadius: 2},
  miniBtn: {
    borderRadius: 8,
    paddingVertical: 7,
    alignItems: 'center',
    marginTop: 3},
  miniBtnText: {
    fontSize: 9,
    fontWeight: '700' as const},
  featureGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4},
  featureGridItem: {
    width: '31%',
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 8,
    padding: 6,
    alignItems: 'center',
    gap: 2},
  totalFeatBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 6,
    padding: 8,
    marginTop: 2},
  kycSteps: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 0,
    marginBottom: 6,
    paddingHorizontal: 4},
  kycStep: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 2},
  kycStepCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center'},
  kycStepLabel: {
    fontSize: 6,
    color: Colors.textTertiary,
    marginLeft: 1},
  kycLine: {
    width: 12,
    height: 1.5,
    backgroundColor: Colors.border,
    marginHorizontal: 2},
  idCard: {
    flexDirection: 'row',
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 8,
    padding: 8,
    gap: 8,
    alignItems: 'center',
    marginVertical: 4},
  idCardPhoto: {
    width: 30,
    height: 36,
    borderRadius: 4,
    backgroundColor: Colors.border},
  idCardLine: {
    height: 4,
    backgroundColor: Colors.border,
    borderRadius: 2},
  verifyBadge: {
    alignSelf: 'center',
    backgroundColor: '#9B59B6' + '12',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 4},
  searchBar: {
    flexDirection: 'row',
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4},
  filterChip: {
    backgroundColor: '#FF6B6B' + '15',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2},
  propertyCard: {
    flexDirection: 'row',
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 8,
    padding: 6,
    gap: 8,
    alignItems: 'center'},
  propertyImg: {
    width: 40,
    height: 40,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center'},
  tradeHeader: {
    alignItems: 'center',
    gap: 2,
    marginBottom: 2},
  tradeTypes: {
    flexDirection: 'row',
    gap: 4,
    justifyContent: 'center',
    marginTop: 4},
  tradeType: {
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: Colors.backgroundTertiary},
  tradeInput: {
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 8,
    padding: 8,
    alignItems: 'center',
    gap: 1,
    marginTop: 4},
  portfolioTotal: {
    alignItems: 'center',
    gap: 2,
    marginBottom: 2},
  donutChart: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignSelf: 'center',
    position: 'relative',
    backgroundColor: Colors.backgroundTertiary,
    overflow: 'hidden',
    marginVertical: 4},
  donutSegment: {
    position: 'absolute',
    width: 25,
    height: 50,
    left: 0,
    top: 0,
    borderTopLeftRadius: 25,
    borderBottomLeftRadius: 25},
  donutCenter: {
    position: 'absolute',
    top: 12,
    left: 12,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#0A0A0A',
    justifyContent: 'center',
    alignItems: 'center'},
  walletBalance: {
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
    gap: 2,
    borderWidth: 1},
  paymentGrid: {
    flexDirection: 'row',
    gap: 4,
    marginVertical: 4},
  paymentItem: {
    flex: 1,
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 8,
    paddingVertical: 6,
    alignItems: 'center',
    gap: 2},
  tokenBalance: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 10,
    padding: 10,
    marginBottom: 4},
  tokenIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center'},
  stakingCard: {
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 8,
    padding: 8,
    gap: 3,
    marginBottom: 4},
  chatBubbleAI: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 6},
  aiAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center'},
  chatBubbleContent: {
    flex: 1,
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 8,
    padding: 8,
    borderTopLeftRadius: 2},
  chatBubbleUser: {
    alignItems: 'flex-end',
    marginBottom: 6},
  chatBubbleContentUser: {
    backgroundColor: '#E91E63',
    borderRadius: 8,
    padding: 8,
    borderTopRightRadius: 2,
    maxWidth: '80%'},
  aiSuggestions: {
    flexDirection: 'row',
    gap: 4,
    flexWrap: 'wrap',
    marginBottom: 4},
  aiSuggestionChip: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3},
  aiInputBar: {
    flexDirection: 'row',
    gap: 4,
    alignItems: 'center'},
  aiInput: {
    flex: 1,
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6},
  aiSendBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center'},
  adminStats: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 4},
  adminStatItem: {
    flex: 1,
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 8,
    padding: 8,
    alignItems: 'center',
    gap: 2},
  adminGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginBottom: 4},
  adminGridItem: {
    width: '31%',
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
    gap: 2},
  securityScore: {
    alignItems: 'center',
    gap: 4,
    marginBottom: 6},
  shieldIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#00C48C' + '10'},
  securityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5},
  securityDot: {
    width: 5,
    height: 5,
    borderRadius: 3},
  referralCard: {
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
    gap: 4,
    marginBottom: 4},
  referralCode: {
    backgroundColor: '#FFD700' + '10',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#FFD700' + '30',
    borderStyle: 'dashed'},
  referralStats: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 4},
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginBottom: 4},
  metricBox: {
    width: '48%',
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 8,
    padding: 8,
    gap: 2},
  closingScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    gap: 6},
  closingLogo: {
    width: 48,
    height: 48,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4},
  closingTitle: {
    fontSize: 14,
    fontWeight: '900' as const,
    color: Colors.text,
    textAlign: 'center',
    lineHeight: 18},
  closingSub: {
    fontSize: 8,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 12},
  closingFeats: {
    gap: 4,
    marginVertical: 6,
    width: '100%'},
  closingFeatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6},
  closingCheck: {
    width: 14,
    height: 14,
    borderRadius: 7,
    justifyContent: 'center',
    alignItems: 'center'}});
