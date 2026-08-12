import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import { Stack, useLocalSearchParams } from 'expo-router';
import {
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View} from "react-native";
import {
  Briefcase,
  Building2,
  CalendarClock,
  CalendarDays,
  CircleDollarSign,
  Clock,
  FileText,
  Layers,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
  Sparkles,
  Target,
  UserCircle2,
  Users} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import {
  listInvestors,
  type InvestorRecord,
  type InvestorSource,
  type InvestorStatus,
  type AccreditedStatus} from '@/src/modules/ivx-developer/investorCrmService';
import {
  getDealMatching,
  type DealMatchingResult} from '@/src/modules/ivx-developer/dealMatchingService';

const STATUS_LABEL: Record<InvestorStatus, string> = {
  prospect: 'Prospect',
  contacted: 'Contacted',
  meeting_scheduled: 'Meeting scheduled',
  active: 'Active',
  invested: 'Invested'};
const STATUS_TONE: Record<InvestorStatus, string> = {
  prospect: Colors.textTertiary,
  contacted: Colors.info,
  meeting_scheduled: Colors.warning,
  active: Colors.primary,
  invested: Colors.success};
const SOURCE_LABEL: Record<InvestorSource, string> = {
  owner_entered: 'Owner entered',
  submitted_form: 'Submitted form',
  crm_import: 'CRM import',
  public_source: 'Public source',
  verified_deal: 'Verified deal'};
const ACCREDITED_LABEL: Record<AccreditedStatus, string> = {
  accredited: 'Accredited',
  non_accredited: 'Non-accredited',
  unknown: 'Unknown'};

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Next follow-up is inferred from last contact + 7 days when not explicitly stored. */
function inferNextFollowUp(lastContactDate: string | null): { value: string; inferred: boolean } {
  if (!lastContactDate) return { value: '—', inferred: false };
  const d = new Date(lastContactDate);
  if (Number.isNaN(d.getTime())) return { value: '—', inferred: false };
  d.setDate(d.getDate() + 7);
  return { value: d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }), inferred: true };
}

function Section({ icon, title, children, action }: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionHeaderLeft}>
          {icon}
          <Text style={styles.sectionTitle}>{title}</Text>
        </View>
        {action ?? null}
      </View>
      {children}
    </View>
  );
}

function InfoRow({ icon, label, value, onPress }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onPress?: () => void;
}) {
  const body = (
    <View style={styles.infoRow}>
      <View style={styles.infoIcon}>{icon}</View>
      <View style={styles.infoTextBlock}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={[styles.infoValue, onPress ? styles.infoValueLink : null]} numberOfLines={2}>{value || '—'}</Text>
      </View>
    </View>
  );
  if (onPress && value) {
    return <Pressable onPress={onPress} testID={`crm-info-${label}`}>{body}</Pressable>;
  }
  return body;
}

function Tags({ items, alt }: { items: string[]; alt?: boolean }) {
  if (items.length === 0) return <Text style={styles.emptyInline}>Not specified</Text>;
  return (
    <View style={styles.tagWrap}>
      {items.map((t) => (
        <View key={t} style={[styles.tag, alt ? styles.tagAlt : null]}><Text style={styles.tagText}>{t}</Text></View>
      ))}
    </View>
  );
}

type Activity = { key: string; label: string; date: string; tone: string };

function buildTimeline(record: InvestorRecord): Activity[] {
  const items: Activity[] = [];
  items.push({ key: 'created', label: 'Lead created in CRM', date: record.createdAt, tone: Colors.info });
  if (record.lastContactDate) {
    items.push({ key: 'contact', label: 'Last contacted', date: record.lastContactDate, tone: Colors.primary });
  }
  if (record.updatedAt && record.updatedAt !== record.createdAt) {
    items.push({ key: 'updated', label: `Record updated · stage ${STATUS_LABEL[record.status]}`, date: record.updatedAt, tone: Colors.warning });
  }
  return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

function ContactProfileContent({ id }: { id: string }) {
  const insets = useSafeAreaInsets();

  const query = useQuery({
    queryKey: ['ivx-investor-crm', 'list'],
    queryFn: listInvestors});

  const matchingQuery = useQuery<DealMatchingResult | null>({
    queryKey: ['ivx-deal-matching'],
    queryFn: getDealMatching});

  const record = useMemo<InvestorRecord | null>(
    () => query.data?.investors.find((i) => i.id === id) ?? null,
    [query.data, id],
  );

  const relatedOpportunities = useMemo(() => {
    const result = matchingQuery.data;
    if (!result || !record) return [] as { dealId: string; dealName: string; role: string; score: number; location: string | null }[];
    const out: { dealId: string; dealName: string; role: string; score: number; location: string | null }[] = [];
    for (const deal of result.deals) {
      for (const m of deal.matches) {
        if (m.contactId === record.id) {
          out.push({ dealId: deal.dealId, dealName: deal.dealName, role: m.role, score: m.matchScore, location: deal.dealLocation });
        }
      }
    }
    return out.sort((a, b) => b.score - a.score);
  }, [matchingQuery.data, record]);

  if (query.isLoading) {
    return (
      <View style={styles.centered}><ShimmerIndicator size="large" color={Colors.primary} /></View>
    );
  }

  if (!record) {
    return (
      <View style={styles.centered}>
        <UserCircle2 size={36} color={Colors.textTertiary} />
        <Text style={styles.emptyTitle}>Contact not found</Text>
        <Text style={styles.emptyBody}>This lead may have been removed from the CRM. Pull to refresh the list.</Text>
      </View>
    );
  }

  const initials = record.name.split(/\s+/).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('') || '?';
  const tone = STATUS_TONE[record.status];
  const timeline = buildTimeline(record);
  const nextFollowUp = inferNextFollowUp(record.lastContactDate);
  const owner = record.source === 'owner_entered' && record.sourceDetail
    ? record.sourceDetail
    : record.source === 'owner_entered' ? 'Owner' : 'Unassigned';

  const openEmail = () => { if (record.email) void Linking.openURL(`mailto:${record.email}`); };
  const openPhone = () => { if (record.phone) void Linking.openURL(`tel:${record.phone}`); };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
      refreshControl={
        <RefreshControl
          tintColor={Colors.primary}
          refreshing={query.isFetching || matchingQuery.isFetching}
          onRefresh={() => { void query.refetch(); void matchingQuery.refetch(); }}
        />
      }
      testID="ivx-contact-profile-scroll"
    >
      <View style={styles.hero}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{initials}</Text></View>
        <Text style={styles.heroName}>{record.name}</Text>
        {record.company ? <Text style={styles.heroCompany}>{record.company}</Text> : null}
        <View style={styles.heroPills}>
          <View style={[styles.statusPill, { borderColor: tone }]}>
            <Text style={[styles.statusPillText, { color: tone }]}>{STATUS_LABEL[record.status]}</Text>
          </View>
          {record.accreditedStatus === 'accredited' ? (
            <View style={styles.accreditedChip}>
              <ShieldCheck size={12} color={Colors.success} />
              <Text style={styles.accreditedText}>Accredited</Text>
            </View>
          ) : null}
          <View style={styles.scoreChip}><Text style={styles.scoreChipText}>{`Lead ${record.leadScore}`}</Text></View>
          <View style={styles.scoreChip}><Text style={styles.scoreChipText}>{`Relationship ${record.relationshipScore}`}</Text></View>
        </View>
        <View style={styles.quickActions}>
          <Pressable style={[styles.quickBtn, !record.email ? styles.quickBtnDisabled : null]} onPress={openEmail} disabled={!record.email} testID="crm-action-email">
            <Mail size={16} color={record.email ? Colors.black : Colors.textTertiary} />
            <Text style={[styles.quickBtnText, !record.email ? styles.quickBtnTextDisabled : null]}>Email</Text>
          </Pressable>
          <Pressable style={[styles.quickBtnAlt, !record.phone ? styles.quickBtnAltDisabled : null]} onPress={openPhone} disabled={!record.phone} testID="crm-action-call">
            <Phone size={16} color={record.phone ? Colors.text : Colors.textTertiary} />
            <Text style={[styles.quickBtnAltText, !record.phone ? styles.quickBtnTextDisabled : null]}>Call</Text>
          </Pressable>
        </View>
      </View>

      <Section icon={<UserCircle2 size={16} color={Colors.primary} />} title="Contact details">
        <View style={styles.infoList}>
          <InfoRow icon={<Mail size={15} color={Colors.textTertiary} />} label="Email" value={record.email} onPress={record.email ? openEmail : undefined} />
          <InfoRow icon={<Phone size={15} color={Colors.textTertiary} />} label="Phone" value={record.phone} onPress={record.phone ? openPhone : undefined} />
          <InfoRow icon={<Building2 size={15} color={Colors.textTertiary} />} label="Company" value={record.company} />
          <InfoRow icon={<MapPin size={15} color={Colors.textTertiary} />} label="Location" value={record.location} />
        </View>
      </Section>

      <Section icon={<Briefcase size={16} color={Colors.primary} />} title="Investment profile">
        <View style={styles.infoList}>
          <InfoRow icon={<Users size={15} color={Colors.textTertiary} />} label="Investor type" value={record.investmentType} />
          <InfoRow icon={<ShieldCheck size={15} color={Colors.textTertiary} />} label="Accredited status" value={ACCREDITED_LABEL[record.accreditedStatus]} />
          <InfoRow icon={<CircleDollarSign size={15} color={Colors.textTertiary} />} label="Check size" value={record.typicalCheckSize} />
          <InfoRow icon={<Clock size={15} color={Colors.textTertiary} />} label="Investment timeline" value={record.investmentTimeline} />
        </View>
        <View style={styles.prefBlock}>
          <Text style={styles.prefLabel}>Markets</Text>
          <Tags items={record.preferredMarkets} />
        </View>
        <View style={styles.prefBlock}>
          <Text style={styles.prefLabel}>Asset preferences</Text>
          <Tags items={record.preferredAssetClasses} alt />
        </View>
      </Section>

      <Section icon={<Target size={16} color={Colors.primary} />} title="Pipeline & ownership">
        <View style={styles.infoList}>
          <InfoRow icon={<Layers size={15} color={Colors.textTertiary} />} label="Status" value={STATUS_LABEL[record.status]} />
          <InfoRow icon={<UserCircle2 size={15} color={Colors.textTertiary} />} label="Owner" value={owner} />
          <InfoRow icon={<Sparkles size={15} color={Colors.textTertiary} />} label="Lead source" value={`${SOURCE_LABEL[record.source]}${record.sourceDetail ? ` · ${record.sourceDetail}` : ''}`} />
          <InfoRow icon={<CalendarDays size={15} color={Colors.textTertiary} />} label="Last contact date" value={formatDate(record.lastContactDate)} />
          <InfoRow
            icon={<CalendarClock size={15} color={Colors.textTertiary} />}
            label="Next follow-up date"
            value={nextFollowUp.inferred ? `${nextFollowUp.value} (suggested)` : nextFollowUp.value}
          />
        </View>
      </Section>

      <Section icon={<FileText size={16} color={Colors.primary} />} title="Notes">
        {record.notes ? (
          <Text style={styles.notesText}>{record.notes}</Text>
        ) : (
          <Text style={styles.emptyInline}>No notes yet. Add context in the CRM editor.</Text>
        )}
      </Section>

      <Section icon={<Clock size={16} color={Colors.primary} />} title="Activity timeline">
        <View style={styles.timeline}>
          {timeline.map((a, idx) => (
            <View key={a.key} style={styles.timelineRow}>
              <View style={styles.timelineRail}>
                <View style={[styles.timelineDot, { backgroundColor: a.tone }]} />
                {idx < timeline.length - 1 ? <View style={styles.timelineLine} /> : null}
              </View>
              <View style={styles.timelineBody}>
                <Text style={styles.timelineLabel}>{a.label}</Text>
                <Text style={styles.timelineDate}>{formatDateTime(a.date)}</Text>
              </View>
            </View>
          ))}
        </View>
      </Section>

      <Section icon={<Target size={16} color={Colors.primary} />} title={`Related opportunities${relatedOpportunities.length ? ` (${relatedOpportunities.length})` : ''}`}>
        {matchingQuery.isLoading ? (
          <ShimmerIndicator size="small" color={Colors.primary} />
        ) : relatedOpportunities.length === 0 ? (
          <Text style={styles.emptyInline}>No matched deals yet. Matches appear when this contact fits an active IVX deal.</Text>
        ) : (
          <View style={styles.relatedList}>
            {relatedOpportunities.map((o) => (
              <View key={`${o.dealId}-${o.role}`} style={styles.relatedCard}>
                <View style={styles.relatedTop}>
                  <Text style={styles.relatedName} numberOfLines={1}>{o.dealName}</Text>
                  <View style={styles.matchScorePill}><Text style={styles.matchScoreText}>{`${o.score}% fit`}</Text></View>
                </View>
                <Text style={styles.relatedMeta}>{`${o.role.charAt(0).toUpperCase()}${o.role.slice(1)}${o.location ? ` · ${o.location}` : ''}`}</Text>
              </View>
            ))}
          </View>
        )}
      </Section>

      <Section icon={<FileText size={16} color={Colors.primary} />} title="Documents">
        <View style={styles.docsEmpty}>
          <FileText size={22} color={Colors.textTertiary} />
          <Text style={styles.emptyInline}>No documents attached yet. Signed agreements, term sheets, and KYC files will appear here.</Text>
        </View>
      </Section>
    </ScrollView>
  );
}

export default function ContactProfileScreen() {
  // Realtime: invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : Array.isArray(params.id) ? params.id[0] ?? '' : '';
  return (
    <ErrorBoundary>
      <Stack.Screen options={{ title: 'Contact Profile' }} />
      <ContactProfileContent id={id} />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, gap: 14 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32, backgroundColor: Colors.background },
  hero: { backgroundColor: Colors.card, borderRadius: 20, padding: 20, alignItems: 'center', gap: 10, borderWidth: 1, borderColor: Colors.border },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.surfaceLight, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 26, fontWeight: '800' as const, color: Colors.primary },
  heroName: { fontSize: 21, fontWeight: '800' as const, color: Colors.text, textAlign: 'center' },
  heroCompany: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center' },
  heroPills: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 7, marginTop: 4 },
  statusPill: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, borderWidth: 1.5 },
  statusPillText: { fontSize: 11.5, fontWeight: '700' as const },
  accreditedChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(34,197,94,0.12)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  accreditedText: { fontSize: 11, fontWeight: '700' as const, color: Colors.success },
  scoreChip: { backgroundColor: Colors.surfaceLight, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  scoreChipText: { fontSize: 11, fontWeight: '600' as const, color: Colors.text },
  quickActions: { flexDirection: 'row', gap: 10, marginTop: 8, alignSelf: 'stretch' },
  quickBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: Colors.primary, paddingVertical: 12, borderRadius: 12 },
  quickBtnDisabled: { backgroundColor: Colors.surface },
  quickBtnText: { fontSize: 14, fontWeight: '700' as const, color: Colors.black },
  quickBtnTextDisabled: { color: Colors.textTertiary },
  quickBtnAlt: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: Colors.surface, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: Colors.border },
  quickBtnAltDisabled: { opacity: 0.6 },
  quickBtnAltText: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  section: { backgroundColor: Colors.card, borderRadius: 18, padding: 16, gap: 12, borderWidth: 1, borderColor: Colors.border },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  infoList: { gap: 12 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  infoIcon: { width: 30, height: 30, borderRadius: 9, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center' },
  infoTextBlock: { flex: 1, gap: 1 },
  infoLabel: { fontSize: 11, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.4 },
  infoValue: { fontSize: 14, color: Colors.text, fontWeight: '500' as const },
  infoValueLink: { color: Colors.primary },
  prefBlock: { gap: 7 },
  prefLabel: { fontSize: 11, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.4 },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { backgroundColor: Colors.surface, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: Colors.border },
  tagAlt: { backgroundColor: Colors.backgroundTertiary },
  tagText: { fontSize: 12, color: Colors.textSecondary },
  emptyInline: { fontSize: 12.5, color: Colors.textTertiary, lineHeight: 18, flex: 1 },
  notesText: { fontSize: 13.5, lineHeight: 20, color: Colors.textSecondary },
  timeline: { gap: 0 },
  timelineRow: { flexDirection: 'row', gap: 12 },
  timelineRail: { alignItems: 'center', width: 14 },
  timelineDot: { width: 12, height: 12, borderRadius: 6, marginTop: 3 },
  timelineLine: { flex: 1, width: 2, backgroundColor: Colors.border, marginVertical: 3 },
  timelineBody: { flex: 1, paddingBottom: 16, gap: 2 },
  timelineLabel: { fontSize: 13.5, fontWeight: '600' as const, color: Colors.text },
  timelineDate: { fontSize: 11.5, color: Colors.textTertiary },
  relatedList: { gap: 10 },
  relatedCard: { backgroundColor: Colors.surface, borderRadius: 12, padding: 13, gap: 5, borderWidth: 1, borderColor: Colors.border },
  relatedTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  relatedName: { flex: 1, fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  matchScorePill: { backgroundColor: 'rgba(99,102,241,0.14)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  matchScoreText: { fontSize: 11, fontWeight: '700' as const, color: Colors.primary },
  relatedMeta: { fontSize: 12, color: Colors.textSecondary },
  docsEmpty: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  emptyTitle: { fontSize: 16, fontWeight: '700' as const, color: Colors.text },
  emptyBody: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', lineHeight: 19 }});
