import { Stack } from 'expo-router';
import Colors from '@/constants/colors';

// IVX Crash Shield: route-level error boundary for the Home segment.
export { ErrorBoundary } from 'expo-router';

const HOME_STACK_SCREEN_OPTIONS = {
  headerStyle: {
    backgroundColor: Colors.background},
  headerTintColor: Colors.text,
  headerTitleStyle: {
    fontWeight: '700' as const},
  contentStyle: {
    backgroundColor: Colors.background},
  headerShadowVisible: false} as const;

const HOME_INDEX_OPTIONS = {
  headerShown: false} as const;

// Expo Router v6 renamed `initialRouteName` to `anchor`. Both are declared so
// the anchor resolves correctly on v6 and stays correct if the app is ever
// pinned back to a v5 router. Without a honoured anchor AND without an index
// route, this group resolved to no screen at all — a silent black screen.
export const unstable_settings = {
  anchor: 'home',
  initialRouteName: 'home'} as const;

export default function HomeLayout() {
  return (
    <Stack screenOptions={HOME_STACK_SCREEN_OPTIONS}>
      <Stack.Screen name="home" options={HOME_INDEX_OPTIONS} />
    </Stack>
  );
}
