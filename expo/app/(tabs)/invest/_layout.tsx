import { Stack } from 'expo-router';
import Colors from '@/constants/colors';

// IVX Crash Shield: route-level error boundary for the Invest segment.
export { ErrorBoundary } from 'expo-router';

export default function InvestLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: {
          backgroundColor: Colors.background},
        headerTintColor: Colors.text,
        headerTitleStyle: {
          fontWeight: '600' as const},
        contentStyle: {
          backgroundColor: Colors.background}}}
    >
      <Stack.Screen
        name="index"
        options={{
          title: 'Invest',
          headerShown: true}}
      />

      <Stack.Screen
        name="submit-property"
        options={{
          title: 'Submit Property',
          presentation: 'modal'}}
      />
      <Stack.Screen
        name="land-partner"
        options={{
          title: 'Land Partnership',
          presentation: 'modal'}}
      />
      <Stack.Screen
        name="debt-acquisition"
        options={{
          title: 'Debt Acquisition',
          presentation: 'card'}}
      />
      <Stack.Screen
        name="profit-tools"
        options={{
          title: '10 Profit Tools',
          presentation: 'card'}}
      />
    </Stack>
  );
}
