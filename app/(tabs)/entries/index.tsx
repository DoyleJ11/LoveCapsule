import { useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, useColorScheme } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useAuth } from '../../../src/providers/AuthProvider';
import { useCouple } from '../../../src/providers/CoupleProvider';
import { useEntries } from '../../../src/hooks/useEntries';
import { formatRelativeDay } from '../../../src/lib/date-utils';
import { Colors, Spacing, FontSize, BorderRadius, Moods } from '../../../src/constants/theme';
import type { Entry } from '../../../src/types/database';

function EntryCard({ entry, colors }: { entry: Entry; colors: any }) {
  const router = useRouter();
  const mood = Moods.find((m) => m.key === entry.mood);

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      onPress={() => router.push(`/(tabs)/entries/${entry.id}`)}
    >
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          {entry.is_draft && (
            <View style={[styles.draftBadge, { backgroundColor: colors.warning + '20' }]}>
              <Text style={[styles.draftBadgeText, { color: colors.warning }]}>Draft</Text>
            </View>
          )}
          {mood && <Text style={styles.moodEmoji}>{mood.emoji}</Text>}
        </View>
        <Text style={[styles.cardDate, { color: colors.textMuted }]}>
          {formatRelativeDay(entry.entry_date)}
        </Text>
      </View>

      <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>
        {entry.title || 'Untitled Entry'}
      </Text>

      {entry.content_plain ? (
        <Text style={[styles.cardPreview, { color: colors.textSecondary }]} numberOfLines={2}>
          {entry.content_plain}
        </Text>
      ) : null}

      <View style={styles.cardFooter}>
        <Text style={[styles.wordCount, { color: colors.textMuted }]}>
          {entry.word_count} {entry.word_count === 1 ? 'word' : 'words'}
        </Text>
        {entry.location_name && (
          <View style={styles.locationRow}>
            <FontAwesome name="map-marker" size={12} color={colors.textMuted} />
            <Text style={[styles.locationText, { color: colors.textMuted }]} numberOfLines={1}>
              {entry.location_name}
            </Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

export default function EntriesListScreen() {
  const { couple, loading: coupleLoading } = useCouple();
  const { entries, loading: entriesLoading, refresh } = useEntries(couple?.id);
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const loading = coupleLoading || entriesLoading;

  // Auto-refresh entries when the screen gains focus (e.g., after creating/editing/deleting)
  useFocusEffect(
    useCallback(() => {
      if (couple?.id) refresh();
    }, [couple?.id, refresh])
  );

  if (!couple) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.background }]}>
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
          Pair with your partner first in Settings
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={entries}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <EntryCard entry={item} colors={colors} />}
        contentContainerStyle={styles.listContent}
        onRefresh={refresh}
        refreshing={loading}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <FontAwesome name="book" size={48} color={colors.textMuted} />
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              No entries yet. Start writing!
            </Text>
          </View>
        }
      />

      {/* Floating Action Button */}
      <TouchableOpacity
        style={[styles.fab, { backgroundColor: colors.primary }]}
        onPress={() => router.push('/(tabs)/entries/new')}
      >
        <FontAwesome name="plus" size={24} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    padding: Spacing.md,
    paddingBottom: 100,
  },
  card: {
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  draftBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
  },
  draftBadgeText: {
    fontSize: FontSize.xs,
    fontWeight: '600',
  },
  moodEmoji: {
    fontSize: 18,
  },
  cardDate: {
    fontSize: FontSize.xs,
  },
  cardTitle: {
    fontSize: FontSize.lg,
    fontWeight: '600',
    marginBottom: Spacing.xs,
  },
  cardPreview: {
    fontSize: FontSize.sm,
    lineHeight: 20,
    marginBottom: Spacing.sm,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  wordCount: {
    fontSize: FontSize.xs,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flex: 1,
    justifyContent: 'flex-end',
  },
  locationText: {
    fontSize: FontSize.xs,
    maxWidth: 150,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: Spacing.xxl * 2,
    gap: Spacing.md,
  },
  emptyText: {
    fontSize: FontSize.md,
    textAlign: 'center',
  },
  fab: {
    position: 'absolute',
    bottom: Spacing.lg,
    right: Spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
});
