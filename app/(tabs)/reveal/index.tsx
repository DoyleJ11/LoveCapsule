import { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  useColorScheme,
  RefreshControl,
  StyleSheet,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import Animated, { FadeInDown, ReduceMotion } from 'react-native-reanimated';
import { useCouple } from '../../../src/providers/CoupleProvider';
import { useAuth } from '../../../src/providers/AuthProvider';
import { useReveal } from '../../../src/hooks/useReveal';
import { Button } from '../../../src/components/Button';
import { NoteCard } from '../../../src/components/NoteCard';
import { AdminRevealTools } from '../../../src/features/reveals/AdminRevealTools';
import { AnnualRecap } from '../../../src/features/reveals/AnnualRecap';
import { EntryReader } from '../../../src/features/reveals/EntryReader';
import {
  formatLocalRevealInstant,
  calendarDaysUntil,
  deviceTimezone,
} from '../../../src/features/reveals/time';
import { Colors, Spacing, FontSize, BorderRadius } from '../../../src/constants/theme';
import type { AnnualEvent, Entry } from '../../../src/types/database';

type LibraryFlow = { kind: 'library'; event: AnnualEvent };
type Flow =
  | { kind: 'home' }
  | { kind: 'recap'; event: AnnualEvent }
  | LibraryFlow
  | { kind: 'reader'; entry: Entry; back: LibraryFlow | { kind: 'home' } }
  | { kind: 'empty' };

function HistoryCard({
  title,
  subtitle,
  annual = false,
  disabled,
  onPress,
}: {
  title: string;
  subtitle: string;
  annual?: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.historyCard,
        { backgroundColor: colors.surface, borderColor: colors.border },
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.historyIcon, { backgroundColor: colors.primary + '18' }]}>
        <FontAwesome name={annual ? 'heart' : 'envelope-open-o'} size={20} color={colors.primary} />
      </View>
      <View style={styles.grow}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.meta, { color: colors.textSecondary }]}>{subtitle}</Text>
      </View>
      <FontAwesome name={disabled ? 'minus' : 'chevron-right'} size={12} color={colors.textMuted} />
    </Pressable>
  );
}

export default function RevealScreen() {
  const { user } = useAuth();
  const { couple, loading, error, refresh } = useCouple();
  const colors = Colors[useColorScheme() ?? 'light'];
  if (!couple)
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
        <View style={styles.empty}>
          <FontAwesome name="gift" size={52} color={colors.primary} />
          <Text style={[styles.title, { color: colors.text }]}>Your LoveCapsule</Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            {error ||
              (loading
                ? 'Loading your capsule…'
                : 'Pair with your partner in Settings to share your capsule.')}
          </Text>
          {loading ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Button title="Retry" onPress={() => void refresh()} />
          )}
        </View>
      </SafeAreaView>
    );
  return <RevealExperience key={user?.id + ':' + couple.id} coupleId={couple.id} />;
}

export function RevealExperience({ coupleId }: { coupleId: string }) {
  const { user } = useAuth();
  const { overview, partner, refreshing, error: statusError, refresh, serverNow } = useCouple();
  const action = useReveal(coupleId);
  const { cancel } = action;
  const [flow, setFlow] = useState<Flow>({ kind: 'home' });
  const [libraryMore, setLibraryMore] = useState(true);
  const [allAuthors, setAllAuthors] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [, tick] = useState(0);
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  useFocusEffect(
    useCallback(() => {
      void refresh();
      const timer = setInterval(() => tick((value) => value + 1), 1000);
      return () => {
        clearInterval(timer);
        cancel();
        setFlow({ kind: 'home' });
      };
    }, [refresh, cancel])
  );
  const annual = async (year: number, open: boolean) => {
    setOpening('annual');
    try {
      const event = await action.annual(year, open);
      if (!event) return;
      setLibraryMore(event.entries.length === 50);
      setAllAuthors(false);
      setFlow({ kind: 'recap', event });
      void refresh();
    } finally {
      setOpening(null);
    }
  };
  const checkpoint = async (id: string) => {
    setOpening(id);
    try {
      const result = await action.checkpoint(id);
      if (!result) return;
      setFlow(
        result.entry
          ? { kind: 'reader', entry: result.entry, back: { kind: 'home' } }
          : { kind: 'empty' }
      );
      void refresh();
    } finally {
      setOpening(null);
    }
  };
  const partnerName = partner?.display_name || 'your partner';
  const now = serverNow();
  const annualReady =
    !!overview?.annual && (overview.annual.is_ready || Date.parse(overview.annual.ready_at) <= now);
  const days = overview?.annual
    ? calendarDaysUntil(overview.annual.ready_at, deviceTimezone(), now)
    : 0;
  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      {flow.kind !== 'home' && (
        <View style={[styles.navigation, { borderBottomColor: colors.border }]}>
          <Button
            title="Close capsule"
            compact
            icon="times"
            onPress={() => setFlow({ kind: 'home' })}
          />
          {flow.kind === 'reader' && (
            <Button title="Back" compact icon="arrow-left" onPress={() => setFlow(flow.back)} />
          )}
          {flow.kind === 'recap' && (
            <Button
              title="Skip to notes"
              compact
              onPress={() => setFlow({ kind: 'library', event: flow.event })}
            />
          )}
          {flow.kind === 'library' && (
            <Button
              title="Replay recap"
              compact
              icon="refresh"
              onPress={() => setFlow({ kind: 'recap', event: flow.event })}
            />
          )}
        </View>
      )}
      {action.error && (
        <Text accessibilityRole="alert" style={[styles.error, { color: colors.error }]}>
          {action.error}
        </Text>
      )}
      {action.loading && flow.kind !== 'home' && (
        <ActivityIndicator accessibilityLabel="Opening capsule" color={colors.primary} />
      )}
      {flow.kind === 'reader' ? (
        <EntryReader key={flow.entry.id} entry={flow.entry} />
      ) : flow.kind === 'empty' ? (
        <View style={styles.empty}>
          <FontAwesome name="envelope-o" size={48} color={colors.primary} />
          <Text style={[styles.title, { color: colors.text }]}>A quiet little capsule</Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            No sealed notes were available for this reveal. This result is saved, so retrying will
            not use another note.
          </Text>
          <Button title="Back to your capsules" onPress={() => setFlow({ kind: 'home' })} />
        </View>
      ) : flow.kind === 'recap' ? (
        <AnnualRecap
          key={flow.event.id}
          stats={flow.event.stats_snapshot}
          partnerName={partnerName}
          onRead={() => setFlow({ kind: 'library', event: flow.event })}
        />
      ) : flow.kind === 'library' ? (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={[styles.title, { color: colors.text }]}>
            {flow.event.reveal_year} capsule
          </Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            A chapter of your story, ready to read again.
          </Text>
          <Button
            title={allAuthors ? 'Show ' + partnerName + "'s notes" : 'Show both partners’ notes'}
            icon="users"
            onPress={() => setAllAuthors((value) => !value)}
          />
          {flow.event.entries.filter((entry) => allAuthors || entry.author_id !== user?.id)
            .length === 0 && (
            <Text style={[styles.body, { color: colors.textSecondary }]}>
              No notes to show in this capsule.
            </Text>
          )}
          {flow.event.entries
            .filter((entry) => allAuthors || entry.author_id !== user?.id)
            .map((entry) => (
              <NoteCard
                key={entry.id}
                entry={entry}
                disabled={action.loading}
                onPress={() => {
                  void action.legacyEntry(entry.id).then((full) => {
                    if (full) setFlow({ kind: 'reader', entry: full, back: flow });
                  });
                }}
              />
            ))}
          {libraryMore && (
            <Button
              title="Load more capsule notes"
              loading={action.loading}
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
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={colors.primary}
              onRefresh={() => void refresh()}
            />
          }
        >
          <View style={styles.intro}>
            <Text
              style={[
                styles.eyebrow,
                { color: scheme === 'dark' ? colors.primary : colors.primaryAction },
              ]}
            >
              MEMORIES, KEPT WITH LOVE
            </Text>
            <Text style={[styles.title, { color: colors.text }]}>Your LoveCapsule</Text>
            <Text style={[styles.body, { color: colors.textSecondary }]}>
              Revisit the Little moments
            </Text>
          </View>
          {statusError && (
            <View style={styles.section}>
              <Text accessibilityRole="alert" style={{ color: colors.error }}>
                {statusError}
              </Text>
              <Button title="Retry reveal status" onPress={() => void refresh()} />
            </View>
          )}
          {!overview && !statusError && (
            <ActivityIndicator accessibilityLabel="Checking reveal status" color={colors.primary} />
          )}
          {overview && (
            <>
              <Animated.View
                entering={FadeInDown.duration(300).reduceMotion(ReduceMotion.System)}
                style={[
                  styles.hero,
                  { backgroundColor: colors.surface, borderColor: colors.primary + '60' },
                ]}
              >
                <View style={[styles.giftRing, { backgroundColor: colors.primary + '18' }]}>
                  <FontAwesome name="gift" size={56} color={colors.primary} />
                </View>
                <Text
                  style={[
                    styles.pill,
                    { backgroundColor: colors.primary + '18', color: colors.text },
                  ]}
                >
                  {overview.annual
                    ? annualReady
                      ? 'READY TO OPEN'
                      : 'SEALED WITH LOVE'
                    : 'YOUR NEXT CHAPTER'}
                </Text>
                <Text style={[styles.heroTitle, { color: colors.text }]}>
                  {overview.annual
                    ? overview.annual.year + ' anniversary'
                    : 'A day worth waiting for'}
                </Text>
                <Text style={[styles.heroCopy, { color: colors.textSecondary }]}>
                  {overview.annual
                    ? annualReady
                      ? 'Your memories are ready. Open a year of us.'
                      : days > 0
                        ? days + (days === 1 ? ' day' : ' days') + ' until your next chapter opens.'
                        : 'Your next chapter opens today.'
                    : 'Set your anniversary date, time and timezone in Settings.'}
                </Text>
                {overview.annual && (
                  <>
                    <Text style={[styles.heroDate, { color: colors.textSecondary }]}>
                      {formatLocalRevealInstant(overview.annual.ready_at)}
                    </Text>
                    <Button
                      title={opening === 'annual' ? 'Opening…' : 'Open anniversary capsule'}
                      variant="primary"
                      icon={annualReady ? 'heart' : 'lock'}
                      loading={opening === 'annual'}
                      disabled={action.loading || !annualReady}
                      style={styles.heroAction}
                      onPress={() => void annual(overview.annual!.year, true)}
                    />
                  </>
                )}
              </Animated.View>
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>
                  Checkpoint reveals
                </Text>
                <Text style={[styles.body, { color: colors.textSecondary }]}>
                  A little peek between anniversaries.
                </Text>
                {overview.checkpoints.length === 0 && (
                  <Text
                    style={[
                      styles.emptyCard,
                      { color: colors.textSecondary, backgroundColor: colors.surfaceSecondary },
                    ]}
                  >
                    No pending checkpoints. Add a schedule in Settings.
                  </Text>
                )}
                {overview.checkpoints.map((item) => {
                  const ready = Date.parse(item.due_at) <= now;
                  return (
                    <View
                      key={item.id}
                      style={[
                        styles.checkpoint,
                        { backgroundColor: colors.surface, borderColor: colors.border },
                      ]}
                    >
                      <View style={styles.checkpointHeading}>
                        <FontAwesome
                          name={ready ? 'envelope-open-o' : 'lock'}
                          size={22}
                          color={colors.primary}
                        />
                        <View style={styles.grow}>
                          <Text style={[styles.cardTitle, { color: colors.text }]}>
                            {item.label || 'A little peek'}
                          </Text>
                          <Text style={[styles.meta, { color: colors.textSecondary }]}>
                            {formatLocalRevealInstant(item.due_at)}
                          </Text>
                        </View>
                      </View>
                      <Button
                        title={ready ? 'Reveal a note' : 'Sealed until this time'}
                        variant={ready ? 'primary' : 'secondary'}
                        loading={opening === item.id}
                        disabled={action.loading || !ready}
                        onPress={() => void checkpoint(item.id)}
                      />
                    </View>
                  );
                })}
              </View>
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>
                  Your reveal history
                </Text>
                {overview.annual_history.length + overview.checkpoint_history.length === 0 && (
                  <Text
                    style={[
                      styles.emptyCard,
                      { color: colors.textSecondary, backgroundColor: colors.surfaceSecondary },
                    ]}
                  >
                    Your opened memories will stay here.
                  </Text>
                )}
                {overview.annual_history.map((event) => (
                  <HistoryCard
                    key={event.id}
                    annual
                    title={'Revisit ' + event.year + ' anniversary'}
                    subtitle={'Opened ' + formatLocalRevealInstant(event.opened_at)}
                    disabled={action.loading}
                    onPress={() => void annual(event.year, false)}
                  />
                ))}
                {overview.checkpoint_history.map((event) => (
                  <HistoryCard
                    key={event.id}
                    title={event.label || 'Past checkpoint'}
                    subtitle={
                      formatLocalRevealInstant(event.opened_at) +
                      (!event.entry_id ? ' · No note available' : '')
                    }
                    disabled={action.loading || !event.entry_id}
                    onPress={() => {
                      if (event.occurrence_id) void checkpoint(event.occurrence_id);
                      else if (event.entry_id)
                        void action.legacyEntry(event.entry_id).then((entry) => {
                          if (entry) setFlow({ kind: 'reader', entry, back: { kind: 'home' } });
                        });
                    }}
                  />
                ))}
              </View>
            </>
          )}
          <AdminRevealTools />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.md, paddingBottom: Spacing.xl, gap: Spacing.lg },
  intro: { gap: Spacing.sm, paddingVertical: Spacing.sm },
  eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  title: { fontSize: FontSize.xxl, fontWeight: '700' },
  body: { fontSize: FontSize.sm, lineHeight: 22 },
  hero: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.xl,
    borderWidth: 1,
    alignItems: 'center',
    gap: Spacing.md,
  },
  giftRing: {
    width: 112,
    height: 112,
    borderRadius: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: BorderRadius.full,
    overflow: 'hidden',
  },
  heroTitle: { fontSize: FontSize.xl, fontWeight: '700', textAlign: 'center' },
  heroCopy: { fontSize: FontSize.md, lineHeight: 24, textAlign: 'center' },
  heroDate: { fontSize: FontSize.sm, textAlign: 'center' },
  heroAction: { alignSelf: 'stretch' },
  section: { gap: Spacing.sm },
  sectionTitle: { fontSize: FontSize.xl, fontWeight: '600' },
  checkpoint: {
    padding: Spacing.md,
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    gap: Spacing.md,
  },
  checkpointHeading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  grow: { flex: 1, gap: Spacing.xs },
  cardTitle: { fontSize: FontSize.md, fontWeight: '600' },
  meta: { fontSize: FontSize.xs, lineHeight: 18 },
  historyCard: {
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    minHeight: 80,
  },
  historyIcon: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navigation: {
    padding: Spacing.sm,
    gap: Spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
  },
  empty: {
    flex: 1,
    padding: Spacing.lg,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.lg,
  },
  emptyCard: {
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    fontSize: FontSize.sm,
    lineHeight: 22,
  },
  pressed: { opacity: 0.75 },
  error: { padding: Spacing.md },
});
