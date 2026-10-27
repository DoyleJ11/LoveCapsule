import { View, Text, Pressable, StyleSheet, useColorScheme } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { BorderRadius, Colors, FontSize, Moods, Spacing } from '../constants/theme';
import { formatRelativeDay } from '../lib/date-utils';
import type { EntrySummary } from '../types/database';

export function NoteCard({
  entry,
  onPress,
  disabled = false,
}: {
  entry: EntrySummary;
  onPress: () => void;
  disabled?: boolean;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const mood = Moods.find((item) => item.key === entry.mood);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${entry.title || 'Untitled note'} · ${entry.entry_date}`}
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.border },
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.row}>
        <View style={styles.badges}>
          {entry.is_draft && (
            <View style={[styles.badge, { backgroundColor: colors.warning + '20' }]}>
              <Text style={[styles.meta, { color: colors.textSecondary }]}>Draft</Text>
            </View>
          )}
          {mood && <Text style={styles.mood}>{mood.emoji}</Text>}
        </View>
        <Text style={[styles.meta, { color: colors.textMuted }]}>
          {formatRelativeDay(entry.entry_date)}
        </Text>
      </View>
      <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
        {entry.title || 'Untitled note'}
      </Text>
      {!!entry.content_plain && (
        <Text style={[styles.preview, { color: colors.textSecondary }]} numberOfLines={2}>
          {entry.content_plain}
        </Text>
      )}
      <View style={styles.row}>
        <Text style={[styles.meta, { color: colors.textMuted }]}>
          {entry.word_count ?? 0} {entry.word_count === 1 ? 'word' : 'words'}
        </Text>
        {!!entry.location_name && (
          <View style={styles.location}>
            <FontAwesome name="map-marker" size={12} color={colors.textMuted} />
            <Text
              style={[styles.meta, styles.locationText, { color: colors.textMuted }]}
              numberOfLines={1}
            >
              {entry.location_name}
            </Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
    minHeight: 100,
  },
  pressed: { opacity: 0.75 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  badges: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  badge: { borderRadius: BorderRadius.sm, paddingHorizontal: Spacing.sm, paddingVertical: 2 },
  mood: { fontSize: 18 },
  meta: { fontSize: FontSize.xs },
  title: { fontSize: FontSize.lg, fontWeight: '600' },
  preview: { fontSize: FontSize.sm, lineHeight: 21 },
  location: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  locationText: { flexShrink: 1 },
});
