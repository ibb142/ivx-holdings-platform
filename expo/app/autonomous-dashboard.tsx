import React from 'react';
import { View } from 'react-native';
import AutonomousDashboardControlStrip from '@/components/AutonomousDashboardControlStrip';
import LandingWorkersLiveScreen from './ivx/landing-workers-live';

export default function AutonomousDashboardScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: '#05070A' }}>
      <AutonomousDashboardControlStrip />
      <View style={{ flex: 1 }}>
        <LandingWorkersLiveScreen />
      </View>
    </View>
  );
}
