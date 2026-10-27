import { useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  SafeAreaView,
  useColorScheme,
  ScrollView,
} from 'react-native';
import PagerView from 'react-native-pager-view';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import Animated, { FadeIn, FadeInDown, FadeInUp, ReduceMotion } from 'react-native-reanimated';
import MapView, { Marker } from 'react-native-maps';
import { Colors, Spacing, FontSize, BorderRadius, Moods } from '../../constants/theme';
import { formatShortDate, formatEntryDate } from '../../lib/date-utils';
import type { RevealStats } from '../../types/database';
const { width: SCREEN_WIDTH } = Dimensions.get('window');
// Book word count comparisons for fun context
const BOOK_COMPARISONS = [
  { name: 'a love letter', words: 500 },
  { name: 'a short story', words: 5000 },
  { name: 'The Great Gatsby', words: 47094 },
  { name: "Harry Potter and the Sorcerer's Stone", words: 77325 },
  { name: 'Pride and Prejudice', words: 122189 },
];

function getBookComparison(totalWords: number): string {
  for (let i = BOOK_COMPARISONS.length - 1; i >= 0; i--) {
    if (totalWords >= BOOK_COMPARISONS[i].words) {
      return BOOK_COMPARISONS[i].name;
    }
  }
  return BOOK_COMPARISONS[0].name;
}

function getTimeLabel(hour: number): string {
  if (hour < 6) return 'late at night';
  if (hour < 12) return 'in the morning';
  if (hour < 17) return 'in the afternoon';
  if (hour < 21) return 'in the evening';
  return 'at night';
}

function StatSlide({
  children,
  colors,
  bgColor,
}: {
  children: React.ReactNode;
  colors: (typeof Colors)['light'];
  bgColor?: string;
}) {
  return (
    <View style={[styles.slide, { backgroundColor: bgColor || colors.background }]}>
      <SafeAreaView style={styles.slide}>
        <ScrollView contentContainerStyle={styles.slideContent}>{children}</ScrollView>
      </SafeAreaView>
    </View>
  );
}

function BarComparison({
  label1,
  value1,
  label2,
  value2,
  color1,
  color2,
  colors,
}: {
  label1: string;
  value1: number;
  label2: string;
  value2: number;
  color1: string;
  color2: string;
  colors: (typeof Colors)['light'];
}) {
  const maxVal = Math.max(value1, value2, 1);
  const winner1 = value1 > value2;
  const winner2 = value2 > value1;

  return (
    <View style={styles.barContainer}>
      {/* Row 1 */}
      <Animated.View entering={FadeInDown.delay(300).reduceMotion(ReduceMotion.System)}>
        <View style={styles.barLabelRow}>
          <Text style={[styles.barLabel, { color: colors.text }]} numberOfLines={1}>
            {label1}
          </Text>
          <Text style={[styles.barValue, { color: colors.text }]}>
            {value1.toLocaleString()}
            {winner1 ? ' 👑' : ''}
          </Text>
        </View>
        <View style={styles.barTrack}>
          <Animated.View
            entering={FadeIn.delay(500).reduceMotion(ReduceMotion.System)}
            style={[styles.bar, { width: `${(value1 / maxVal) * 100}%`, backgroundColor: color1 }]}
          />
        </View>
      </Animated.View>
      {/* Row 2 */}
      <Animated.View entering={FadeInDown.delay(500).reduceMotion(ReduceMotion.System)}>
        <View style={styles.barLabelRow}>
          <Text style={[styles.barLabel, { color: colors.text }]} numberOfLines={1}>
            {label2}
          </Text>
          <Text style={[styles.barValue, { color: colors.text }]}>
            {value2.toLocaleString()}
            {winner2 ? ' 👑' : ''}
          </Text>
        </View>
        <View style={styles.barTrack}>
          <Animated.View
            entering={FadeIn.delay(700).reduceMotion(ReduceMotion.System)}
            style={[styles.bar, { width: `${(value2 / maxVal) * 100}%`, backgroundColor: color2 }]}
          />
        </View>
      </Animated.View>
    </View>
  );
}

export function AnnualRecap({
  stats,
  partnerName,
  onRead,
}: {
  stats: RevealStats;
  partnerName: string;
  onRead: () => void;
}) {
  const pagerRef = useRef<PagerView>(null);
  const colors = Colors[useColorScheme() ?? 'light'];
  const totalEntries = stats.partner_1_entries + stats.partner_2_entries;
  const totalWords = stats.partner_1_words + stats.partner_2_words;
  const bookComparison = getBookComparison(totalWords);
  if (totalEntries === 0)
    return (
      <SafeAreaView style={styles.slideContent}>
        <Text style={[styles.readyTitle, { color: colors.text }]}>
          An empty capsule, saved with love
        </Text>
        <Text style={[styles.statSubCaption, { color: colors.textSecondary }]}>
          There were no published notes before this opening time. Your next chapter starts here.
        </Text>
        <TouchableOpacity accessibilityRole="button" onPress={onRead}>
          <Text style={{ color: colors.primary }}>View capsule</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );

  return (
    <PagerView ref={pagerRef} style={styles.pager} initialPage={0}>
      {/* Slide 1: Total Entries */}
      <View key="1">
        <StatSlide colors={colors}>
          <Animated.Text
            entering={FadeInDown.delay(200).reduceMotion(ReduceMotion.System)}
            style={[styles.statEmoji]}
          >
            📝
          </Animated.Text>
          <Animated.Text
            entering={FadeInDown.delay(400).reduceMotion(ReduceMotion.System)}
            style={[styles.statBigNumber, { color: colors.primary }]}
          >
            {totalEntries}
          </Animated.Text>
          <Animated.Text
            entering={FadeInDown.delay(600).reduceMotion(ReduceMotion.System)}
            style={[styles.statCaption, { color: colors.text }]}
          >
            Together, you captured{'\n'}
            {totalEntries} moments this year
          </Animated.Text>
          <Text style={[styles.swipeHint, { color: colors.textMuted }]}>Swipe to continue →</Text>
        </StatSlide>
      </View>

      {/* Slide 2: Entry Count Showdown */}
      <View key="2">
        <StatSlide colors={colors}>
          <Animated.Text entering={FadeIn} style={[styles.slideTitle, { color: colors.text }]}>
            Entry Showdown
          </Animated.Text>
          <BarComparison
            label1={stats.partner_1_name}
            value1={stats.partner_1_entries}
            label2={stats.partner_2_name}
            value2={stats.partner_2_entries}
            color1={colors.partner1}
            color2={colors.partner2}
            colors={colors}
          />
        </StatSlide>
      </View>

      {/* Slide 3: Total Words */}
      <View key="3">
        <StatSlide colors={colors}>
          <Animated.Text
            entering={FadeInDown.delay(200).reduceMotion(ReduceMotion.System)}
            style={styles.statEmoji}
          >
            💬
          </Animated.Text>
          <Animated.Text
            entering={FadeInDown.delay(400).reduceMotion(ReduceMotion.System)}
            style={[styles.statBigNumber, { color: colors.primary }]}
          >
            {totalWords.toLocaleString()}
          </Animated.Text>
          <Animated.Text
            entering={FadeInDown.delay(600).reduceMotion(ReduceMotion.System)}
            style={[styles.statCaption, { color: colors.text }]}
          >
            {totalWords >= 500
              ? `words of love — that's longer than ${bookComparison}`
              : totalWords
                ? 'words of love, saved together'
                : 'Your next chapter is waiting to be written'}
          </Animated.Text>
        </StatSlide>
      </View>

      {/* Slide 4: Word Count Showdown */}
      <View key="4">
        <StatSlide colors={colors}>
          <Animated.Text entering={FadeIn} style={[styles.slideTitle, { color: colors.text }]}>
            Who had more to say?
          </Animated.Text>
          <BarComparison
            label1={stats.partner_1_name}
            value1={stats.partner_1_words}
            label2={stats.partner_2_name}
            value2={stats.partner_2_words}
            color1={colors.partner1}
            color2={colors.partner2}
            colors={colors}
          />
        </StatSlide>
      </View>

      {/* Slide 5: Night Owl vs Early Bird */}
      <View key="5">
        <StatSlide colors={colors}>
          <Animated.Text
            entering={FadeInDown.delay(200).reduceMotion(ReduceMotion.System)}
            style={styles.statEmoji}
          >
            {Math.round(stats.partner_1_avg_hour) >= 18 ? '🌙' : '☀️'}
          </Animated.Text>
          <Animated.Text
            entering={FadeInDown.delay(400).reduceMotion(ReduceMotion.System)}
            style={[styles.slideTitle, { color: colors.text }]}
          >
            Night Owl vs Early Bird
          </Animated.Text>
          <Animated.View entering={FadeInDown.delay(600).reduceMotion(ReduceMotion.System)}>
            <Text style={[styles.timeText, { color: colors.partner1 }]}>
              {stats.partner_1_entries
                ? `${stats.partner_1_name} mostly wrote ${getTimeLabel(Math.round(stats.partner_1_avg_hour))}`
                : `${stats.partner_1_name} has no writing times yet`}
            </Text>
            <Text style={[styles.timeText, { color: colors.partner2 }]}>
              {stats.partner_2_entries
                ? `${stats.partner_2_name} mostly wrote ${getTimeLabel(Math.round(stats.partner_2_avg_hour))}`
                : `${stats.partner_2_name} has no writing times yet`}
            </Text>
          </Animated.View>
        </StatSlide>
      </View>

      {/* Slide 6: Most Active Month */}
      <View key="6">
        <StatSlide colors={colors}>
          <Animated.Text
            entering={FadeInDown.delay(200).reduceMotion(ReduceMotion.System)}
            style={styles.statEmoji}
          >
            📅
          </Animated.Text>
          <Animated.Text
            entering={FadeInDown.delay(400).reduceMotion(ReduceMotion.System)}
            style={[styles.statCaption, { color: colors.text }]}
          >
            Your love peaked in
          </Animated.Text>
          <Animated.Text
            entering={FadeInDown.delay(600).reduceMotion(ReduceMotion.System)}
            style={[styles.statBigText, { color: colors.primary }]}
          >
            {stats.most_active_month?.trim() || 'No writing month yet'}
          </Animated.Text>
          <Animated.Text
            entering={FadeInDown.delay(800).reduceMotion(ReduceMotion.System)}
            style={[styles.statSubCaption, { color: colors.textSecondary }]}
          >
            with {stats.most_active_month_count} entries
          </Animated.Text>
        </StatSlide>
      </View>

      {/* Slide 7: Longest Entry */}
      <View key="7">
        <StatSlide colors={colors}>
          <Animated.Text
            entering={FadeInDown.delay(200).reduceMotion(ReduceMotion.System)}
            style={styles.statEmoji}
          >
            📜
          </Animated.Text>
          <Animated.Text
            entering={FadeInDown.delay(400).reduceMotion(ReduceMotion.System)}
            style={[styles.slideTitle, { color: colors.text }]}
          >
            Longest Love Letter
          </Animated.Text>
          <Animated.Text
            entering={FadeInDown.delay(600).reduceMotion(ReduceMotion.System)}
            style={[styles.statBigNumber, { color: colors.primary }]}
          >
            {stats.longest_entry_words.toLocaleString()}
          </Animated.Text>
          <Animated.Text
            entering={FadeInDown.delay(700).reduceMotion(ReduceMotion.System)}
            style={[styles.statCaption, { color: colors.text }]}
          >
            words on {stats.longest_entry_date ? formatShortDate(stats.longest_entry_date) : ''}
          </Animated.Text>
          <Animated.Text
            entering={FadeInDown.delay(800).reduceMotion(ReduceMotion.System)}
            style={[styles.statSubCaption, { color: colors.textSecondary }]}
          >
            {!stats.longest_entry_author_id
              ? 'No notes in this capsule yet'
              : `Written by ${stats.longest_entry_author_id === stats.partner_1_id ? stats.partner_1_name : stats.partner_2_name}`}
          </Animated.Text>
        </StatSlide>
      </View>

      {/* Slide 8: Longest Streak */}
      <View key="8">
        <StatSlide colors={colors}>
          <Animated.Text
            entering={FadeInDown.delay(200).reduceMotion(ReduceMotion.System)}
            style={styles.statEmoji}
          >
            🔥
          </Animated.Text>
          <Animated.Text
            entering={FadeInDown.delay(400).reduceMotion(ReduceMotion.System)}
            style={[styles.slideTitle, { color: colors.text }]}
          >
            Longest Writing Streak
          </Animated.Text>
          <Animated.View entering={FadeInDown.delay(600).reduceMotion(ReduceMotion.System)}>
            <Text style={[styles.streakText, { color: colors.partner1 }]}>
              {stats.partner_1_name}: {stats.partner_1_longest_streak}{' '}
              {stats.partner_1_longest_streak === 1 ? 'day' : 'days'}
            </Text>
            <Text style={[styles.streakText, { color: colors.partner2 }]}>
              {stats.partner_2_name}: {stats.partner_2_longest_streak}{' '}
              {stats.partner_2_longest_streak === 1 ? 'day' : 'days'}
            </Text>
          </Animated.View>
        </StatSlide>
      </View>

      {/* Slide 9: Photos & Voice memos */}
      <View key="9">
        <StatSlide colors={colors}>
          <Animated.Text
            entering={FadeInDown.delay(200).reduceMotion(ReduceMotion.System)}
            style={styles.statEmoji}
          >
            📸
          </Animated.Text>
          <Animated.Text
            entering={FadeInDown.delay(400).reduceMotion(ReduceMotion.System)}
            style={[styles.slideTitle, { color: colors.text }]}
          >
            Captured Memories
          </Animated.Text>
          <Animated.View
            entering={FadeInDown.delay(600).reduceMotion(ReduceMotion.System)}
            style={styles.mediaStats}
          >
            <View style={styles.mediaStat}>
              <Text style={[styles.statBigNumber, { color: colors.primary, fontSize: 48 }]}>
                {stats.total_media_images}
              </Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>photos</Text>
            </View>
            <View style={styles.mediaStat}>
              <Text style={[styles.statBigNumber, { color: colors.accent, fontSize: 48 }]}>
                {stats.total_media_audio ?? 0}
              </Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>voice memos</Text>
            </View>
          </Animated.View>
          <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
            {Math.round((stats.total_audio_duration_ms ?? 0) / 60000)} minutes recorded
          </Text>
        </StatSlide>
      </View>

      {/* Slide 10: Top Moods */}
      <View key="10">
        <StatSlide colors={colors}>
          <Animated.Text
            entering={FadeInDown.delay(200).reduceMotion(ReduceMotion.System)}
            style={[styles.slideTitle, { color: colors.text }]}
          >
            Your Go-To Moods
          </Animated.Text>
          <Animated.View
            entering={FadeInDown.delay(500).reduceMotion(ReduceMotion.System)}
            style={styles.moodDisplay}
          >
            <View style={styles.moodPerson}>
              <Text style={[styles.moodPersonName, { color: colors.partner1 }]}>
                {stats.partner_1_name}
              </Text>
              <Text style={styles.bigMoodEmoji}>
                {Moods.find((m) => m.key === stats.partner_1_top_mood)?.emoji || '😊'}
              </Text>
              <Text style={[styles.moodLabel, { color: colors.textSecondary }]}>
                {stats.partner_1_top_mood || 'No mood set'}
              </Text>
            </View>
            <View style={styles.moodPerson}>
              <Text style={[styles.moodPersonName, { color: colors.partner2 }]}>
                {stats.partner_2_name}
              </Text>
              <Text style={styles.bigMoodEmoji}>
                {Moods.find((m) => m.key === stats.partner_2_top_mood)?.emoji || '😊'}
              </Text>
              <Text style={[styles.moodLabel, { color: colors.textSecondary }]}>
                {stats.partner_2_top_mood || 'No mood set'}
              </Text>
            </View>
          </Animated.View>
        </StatSlide>
      </View>

      {/* Slide 11: First & Last Entry */}
      <View key="11">
        <StatSlide colors={colors}>
          <Animated.Text
            entering={FadeInDown.delay(200).reduceMotion(ReduceMotion.System)}
            style={styles.statEmoji}
          >
            📆
          </Animated.Text>
          <Animated.Text
            entering={FadeInDown.delay(400).reduceMotion(ReduceMotion.System)}
            style={[styles.slideTitle, { color: colors.text }]}
          >
            Your Journey
          </Animated.Text>
          <Animated.View
            entering={FadeInDown.delay(600).reduceMotion(ReduceMotion.System)}
            style={styles.journeyContainer}
          >
            <View style={styles.journeyPoint}>
              <View style={[styles.journeyDot, { backgroundColor: colors.primary }]} />
              <Text style={[styles.journeyLabel, { color: colors.textSecondary }]}>
                First entry
              </Text>
              <Text style={[styles.journeyDate, { color: colors.text }]}>
                {stats.first_entry_date ? formatEntryDate(stats.first_entry_date) : '—'}
              </Text>
            </View>
            <View style={[styles.journeyLine, { backgroundColor: colors.border }]} />
            <View style={styles.journeyPoint}>
              <View style={[styles.journeyDot, { backgroundColor: colors.accent }]} />
              <Text style={[styles.journeyLabel, { color: colors.textSecondary }]}>
                Most recent
              </Text>
              <Text style={[styles.journeyDate, { color: colors.text }]}>
                {stats.last_entry_date ? formatEntryDate(stats.last_entry_date) : '—'}
              </Text>
            </View>
          </Animated.View>
        </StatSlide>
      </View>

      {/* Slide 12: Day of Week */}
      <View key="12">
        <StatSlide colors={colors}>
          <Animated.Text
            entering={FadeInDown.delay(200).reduceMotion(ReduceMotion.System)}
            style={[styles.slideTitle, { color: colors.text }]}
          >
            Favorite Writing Days
          </Animated.Text>
          <Animated.View entering={FadeInDown.delay(500).reduceMotion(ReduceMotion.System)}>
            <Text style={[styles.dowText, { color: colors.partner1 }]}>
              {stats.partner_1_name} loves {stats.partner_1_favorite_dow?.trim() || '—'}s
            </Text>
            <Text style={[styles.dowText, { color: colors.partner2 }]}>
              {stats.partner_2_name} prefers {stats.partner_2_favorite_dow?.trim() || '—'}s
            </Text>
          </Animated.View>
        </StatSlide>
      </View>

      {/* Slide 13: Love Map */}
      <View key="13">
        <StatSlide colors={colors}>
          <Animated.Text
            entering={FadeInDown.delay(200).reduceMotion(ReduceMotion.System)}
            style={[styles.slideTitle, { color: colors.text }]}
          >
            Your Love Map
          </Animated.Text>
          {stats.locations.length > 0 ? (
            <Animated.View
              entering={FadeIn.delay(400).reduceMotion(ReduceMotion.System)}
              style={styles.mapContainer}
            >
              <MapView
                style={styles.map}
                initialRegion={{
                  latitude: stats.locations[0].lat,
                  longitude: stats.locations[0].lng,
                  latitudeDelta: 2,
                  longitudeDelta: 2,
                }}
              >
                {stats.locations.map((loc, i) => (
                  <Marker
                    key={i}
                    coordinate={{ latitude: loc.lat, longitude: loc.lng }}
                    title={loc.location_name}
                    description={formatShortDate(loc.entry_date)}
                    pinColor={
                      loc.author_id === stats.partner_1_id ? colors.partner1 : colors.partner2
                    }
                  />
                ))}
              </MapView>
              <Text style={[styles.mapCaption, { color: colors.textSecondary }]}>
                Showing up to 200 tagged memories across {stats.unique_location_count} different{' '}
                {stats.unique_location_count === 1 ? 'place' : 'places'}
              </Text>
            </Animated.View>
          ) : (
            <Text style={[styles.statSubCaption, { color: colors.textMuted }]}>
              No locations tagged yet
            </Text>
          )}
        </StatSlide>
      </View>

      {/* Final Slide: Transition to entries */}
      <View key="outro">
        <StatSlide colors={colors}>
          <Animated.Text
            entering={FadeInDown.delay(200).reduceMotion(ReduceMotion.System)}
            style={styles.statEmoji}
          >
            💌
          </Animated.Text>
          <Animated.Text
            entering={FadeInDown.delay(400).reduceMotion(ReduceMotion.System)}
            style={[styles.readyTitle, { color: colors.text }]}
          >
            Now, read what {partnerName} wrote for you...
          </Animated.Text>
          <Animated.View
            entering={FadeInUp.delay(800).reduceMotion(ReduceMotion.System)}
            style={styles.outroButtons}
          >
            <TouchableOpacity
              accessibilityRole="button"
              style={[styles.openButton, { backgroundColor: colors.primary }]}
              onPress={onRead}
            >
              <Text style={styles.openButtonText}>Read Their Entries</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              style={[styles.replayButton, { borderColor: colors.textMuted }]}
              onPress={() => pagerRef.current?.setPage(0)}
            >
              <FontAwesome name="refresh" size={16} color={colors.textSecondary} />
              <Text style={[styles.replayButtonText, { color: colors.textSecondary }]}>
                Replay from start
              </Text>
            </TouchableOpacity>
          </Animated.View>
        </StatSlide>
      </View>
    </PagerView>
  );
}
const styles = StyleSheet.create({
  pager: {
    flex: 1,
  },
  slide: {
    flex: 1,
    width: SCREEN_WIDTH,
  },
  slideContent: {
    flexGrow: 1,
    paddingVertical: Spacing.lg,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
  },
  readyTitle: {
    fontSize: FontSize.xxl,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  openButton: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  openButtonText: {
    color: '#fff',
    fontSize: FontSize.lg,
    fontWeight: '700',
  },
  slideTitle: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: Spacing.lg,
  },
  statEmoji: {
    fontSize: 64,
    marginBottom: Spacing.md,
  },
  statBigNumber: {
    fontSize: 72,
    fontWeight: '800',
  },
  statBigText: {
    fontSize: FontSize.xxxl,
    fontWeight: '800',
    marginBottom: Spacing.sm,
  },
  statCaption: {
    fontSize: FontSize.lg,
    textAlign: 'center',
    marginTop: Spacing.sm,
    lineHeight: 26,
  },
  statSubCaption: {
    fontSize: FontSize.md,
    textAlign: 'center',
    marginTop: Spacing.xs,
  },
  statLabel: {
    fontSize: FontSize.md,
    marginTop: Spacing.xs,
  },
  swipeHint: {
    fontSize: FontSize.sm,
    position: 'absolute',
    bottom: 40,
  },
  // Bar chart styles
  barContainer: {
    width: '100%',
    gap: Spacing.lg,
    paddingHorizontal: Spacing.sm,
  },
  barLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  barLabel: {
    fontSize: FontSize.sm,
    fontWeight: '500',
    flexShrink: 1,
  },
  barTrack: {
    height: 28,
    backgroundColor: '#00000010',
    borderRadius: BorderRadius.sm,
    overflow: 'hidden',
  },
  bar: {
    height: '100%',
    borderRadius: BorderRadius.sm,
  },
  barValue: {
    fontSize: FontSize.sm,
    fontWeight: '700',
    marginLeft: Spacing.sm,
  },
  // Time styles
  timeText: {
    fontSize: FontSize.lg,
    fontWeight: '500',
    textAlign: 'center',
    marginBottom: Spacing.md,
  },
  // Streak styles
  streakText: {
    fontSize: FontSize.xl,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: Spacing.md,
  },
  // Media stats
  mediaStats: {
    flexDirection: 'row',
    gap: Spacing.xxl,
  },
  mediaStat: {
    alignItems: 'center',
  },
  // Mood styles
  moodDisplay: {
    flexDirection: 'row',
    gap: Spacing.xxl,
  },
  moodPerson: {
    alignItems: 'center',
    gap: Spacing.sm,
  },
  moodPersonName: {
    fontSize: FontSize.md,
    fontWeight: '600',
  },
  bigMoodEmoji: {
    fontSize: 56,
  },
  moodLabel: {
    fontSize: FontSize.sm,
  },
  // Journey styles
  journeyContainer: {
    alignItems: 'center',
    gap: Spacing.md,
  },
  journeyPoint: {
    alignItems: 'center',
  },
  journeyDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    marginBottom: Spacing.xs,
  },
  journeyLabel: {
    fontSize: FontSize.sm,
  },
  journeyDate: {
    fontSize: FontSize.lg,
    fontWeight: '600',
  },
  journeyLine: {
    width: 2,
    height: 40,
  },
  // Day of week
  dowText: {
    fontSize: FontSize.xl,
    fontWeight: '500',
    textAlign: 'center',
    marginBottom: Spacing.md,
  },
  // Map styles
  mapContainer: {
    width: '100%',
    alignItems: 'center',
  },
  map: {
    width: SCREEN_WIDTH - Spacing.xl * 2,
    height: 300,
    borderRadius: BorderRadius.lg,
    overflow: 'hidden',
  },
  mapCaption: {
    fontSize: FontSize.md,
    marginTop: Spacing.md,
    textAlign: 'center',
  },
  // Replay buttons
  outroButtons: {
    alignItems: 'center',
    gap: Spacing.md,
  },
  replayButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  replayButtonText: {
    fontSize: FontSize.md,
    fontWeight: '500',
  },
});
