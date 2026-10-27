import { useState, useCallback } from 'react';
import {
  View,
  Text,
  Button,
  ScrollView,
  SafeAreaView,
  ActivityIndicator,
  useColorScheme,
  RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useCouple } from '../../../src/providers/CoupleProvider';
import { useAuth } from '../../../src/providers/AuthProvider';
import { useReveal } from '../../../src/hooks/useReveal';
import { AdminRevealTools } from '../../../src/features/reveals/AdminRevealTools';
import { AnnualRecap } from '../../../src/features/reveals/AnnualRecap';
import { EntryReader } from '../../../src/features/reveals/EntryReader';
import { formatRevealInstant } from '../../../src/features/reveals/time';
import { Colors, Spacing } from '../../../src/constants/theme';
import type { AnnualEvent, Entry } from '../../../src/types/database';

type LibraryFlow = { kind: 'library'; event: AnnualEvent };
type Flow =
  | { kind: 'home' }
  | { kind: 'recap'; event: AnnualEvent }
  | LibraryFlow
  | { kind: 'reader'; entry: Entry; back: LibraryFlow | { kind: 'home' } }
  | { kind: 'empty' };

export default function RevealScreen() {
  const { user } = useAuth();
  const { couple, loading, error, refresh } = useCouple();
  if (!couple)
    return (
      <SafeAreaView>
        <Text>
          {error ||
            (loading
              ? 'Loading your capsule…'
              : 'Pair with your partner in Settings to share your capsule.')}
        </Text>
        <Button title="Retry" onPress={() => void refresh()} />
      </SafeAreaView>
    );
  // Unmount selected memories, signed URLs and in-flight actions on scope change.
  return <RevealExperience key={`${user?.id}:${couple.id}`} coupleId={couple.id} />;
}
export function RevealExperience({ coupleId }: { coupleId: string }) {
  const { user } = useAuth();
  const { overview, partner, refreshing, error: statusError, refresh, serverNow } = useCouple();
  const action = useReveal(coupleId);
  const { cancel } = action;
  const [flow, setFlow] = useState<Flow>({ kind: 'home' });
  const [libraryMore, setLibraryMore] = useState(true);
  const [allAuthors, setAllAuthors] = useState(false);
  const colors = Colors[useColorScheme() ?? 'light'];
  useFocusEffect(
    useCallback(() => {
      void refresh();
      return () => {
        cancel();
        setFlow({ kind: 'home' });
      };
    }, [refresh, cancel])
  );
  const annual = async (year: number, open: boolean) => {
    const event = await action.annual(year, open);
    if (!event) return;
    setLibraryMore(event.entries.length === 50);
    setAllAuthors(false);
    setFlow({ kind: 'recap', event });
    void refresh();
  };
  const checkpoint = async (id: string) => {
    const result = await action.checkpoint(id);
    if (!result) return;
    setFlow(
      result.entry
        ? { kind: 'reader', entry: result.entry, back: { kind: 'home' } }
        : { kind: 'empty' }
    );
    void refresh();
  };
  const partnerName = partner?.display_name || 'your partner';
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      {flow.kind !== 'home' && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Button title="Close capsule" onPress={() => setFlow({ kind: 'home' })} />
          {flow.kind === 'reader' && <Button title="Back" onPress={() => setFlow(flow.back)} />}
          {flow.kind === 'recap' && (
            <Button
              title="Skip to notes"
              onPress={() => setFlow({ kind: 'library', event: flow.event })}
            />
          )}
          {flow.kind === 'library' && (
            <Button
              title="Replay recap"
              onPress={() => setFlow({ kind: 'recap', event: flow.event })}
            />
          )}
        </View>
      )}
      {action.error && (
        <Text accessibilityRole="alert" style={{ color: colors.error, padding: Spacing.md }}>
          {action.error}
        </Text>
      )}
      {action.loading && <ActivityIndicator accessibilityLabel="Opening capsule" />}
      {flow.kind === 'reader' ? (
        <EntryReader key={flow.entry.id} entry={flow.entry} />
      ) : flow.kind === 'empty' ? (
        <View style={{ padding: Spacing.lg }}>
          <Text style={{ color: colors.text }}>
            No sealed notes were available for this reveal. This result is saved, so retrying will
            not use another note.
          </Text>
        </View>
      ) : flow.kind === 'recap' ? (
        <AnnualRecap
          key={flow.event.id}
          stats={flow.event.stats_snapshot}
          partnerName={partnerName}
          onRead={() => setFlow({ kind: 'library', event: flow.event })}
        />
      ) : flow.kind === 'library' ? (
        <ScrollView contentContainerStyle={{ padding: Spacing.lg }}>
          <Text style={{ fontSize: 24, color: colors.text }}>{flow.event.reveal_year} capsule</Text>
          <Text style={{ color: colors.textSecondary }}>
            Notes saved in this anniversary cycle. Notes show their current text and attachments;
            the recap preserves the opening snapshot.
          </Text>
          <Button
            title={allAuthors ? `Show ${partnerName}'s notes` : 'Show both partners’ notes'}
            onPress={() => setAllAuthors((value) => !value)}
          />
          {flow.event.entries.filter((entry) => allAuthors || entry.author_id !== user?.id)
            .length === 0 && (
            <Text style={{ color: colors.text }}>No notes to show in this capsule.</Text>
          )}
          {flow.event.entries
            .filter((entry) => allAuthors || entry.author_id !== user?.id)
            .map((entry) => (
              <View key={entry.id} style={{ marginVertical: Spacing.sm }}>
                <Button
                  title={`${entry.title || 'Untitled note'} · ${entry.entry_date}`}
                  onPress={async () => {
                    const full = await action.legacyEntry(entry.id);
                    if (full) setFlow({ kind: 'reader', entry: full, back: flow });
                  }}
                />
              </View>
            ))}
          {libraryMore && (
            <Button
              title="Load more capsule notes"
              disabled={action.loading}
              onPress={async () => {
                const last = flow.event.entries.at(-1);
                const rows = await action.moreAnnual(
                  flow.event.reveal_year,
                  last?.entry_date,
                  last?.id
                );
                if (rows) {
                  setLibraryMore(rows.length === 50);
                  setFlow({
                    ...flow,
                    event: {
                      ...flow.event,
                      entries: [
                        ...flow.event.entries,
                        ...rows.filter(
                          (row) => !flow.event.entries.some((old) => old.id === row.id)
                        ),
                      ],
                    },
                  });
                }
              }}
            />
          )}
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: Spacing.lg, gap: Spacing.lg }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />
          }
        >
          <Text style={{ fontSize: 30, fontWeight: '700', color: colors.text }}>
            Your LoveCapsule
          </Text>
          {statusError && (
            <>
              <Text accessibilityRole="alert" style={{ color: colors.error }}>
                {statusError}
              </Text>
              <Button title="Retry reveal status" onPress={() => void refresh()} />
            </>
          )}
          {!overview && !statusError && (
            <ActivityIndicator accessibilityLabel="Checking reveal status" />
          )}
          {overview && (
            <>
              {overview.annual ? (
                <View>
                  <Text style={{ fontSize: 22, color: colors.text }}>
                    {overview.annual.year} anniversary
                  </Text>
                  <Text style={{ color: colors.textSecondary }}>
                    {formatRevealInstant(overview.annual.ready_at, overview.annual.timezone)}
                  </Text>
                  <Text style={{ color: colors.textSecondary }}>
                    {overview.annual.is_ready
                      ? 'Ready whenever you are.'
                      : 'Your notes are safely sealed until then.'}
                  </Text>
                  <Button
                    title={action.loading ? 'Opening…' : 'Open anniversary capsule'}
                    disabled={action.loading || !overview.annual.is_ready}
                    onPress={() => void annual(overview.annual!.year, true)}
                  />
                </View>
              ) : (
                <Text style={{ color: colors.text }}>
                  Set your anniversary date, time and timezone in Settings.
                </Text>
              )}
              <Text style={{ fontSize: 22, color: colors.text }}>Checkpoint reveals</Text>
              {overview.checkpoints.length === 0 && (
                <Text style={{ color: colors.textSecondary }}>
                  No pending checkpoints. Add a schedule in Settings.
                </Text>
              )}
              {overview.checkpoints.map((item) => {
                const ready = Date.parse(item.due_at) <= serverNow();
                return (
                  <View key={item.id}>
                    <Text style={{ color: colors.text }}>{item.label || 'A little peek'}</Text>
                    <Text style={{ color: colors.textSecondary }}>
                      {formatRevealInstant(item.due_at, item.timezone)}
                    </Text>
                    <Button
                      title={ready ? 'Reveal a note' : 'Sealed until this time'}
                      disabled={action.loading || !ready}
                      onPress={() => void checkpoint(item.id)}
                    />
                  </View>
                );
              })}
              <Text style={{ fontSize: 24, color: colors.text }}>Your reveal history</Text>
              {overview.annual_history.length + overview.checkpoint_history.length === 0 && (
                <Text style={{ color: colors.textSecondary }}>
                  Your opened memories will stay here.
                </Text>
              )}
              {overview.annual_history.map((event) => (
                <View key={event.id}>
                  <Button
                    title={`Revisit ${event.year} anniversary`}
                    disabled={action.loading}
                    onPress={() => void annual(event.year, false)}
                  />
                  <Text style={{ color: colors.textSecondary }}>
                    Opened {formatRevealInstant(event.opened_at, event.timezone)}
                    {event.legacy ? ' · legacy history' : ''}
                  </Text>
                </View>
              ))}
              {overview.checkpoint_history.map((event) => (
                <View key={event.id}>
                  <Button
                    title={event.label || 'Past checkpoint'}
                    disabled={action.loading || !event.entry_id}
                    onPress={async () => {
                      if (event.occurrence_id) await checkpoint(event.occurrence_id);
                      else if (event.entry_id) {
                        const entry = await action.legacyEntry(event.entry_id);
                        if (entry) setFlow({ kind: 'reader', entry, back: { kind: 'home' } });
                      }
                    }}
                  />
                  <Text style={{ color: colors.textSecondary }}>
                    {formatRevealInstant(event.opened_at, event.timezone)}
                    {!event.entry_id ? ' · No note available' : ''}
                  </Text>
                </View>
              ))}
            </>
          )}
          <AdminRevealTools />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
