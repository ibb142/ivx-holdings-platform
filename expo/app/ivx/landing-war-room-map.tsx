import { Stack } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Colors from '@/constants/colors';

const LANES = [
  { range:'001–008', title:'Conversion Funnel', priority:'P0', agents:'09 · 10 · 17 · 18 · 19 · 20 · 21 · 41', proof:'CTA → intake → backend/CRM → attribution/idempotency' },
  { range:'009–016', title:'Advertising Analytics', priority:'P1', agents:'13 · 14 · 15 · 16 · 40 · 41 · 42 · 43', proof:'Consent-gated pixels + sanitized analytics + CRM attribution' },
  { range:'017–024', title:'SEO / Social', priority:'P1', agents:'15 · 16 · 34 · 35 · 41 · 43 · 61 · 103', proof:'Live meta/schema/social HTTP + corrected source' },
  { range:'025–032', title:'Performance / CWV', priority:'P1', agents:'68 · 69 · 71 · 72 · 76 · 80 · 86 · 91', proof:'Measured LCP/CLS/INP + asset/cache regression evidence' },
  { range:'033–040', title:'Mobile / Accessibility', priority:'P1', agents:'66 · 67 · 68 · 78 · 79 · 80 · 87 · 88', proof:'Viewport/device + keyboard/focus/a11y + source fixes' },
  { range:'041–048', title:'Security / Privacy', priority:'P0', agents:'08 · 11 · 73 · 74 · 89 · 96 · 100 · 110', proof:'CSP · secrets · RLS · XSS · CSRF · storage · error paths' },
  { range:'049–056', title:'Legal / Disclosures', priority:'P1', agents:'08 · 12 · 31 · 44 · 52 · 61 · 96 · 108', proof:'Claim inventory + disclosure/source verification' },
  { range:'057–064', title:'Trust / Credibility', priority:'P1', agents:'09 · 16 · 18 · 41 · 43 · 61 · 92 · 103', proof:'Claim-to-source matrix + unsupported-claim removal' },
  { range:'065–072', title:'Deals / Data / APIs', priority:'P0', agents:'03 · 05 · 22 · 28 · 31 · 41 · 45 · 69', proof:'Live data/API + fallback + sanitize + privacy + retry' },
  { range:'073–080', title:'Chat / Support', priority:'P1', agents:'10 · 40 · 72 · 74 · 77 · 80 · 86 · 87', proof:'Production chat trace + sanitize + fallback + privacy' },
  { range:'081–088', title:'Lead / CRM / Comms', priority:'P0', agents:'17 · 18 · 19 · 20 · 21 · 27 · 41 · 76', proof:'CRM IDs + consent + attribution + dedup + truthful status' },
  { range:'089–096', title:'Android / Distribution', priority:'P1', agents:'67 · 68 · 73 · 78 · 79 · 87 · 88 · 90', proof:'Version + package + signed APK SHA-256 + URL/QR parity' },
  { range:'097–104', title:'AWS / Deploy / CDN', priority:'P0', agents:'10 · 40 · 69 · 71 · 73 · 86 · 90 · 91', proof:'S3/CloudFront/HTTPS/cache + exact release SHA parity' },
  { range:'105–112', title:'Adversarial Release QA', priority:'GATE', agents:'11 · 41 · 73 · 87 · 88 · 89 · 91 · 112', proof:'Slow network + retry + abuse + observability + red-team; IA-11 GO gate' },
] as const;

export default function LandingWarRoomMap() {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title:'Landing War Room Map' }} />
      <Text style={styles.title}>IVX Landing • 112-Agent 2D Work Map</Text>
      <Text style={styles.subtitle}>Role-aligned routing. Item number is not agent number. P0 lanes execute first; IA-11 refuses GO while P0/P1 evidence is missing.</Text>
      <View style={styles.flow}>
        <Text style={styles.flowText}>P0 CONVERSION / SECURITY / DATA / CRM / DEPLOY</Text>
        <Text style={styles.arrow}>↓</Text>
        <Text style={styles.flowText}>P1 ANALYTICS / PERFORMANCE / MOBILE / LEGAL / TRUST / CHAT / APK</Text>
        <Text style={styles.arrow}>↓</Text>
        <Text style={styles.flowText}>105–112 ADVERSARIAL QA → IA-11 RELEASE GATE</Text>
      </View>
      <View style={styles.grid}>
        {LANES.map((lane) => (
          <View key={lane.range} style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.range}>{lane.range}</Text>
              <Text style={styles.priority}>{lane.priority}</Text>
            </View>
            <Text style={styles.laneTitle}>{lane.title}</Text>
            <Text style={styles.label}>Assigned IAs</Text>
            <Text style={styles.value}>{lane.agents}</Text>
            <Text style={styles.label}>Required proof</Text>
            <Text style={styles.value}>{lane.proof}</Text>
          </View>
        ))}
      </View>
      <View style={styles.rule}>
        <Text style={styles.ruleTitle}>CERTIFICATION RULE</Text>
        <Text style={styles.ruleText}>Every item requires item ID, assigned agents, timestamps, source/tool, artifact/route, evidence hash or commit/deploy when applicable, PASS/FAIL/BLOCKED, blocker, and remediation commit. Generic research cannot certify engineering/deployment work.</Text>
      </View>
    </ScrollView>
  );
}

const styles=StyleSheet.create({
  screen:{flex:1,backgroundColor:Colors.background},content:{padding:14,paddingBottom:42},
  title:{fontSize:22,fontWeight:'900',color:Colors.text,marginBottom:6},subtitle:{fontSize:12,color:Colors.textSecondary,lineHeight:18,marginBottom:12},
  flow:{backgroundColor:Colors.surface,borderWidth:1,borderColor:Colors.border,borderRadius:14,padding:12,alignItems:'center',marginBottom:12},
  flowText:{fontSize:11,fontWeight:'800',color:Colors.primary,textAlign:'center'},arrow:{fontSize:18,color:Colors.textSecondary,marginVertical:3},
  grid:{flexDirection:'row',flexWrap:'wrap',gap:10},card:{width:'48.5%',minWidth:160,backgroundColor:Colors.surface,borderWidth:1,borderColor:Colors.border,borderRadius:14,padding:11,gap:5},
  cardHead:{flexDirection:'row',justifyContent:'space-between'},range:{fontSize:12,fontWeight:'900',color:Colors.primary},priority:{fontSize:10,fontWeight:'900',color:Colors.warning},
  laneTitle:{fontSize:13,fontWeight:'800',color:Colors.text,marginBottom:3},label:{fontSize:9,fontWeight:'800',color:Colors.textTertiary,textTransform:'uppercase'},value:{fontSize:10.5,color:Colors.textSecondary,lineHeight:15},
  rule:{marginTop:12,backgroundColor:Colors.surface,borderWidth:1,borderColor:Colors.border,borderRadius:14,padding:12},ruleTitle:{fontSize:11,fontWeight:'900',color:Colors.success,marginBottom:5},ruleText:{fontSize:11,color:Colors.textSecondary,lineHeight:17},
});
