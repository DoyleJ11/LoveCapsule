import { useEffect, useState } from 'react';
import { View, Text, Button, StyleSheet } from 'react-native';
import { useURL } from 'expo-linking';
import { useRouter } from 'expo-router';
import { acceptAuthLink } from '../../src/features/account/links';
import { errorMessage } from '../../src/lib/errors';
export default function AuthCallback() {
  const url = useURL(),
    router = useRouter();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (url)
      void acceptAuthLink(url)
        .then((result) => {
          if (active) router.replace(result === 'recovery' ? '/auth/reset-password' : '/(tabs)');
        })
        .catch((e) => {
          if (active) setError(errorMessage(e));
        });
    return () => {
      active = false;
    };
  }, [url, router]);
  return (
    <View style={styles.screen}>
      <Text>{error || 'Verifying your sign-in link…'}</Text>
      {error && (
        <Button title="Return to sign in" onPress={() => router.replace('/(auth)/sign-in')} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({ screen: { padding: 24 } });
