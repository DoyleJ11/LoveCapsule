import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme, View, Text, Button, StyleSheet } from 'react-native';
import { signOut } from '../src/lib/auth';
import { configurationError } from '../src/lib/supabase';
import 'react-native-reanimated';
import { AuthProvider, useAuth } from '../src/providers/AuthProvider';
import { NotificationProvider } from '../src/providers/NotificationProvider';
import { CoupleProvider } from '../src/providers/CoupleProvider';

import { Colors } from '../src/constants/theme';

export { ErrorBoundary } from 'expo-router';

SplashScreen.preventAutoHideAsync();

function useProtectedRoute() {
  const { session, loading, error } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading || error) return;

    if (segments[0] === 'auth') return;
    const inAuthGroup = segments[0] === '(auth)';

    if (!session && !inAuthGroup) {
      router.replace('/(auth)/sign-in');
    } else if (session && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [session, loading, error, segments, router]);
}

function RootLayoutNav() {
  const { loading, error, refreshProfile, recovery } = useAuth();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  useProtectedRoute();
  const router = useRouter();
  useEffect(() => {
    if (recovery && !loading && !error) router.replace('/auth/reset-password');
  }, [recovery, router, loading, error]);

  useEffect(() => {
    if (!loading) {
      SplashScreen.hideAsync();
    }
  }, [loading]);

  if (configurationError || error)
    return (
      <View style={styles.error}>
        <Text>{configurationError || error}</Text>
        {!configurationError && (
          <View>
            <Button title="Retry account" onPress={() => void refreshProfile()} />
            <Button title="Sign out" onPress={() => void signOut().catch(() => {})} />
          </View>
        )}
      </View>
    );
  if (loading) return null;

  return (
    <>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="+not-found" />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  useEffect(() => {
    if (configurationError) void SplashScreen.hideAsync();
  }, []);
  if (configurationError)
    return (
      <View style={styles.error}>
        <Text>{configurationError}</Text>
      </View>
    );
  return (
    <KeyboardProvider>
      <AuthProvider>
        <CoupleProvider>
          <NotificationProvider />
          <RootLayoutNav />
        </CoupleProvider>
      </AuthProvider>
    </KeyboardProvider>
  );
}

const styles = StyleSheet.create({ error: { padding: 24 } });
