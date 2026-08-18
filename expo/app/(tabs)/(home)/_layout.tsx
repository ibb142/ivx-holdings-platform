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

export const unstable_settings = {
  initialRouteName: 'index'} as const;

export default function HomeLayout() {
  return (
    <Stack screenOptions={HOME_STACK_SCREEN_OPTIONS}>
      <Stack.Screen name="index" options={HOME_INDEX_OPTIONS} />
      <Stack.Screen name="home" options={HOME_INDEX_OPTIONS} />
    </Stack>
  );
}
