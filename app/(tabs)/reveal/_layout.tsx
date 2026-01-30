import { Stack } from 'expo-router';
import { useColorScheme } from 'react-native';
import { Colors } from '../../../src/constants/theme';

export default function RevealLayout() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'TimeCapsule Reveal', headerShown: false }} />
    </Stack>
  );
}
