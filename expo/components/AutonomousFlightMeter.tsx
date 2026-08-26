import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';

const SEGMENT_COLORS = ['#7F1D1D','#991B1B','#C2410C','#EA580C','#D97706','#CA8A04','#65A30D','#16A34A','#059669','#10B981'];

type Props = { percent: number; verified: number; total: number; marker?: string | null; lastFetchedAt?: string | null };

function clampToTen(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.max(0, Math.min(100, Math.round(percent / 10) * 10));
}

export function AutonomousFlightMeter({ percent, verified, total, marker, lastFetchedAt }: Props) {
  const displayedPercent = clampToTen(percent);
  const activeSegments = displayedPercent / 10;
  const timestamp = useMemo(() => {
    if (!lastFetchedAt) return 'WAITING';
    const date = new Date(lastFetchedAt);
    return Number.isNaN(date.getTime()) ? 'LIVE' : `${date.toISOString().slice(11, 19)}Z`;
  }, [lastFetchedAt]);

  return (
    <View style={styles.panel} testID="autonomous-flight-meter">
      <View style={styles.topRow}>
        <View style={styles.titleWrap}>
          <Text style={styles.eyebrow}>AUTONOMOUS FLIGHT COMPUTER</Text>
          <Text style={styles.title}>Mission Completion</Text>
        </View>
        <View style={styles.percentBox}>
          <Text style={styles.percent}>{displayedPercent}%</Text>
          <Text style={styles.percentCaption}>TO 100%</Text>
        </View>
      </View>
      <View style={styles.segmentRow} accessibilityLabel={`Autonomous completion ${displayedPercent} percent`}>
        {SEGMENT_COLORS.map((color, index) => {
          const threshold = (index + 1) * 10;
          const active = index < activeSegments;
          return (
            <View key={threshold} style={styles.segmentWrap}>
              <View style={[styles.segment, { backgroundColor: active ? color : '#182235', borderColor: active ? color : '#334155' }]} />
              <Text style={[styles.segmentLabel, active && { color }]}>{threshold}</Text>
            </View>
          );
        })}
      </View>
      <View style={styles.instrumentRow}>
        <View style={styles.instrumentCell}><Text style={styles.instrumentValue}>{verified}/{total || 0}</Text><Text style={styles.instrumentLabel}>VERIFIED</Text></View>
        <View style={styles.divider} />
        <View style={styles.instrumentCell}><Text style={styles.instrumentValue} numberOfLines={1}>{marker || 'LIVE'}</Text><Text style={styles.instrumentLabel}>RUNTIME</Text></View>
        <View style={styles.divider} />
        <View style={styles.instrumentCell}><Text style={styles.instrumentValue}>{timestamp}</Text><Text style={styles.instrumentLabel}>TELEMETRY</Text></View>
      </View>
      <Text style={styles.note}>Evidence-driven · refreshes with Autonomous telemetry · advances in 10% flight stages · 100% requires 100% underlying completion evidence.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel:{backgroundColor:'#08111F',borderRadius:16,padding:14,borderWidth:1,borderColor:'#233249'},
  topRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12},
  titleWrap:{flex:1},eyebrow:{color:'#64748B',fontSize:10,fontWeight:'800',letterSpacing:1.2},title:{color:'#E2E8F0',fontSize:17,fontWeight:'800',marginTop:2},
  percentBox:{minWidth:82,alignItems:'center',backgroundColor:'#0F1A2B',borderRadius:12,borderWidth:1,borderColor:'#334155',paddingVertical:8,paddingHorizontal:10},
  percent:{color:'#F8FAFC',fontSize:25,fontWeight:'900'},percentCaption:{color:'#64748B',fontSize:9,fontWeight:'800',letterSpacing:1},
  segmentRow:{flexDirection:'row',gap:4,marginTop:16},segmentWrap:{flex:1,alignItems:'center',minWidth:0},segment:{width:'100%',height:18,borderRadius:4,borderWidth:1},segmentLabel:{color:'#475569',fontSize:8,fontWeight:'800',marginTop:4},
  instrumentRow:{flexDirection:'row',alignItems:'stretch',marginTop:14,paddingTop:12,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:'#233249'},instrumentCell:{flex:1,alignItems:'center',justifyContent:'center',minWidth:0,paddingHorizontal:4},divider:{width:StyleSheet.hairlineWidth,backgroundColor:'#334155'},instrumentValue:{color:'#CBD5E1',fontSize:10,fontWeight:'800',textAlign:'center'},instrumentLabel:{color:'#475569',fontSize:8,fontWeight:'700',marginTop:3,textAlign:'center'},note:{color:'#64748B',fontSize:10,lineHeight:15,marginTop:12}
});
