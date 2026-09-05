import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Activity, Bot, ClipboardList, Gauge, MessageCircle, RadioTower, Settings2 } from 'lucide-react-native';

export const AUTONOMOUS_CONTROL_ROUTES = [
  { label: 'IVX IA', route: '/ivx/chat', icon: MessageCircle },
  { label: 'Command', route: '/ivx/agent-command-center', icon: Bot },
  { label: 'Control', route: '/ivx/autonomous-control', icon: Settings2 },
  { label: 'Live', route: '/ivx/autonomous-live', icon: RadioTower },
  { label: 'Ops', route: '/ivx/autonomous-ops', icon: Activity },
  { label: 'Ledger', route: '/ivx/agent-ledger', icon: ClipboardList },
  { label: 'Diagnostics', route: '/ivx/auth-diagnostics', icon: Gauge },
] as const;

export default function AutonomousDashboardControlStrip() {
  const router = useRouter();

  return (
    <View style={styles.shell} testID="autonomous-dashboard-control-strip">
      <View style={styles.titleRow}>
        <Text style={styles.title}>OWNER CONTROL MODULES</Text>
        <Text style={styles.count}>{AUTONOMOUS_CONTROL_ROUTES.length} ONLINE ROUTES</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {AUTONOMOUS_CONTROL_ROUTES.map(({ label, route, icon: Icon }) => (
          <TouchableOpacity
            key={route}
            testID={`autonomous-control-${label.toLowerCase()}`}
            style={styles.button}
            activeOpacity={0.75}
            onPress={() => router.push(route as never)}
          >
            <Icon size={16} color="#FBBF24" />
            <Text style={styles.buttonText}>{label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    backgroundColor: '#05070A',
    borderBottomWidth: 1,
    borderBottomColor: '#1F2937',
    paddingTop: 8,
    paddingBottom: 10,
  },
  titleRow: {
    paddingHorizontal: 14,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  title: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  count: {
    color: '#94A3B8',
    fontSize: 9,
    fontWeight: '700',
  },
  scroll: {
    paddingHorizontal: 10,
    gap: 8,
  },
  button: {
    minWidth: 82,
    height: 42,
    paddingHorizontal: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0F172A',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  buttonText: {
    color: '#E2E8F0',
    fontSize: 11,
    fontWeight: '800',
  },
});
