import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, useColorScheme } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useCouple } from '../../../src/providers/CoupleProvider';
import { useEntries } from '../../../src/hooks/useEntries';
import { Button } from '../../../src/components/Button';
import { NoteCard } from '../../../src/components/NoteCard';
import { Colors, Spacing, FontSize } from '../../../src/constants/theme';

export default function EntriesListScreen() {
  const { couple, loading: coupleLoading } = useCouple();
  const {
    entries,
    loading: entriesLoading,
    error,
    hasMore,
    loadMore,
    refresh,
  } = useEntries(couple?.id);
  const router = useRouter();
  const colors = Colors[useColorScheme() ?? 'light'];
  const [refreshing, setRefreshing] = useState(false);
  const loading = coupleLoading || entriesLoading;
  useFocusEffect(
    useCallback(() => {
      if (couple?.id) void refresh();
    }, [couple?.id, refresh])
  );

  const pullToRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };
  if (!couple)
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.background }]}>
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
          Pair with your partner first in Settings
        </Text>
      </View>
    );
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {error && (
        <View style={styles.error}>
          <Text accessibilityRole="alert" style={{ color: colors.error }}>
            {error}
          </Text>
          <Button title="Retry diary" onPress={() => void refresh()} />
        </View>
      )}
      <FlatList
        data={entries}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <NoteCard
            entry={item}
            onPress={() =>
              router.push({ pathname: '/(tabs)/entries/[id]', params: { id: item.id } })
            }
          />
        )}
        contentContainerStyle={styles.listContent}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        onRefresh={() => void pullToRefresh()}
        refreshing={refreshing}
        onEndReached={() => {
          if (hasMore && !loading) void loadMore();
        }}
        ListFooterComponent={
          hasMore ? (
            <Button
              title="Load more notes"
              loading={entriesLoading && entries.length > 0}
              disabled={loading}
              onPress={() => void loadMore()}
            />
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <FontAwesome name="book" size={48} color={colors.textMuted} />
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              {loading
                ? 'Loading your diary…'
                : error
                  ? 'Your diary could not be loaded. Your notes are still saved.'
                  : 'No entries yet. Start writing!'}
            </Text>
          </View>
        }
      />
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Write a note"
        style={[styles.fab, { backgroundColor: colors.primaryAction }]}
        onPress={() => router.push('/(tabs)/entries/new')}
      >
        <FontAwesome name="plus" size={24} color={colors.onAction} />
      </TouchableOpacity>
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: Spacing.md, paddingBottom: 100, gap: Spacing.sm },
  error: { padding: Spacing.md, gap: Spacing.sm },
  emptyContainer: { alignItems: 'center', padding: Spacing.xxl, gap: Spacing.md },
  emptyText: { fontSize: FontSize.md, textAlign: 'center', lineHeight: 24 },
  fab: {
    position: 'absolute',
    right: Spacing.lg,
    bottom: Spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
});
