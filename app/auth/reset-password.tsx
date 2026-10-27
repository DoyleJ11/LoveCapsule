import { useState } from 'react';
import { View, Text, TextInput, Button, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/providers/AuthProvider';
import { supabase } from '../../src/lib/supabase';
import { errorMessage } from '../../src/lib/errors';
export default function ResetPassword() {
  const { user, finishRecovery } = useAuth(),
    router = useRouter();
  const [password, setPassword] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  return (
    <View style={styles.screen}>
      <Text>Choose a new password</Text>
      <TextInput
        accessibilityLabel="New password"
        secureTextEntry
        textContentType="newPassword"
        autoCapitalize="none"
        value={password}
        onChangeText={setPassword}
      />
      {error && <Text accessibilityRole="alert">{error}</Text>}
      <Button
        title={busy ? 'Saving…' : 'Save password'}
        disabled={busy || !user}
        onPress={async () => {
          if (password.length < 8) {
            setError('Use at least 8 characters.');
            return;
          }
          setBusy(true);
          try {
            const { error } = await supabase.auth.updateUser({ password });
            if (error) throw error;
            finishRecovery();
            router.replace('/(tabs)');
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      />
      <Button
        title="Return to sign in"
        onPress={() => {
          finishRecovery();
          router.replace('/(auth)/sign-in');
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({ screen: { padding: 24 } });
