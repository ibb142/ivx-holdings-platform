import React from 'react';
import { Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

type HomeAction = { title: string; subtitle: string; accent: string; route: string; testID: string };

const HOME_ACTIONS: HomeAction[] = [
  { title: 'Buy Property Shares', subtitle: 'Fractional ownership in premium real estate', accent: '#E6C200', route: '/(tabs)/market', testID: 'home-buy-property-shares' },
  { title: 'JV Partnerships', subtitle: 'Review active joint-venture opportunities', accent: '#4C8DFF', route: '/(tabs)/invest', testID: 'home-jv-partnerships' },
  { title: 'Smart Investing', subtitle: 'Open the IVX investment assistant', accent: '#00C48C', route: '/(tabs)/chat', testID: 'home-smart-investing' },
  { title: 'Investor Dashboard', subtitle: 'Track performance and distributions', accent: '#FF9F43', route: '/(tabs)/portfolio', testID: 'home-investor-dashboard' },
];

/** Native-safe Home: never auto-start data, realtime, analytics, or media services. */
export default function HomeRoute() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safeArea} testID="owner-home-ready">
      <StatusBar barStyle="light-content" backgroundColor="#000000" />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.brand}>IVX HOLDINGS</Text>
          <Text style={styles.tagline}>Institutional Real Estate Investment</Text>
        </View>
        <View style={styles.readyBanner} testID="home-runtime-ready">
          <View style={styles.readyDot} />
          <View style={styles.readyCopy}>
            <Text style={styles.readyTitle}>Home ready</Text>
            <Text style={styles.readyText}>Choose a module to continue.</Text>
          </View>
        </View>
        <Text style={styles.sectionTitle}>Explore IVX</Text>
        <View style={styles.grid}>
          {HOME_ACTIONS.map((action) => (
            <Pressable
              key={action.testID}
              accessibilityRole="button"
              accessibilityLabel={action.title}
              testID={action.testID}
              onPress={() => router.push(action.route as never)}
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            >
              <View style={[styles.accent, { backgroundColor: action.accent }]} />
              <Text style={styles.cardTitle}>{action.title}</Text>
              <Text style={styles.cardSubtitle}>{action.subtitle}</Text>
              <Text style={[styles.open, { color: action.accent }]}>Open →</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.securityCard}>
          <Text style={styles.securityTitle}>Secure IVX workspace</Text>
          <Text style={styles.securityText}>Home remains isolated from realtime feeds and media players. Services start only inside their dedicated modules.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#000000' },
  scroll: { flex: 1, backgroundColor: '#000000' },
  content: { padding: 20, paddingBottom: 120 },
  header: { paddingTop: 12, paddingBottom: 22 },
  brand: { color: '#E6C200', fontSize: 23, fontWeight: '900', letterSpacing: 0.8 },
  tagline: { color: '#8A8A8A', fontSize: 12, marginTop: 4 },
  readyBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#101713', borderColor: '#1F6B45', borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 26 },
  readyDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#00C48C', marginRight: 12 },
  readyCopy: { flex: 1 },
  readyTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  readyText: { color: '#8FA89A', fontSize: 12, marginTop: 3 },
  sectionTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '800', marginBottom: 12 },
  grid: { gap: 12 },
  card: { minHeight: 128, backgroundColor: '#111111', borderColor: '#242424', borderWidth: 1, borderRadius: 18, padding: 17 },
  cardPressed: { opacity: 0.7 },
  accent: { width: 34, height: 4, borderRadius: 2, marginBottom: 14 },
  cardTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  cardSubtitle: { color: '#777777', fontSize: 12, lineHeight: 17, marginTop: 5, paddingRight: 20 },
  open: { fontSize: 12, fontWeight: '800', marginTop: 12 },
  securityCard: { backgroundColor: '#0B0B0B', borderColor: '#1D1D1D', borderWidth: 1, borderRadius: 16, padding: 17, marginTop: 20 },
  securityTitle: { color: '#E6C200', fontSize: 14, fontWeight: '800' },
  securityText: { color: '#777777', fontSize: 12, lineHeight: 18, marginTop: 7 },
});
