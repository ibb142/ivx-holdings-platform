import { Stack } from 'expo-router';
import Colors from '@/constants/colors';

const MEMBER_STACK_SCREEN_OPTIONS = {
  headerStyle: { backgroundColor: Colors.background },
  headerTintColor: Colors.text,
  headerShown: false} as const;

export default function MemberLayout() {
  return (
    <Stack screenOptions={MEMBER_STACK_SCREEN_OPTIONS}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[id]" />
    </Stack>
  );
}
