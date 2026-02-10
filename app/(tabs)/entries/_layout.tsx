import { Stack } from 'expo-router';
import { useColorScheme } from 'react-native';
import { Colors } from '../../../src/constants/theme';

export default function EntriesLayout() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'My Diary' }} />
      <Stack.Screen
        name="new"
        options={{
          title: 'New Entry',
          presentation: 'modal',
          gestureDirection: 'vertical',
        }}
      />
      <Stack.Screen name="[id]" options={{ title: 'Entry' }} />
    </Stack>
  );
}
