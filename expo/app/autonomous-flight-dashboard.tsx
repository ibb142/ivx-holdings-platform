import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { ArrowLeft, RefreshCw, ShieldCheck } from 'lucide-react-native';
import { getIVXAccessToken } from '@/lib/ivx-supabase-client';
import { AutonomousFlightMeter } from '@/components/AutonomousFlightMeter';

const API_BASE = (process.env.EXPO_PUBLIC_IVX_API_BASE_URL || 'https://api.ivxholding.com').replace(/\/+$/, '');
const STATUS_URL = `${API_BASE}/api/ivx/engineering-os/status`;
const POLL_INTERVAL_MS = 15_000;

type Counts = { total:number; queued:number; running:number; waitingApproval:number; retrying:number; verified:number; failed:number; blocked:number };
type Status = { status:string; marker?:string; counts?:Counts; activation?:{active:boolean;activeTeams:number;totalTeams:number} };

export default function AutonomousFlightDashboardScreen() {
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const token = await getIVXAccessToken();
      if (!token) throw new Error('Owner session required.');
      const response = await fetch(STATUS_URL, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error(`Autonomous telemetry HTTP ${response.status}`);
      setStatus((await response.json()) as Status);
      setLastFetchedAt(new Date().toISOString());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load Autonomous telemetry.');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    timer.current = setInterval(load, POLL_INTERVAL_MS);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [load]);

  const counts = status?.counts;
  const total = counts?.total ?? 0;
  const verified = counts?.verified ?? 0;
  const rawPercent = total > 0 ? (verified / total) * 100 : 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top','bottom']}>
      <Stack.Screen options={{ headerShown:false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.button}><ArrowLeft size={22} color="#E2E8F0" /></TouchableOpacity>
        <View style={styles.headerCopy}><Text style={styles.headerTitle}>Autonomous Flight Deck</Text><Text style={styles.headerSub}>Live mission telemetry · auto-refresh 15s</Text></View>
        <TouchableOpacity onPress={() => { setRefreshing(true); load(); }} style={styles.button}><RefreshCw size={18} color="#FBBF24" /></TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor="#FBBF24" />}>
        <AutonomousFlightMeter percent={rawPercent} verified={verified} total={total} marker={status?.marker} lastFetchedAt={lastFetchedAt} />
        <View style={styles.card}>
          <View style={styles.cardTitleRow}><ShieldCheck size={16} color="#34D399" /><Text style={styles.cardTitle}>Flight Readiness</Text></View>
          <Text style={styles.line}>Running: {counts?.running ?? 0} · Queued: {counts?.queued ?? 0} · Retrying: {counts?.retrying ?? 0}</Text>
          <Text style={styles.line}>Blocked: {counts?.blocked ?? 0} · Failed: {counts?.failed ?? 0} · Owner Gate: {counts?.waitingApproval ?? 0}</Text>
          <Text style={styles.line}>Teams: {status?.activation?.activeTeams ?? 0}/{status?.activation?.totalTeams ?? 0} active</Text>
          {error ? <Text style={styles.error}>RADAR WARNING · {error}</Text> : <Text style={styles.green}>RADAR LINK · LIVE</Text>}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:{flex:1,backgroundColor:'#050B14'},header:{flexDirection:'row',alignItems:'center',paddingHorizontal:12,paddingVertical:12,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:'#1E293B'},button:{padding:8},headerCopy:{flex:1},headerTitle:{color:'#F1F5F9',fontSize:18,fontWeight:'800'},headerSub:{color:'#64748B',fontSize:11,marginTop:2},content:{padding:16,gap:14,paddingBottom:40},card:{backgroundColor:'#08111F',borderRadius:16,padding:14,borderWidth:1,borderColor:'#233249'},cardTitleRow:{flexDirection:'row',alignItems:'center',gap:8,marginBottom:10},cardTitle:{color:'#E2E8F0',fontSize:15,fontWeight:'800'},line:{color:'#94A3B8',fontSize:12,lineHeight:20},green:{color:'#34D399',fontSize:11,fontWeight:'800',marginTop:10},error:{color:'#F87171',fontSize:11,fontWeight:'800',marginTop:10}
});
