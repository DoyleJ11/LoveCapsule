import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../../src/components/Button';
import { useCallback, useState } from 'react';
import { View, Text, Alert, StyleSheet, useColorScheme } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../../src/providers/AuthProvider';
import { useCouple } from '../../../src/providers/CoupleProvider';
import { EntryReader } from '../../../src/features/reveals/EntryReader';
import { loadOwnEntry } from '../../../src/features/entries/api';
import { requestDeletion } from '../../../src/features/account/deletion';
import { entryEvents } from '../../../src/lib/entryEvents';
import { errorMessage } from '../../../src/lib/errors';
import { Colors } from '../../../src/constants/theme';
import type { Entry } from '../../../src/types/database';
export default function EntryDetailScreen() {
  const { user } = useAuth(),
    { couple } = useCouple();
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Detail key={`${user?.id}:${couple?.id}:${id}`} />;
}
function Detail() {
  const { id } = useLocalSearchParams<{ id: string }>(),
    { user } = useAuth(),
    { couple } = useCouple(),
    router = useRouter();
  const colors = Colors[useColorScheme() ?? 'light'];
  const [entry, setEntry] = useState<Entry | null>(null),
    [error, setError] = useState<string | null>(null),
    [retry, setRetry] = useState(0),
    [busy, setBusy] = useState(false);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (user && couple)
        void loadOwnEntry(id, user.id, couple.id)
          .then((r) => {
            if (active) {
              setEntry(r);
              setError(null);
            }
          })
          .catch((e) => {
            if (active) setError(errorMessage(e));
          });
      return () => {
        active = false;
      };
    }, [id, user, couple, retry])
  );
  if (!couple)
    return (
      <View>
        <Text>This diary is no longer paired.</Text>
        <Button title="Back" onPress={() => router.back()} />
      </View>
    );
  return (
    <SafeAreaView
      edges={['left', 'right']}
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      <View style={styles.controls}>
        <Button
          variant="primary"
          style={styles.editAction}
          title={entry?.is_draft ? 'Edit draft' : 'Edit note'}
          disabled={!entry || busy}
          onPress={() => router.push({ pathname: '/(tabs)/entries/new', params: { entryId: id } })}
        />
        <Button
          title="Delete note"
          variant="destructive"
          icon="trash"
          disabled={!entry || busy}
          onPress={() =>
            Alert.alert(
              'Delete note?',
              'This removes the note. Its private files will be securely cleaned up in the background.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: async () => {
                    setBusy(true);
                    try {
                      await requestDeletion('entry', id);
                      entryEvents.emit();
                      router.back();
                    } catch (e) {
                      setError(errorMessage(e));
                    } finally {
                      setBusy(false);
                    }
                  },
                },
              ]
            )
          }
        />
      </View>
      {error && (
        <View style={styles.message}>
          <Text accessibilityRole="alert" style={{ color: colors.error }}>
            {error}
          </Text>
          <Button title="Retry note" onPress={() => setRetry((v) => v + 1)} />
        </View>
      )}
      {entry?.is_draft && (
        <Text style={[styles.message, { color: colors.textSecondary }]}>
          Draft · visible only to you
        </Text>
      )}
      {entry ? (
        <EntryReader key={`${entry.id}:${entry.updated_at}`} entry={entry} />
      ) : (
        !error && <Text style={[styles.message, { color: colors.text }]}>Loading note…</Text>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  controls: { flexDirection: 'row', gap: 12, padding: 16, flexWrap: 'wrap' },
  editAction: { flexGrow: 1 },
  message: { paddingHorizontal: 16 },
});
