import { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  FlatList,
  useColorScheme,
  SafeAreaView,
} from 'react-native';
import PagerView from 'react-native-pager-view';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInUp,
  ZoomIn,
} from 'react-native-reanimated';
import MapView, { Marker } from 'react-native-maps';
import { useCouple } from '../../../src/hooks/useCouple';
import { useReveal } from '../../../src/hooks/useReveal';
import { useAuth } from '../../../src/providers/AuthProvider';
import { formatEntryDate, formatShortDate } from '../../../src/lib/date-utils';
import { Colors, Spacing, FontSize, BorderRadius, Moods } from '../../../src/constants/theme';
import type { RevealStats, Entry } from '../../../src/types/database';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Book word count comparisons for fun context
const BOOK_COMPARISONS = [
  { name: 'a love letter', words: 500 },
  { name: 'a short story', words: 5000 },
  { name: 'The Great Gatsby', words: 47094 },
  { name: 'Harry Potter and the Sorcerer\'s Stone', words: 77325 },
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
  colors: any;
  bgColor?: string;
}) {
  return (
    <View style={[styles.slide, { backgroundColor: bgColor || colors.background }]}>
      <SafeAreaView style={styles.slideContent}>{children}</SafeAreaView>
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
  colors: any;
}) {
  const maxVal = Math.max(value1, value2, 1);

  return (
    <View style={styles.barContainer}>
      <Animated.View entering={FadeInDown.delay(300)} style={styles.barRow}>
        <Text style={[styles.barLabel, { color: colors.text }]}>{label1}</Text>
        <View style={styles.barTrack}>
          <Animated.View
            entering={FadeIn.delay(500)}
            style={[
              styles.bar,
              { width: `${(value1 / maxVal) * 100}%`, backgroundColor: color1 },
            ]}
          />
        </View>
        <Text style={[styles.barValue, { color: colors.text }]}>{value1.toLocaleString()}</Text>
        {value1 > value2 && <Text style={styles.crown}>👑</Text>}
      </Animated.View>
      <Animated.View entering={FadeInDown.delay(500)} style={styles.barRow}>
        <Text style={[styles.barLabel, { color: colors.text }]}>{label2}</Text>
        <View style={styles.barTrack}>
          <Animated.View
            entering={FadeIn.delay(700)}
            style={[
              styles.bar,
              { width: `${(value2 / maxVal) * 100}%`, backgroundColor: color2 },
            ]}
          />
        </View>
        <Text style={[styles.barValue, { color: colors.text }]}>{value2.toLocaleString()}</Text>
        {value2 > value1 && <Text style={styles.crown}>👑</Text>}
      </Animated.View>
    </View>
  );
}

export default function RevealScreen() {
  const { couple, isRevealReady } = useCouple();
  const { user } = useAuth();
  const { stats, partnerEntries, loading, error, triggerReveal, fetchPartnerEntries } = useReveal();
  const [started, setStarted] = useState(false);
  const [showEntries, setShowEntries] = useState(false);
  const pagerRef = useRef<PagerView>(null);
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  if (!couple || !isRevealReady) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.background }]}>
        <FontAwesome name="lock" size={64} color={colors.textMuted} />
        <Text style={[styles.lockedTitle, { color: colors.text }]}>Not Yet...</Text>
        <Text style={[styles.lockedSubtitle, { color: colors.textSecondary }]}>
          Your TimeCapsule will unlock on your anniversary
        </Text>
      </View>
    );
  }

  if (!started) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.background }]}>
        <Animated.View entering={ZoomIn.duration(600)} style={styles.capsuleIcon}>
          <FontAwesome name="gift" size={80} color={colors.primary} />
        </Animated.View>
        <Animated.Text
          entering={FadeInUp.delay(400)}
          style={[styles.readyTitle, { color: colors.text }]}
        >
          Your TimeCapsule is ready!
        </Animated.Text>
        <Animated.Text
          entering={FadeInUp.delay(600)}
          style={[styles.readySubtitle, { color: colors.textSecondary }]}
        >
          Tap to reveal what you've written for each other
        </Animated.Text>
        <Animated.View entering={FadeInUp.delay(800)}>
          <TouchableOpacity
            style={[styles.openButton, { backgroundColor: colors.primary }]}
            onPress={async () => {
              await triggerReveal(couple.id);
              setStarted(true);
            }}
            disabled={loading}
          >
            <Text style={styles.openButtonText}>
              {loading ? 'Opening...' : 'Open TimeCapsule'}
            </Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    );
  }

  if (showEntries) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.entriesHeader}>
          <Text style={[styles.entriesTitle, { color: colors.text }]}>Your Love Story</Text>
          <Text style={[styles.entriesSubtitle, { color: colors.textSecondary }]}>
            All entries from this year
          </Text>
        </View>
        <FlatList
          data={partnerEntries}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.entriesList}
          renderItem={({ item }) => {
            const isPartner = item.author_id !== user?.id;
            const mood = Moods.find((m) => m.key === item.mood);
            return (
              <View
                style={[
                  styles.entryCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    borderLeftColor: isPartner ? colors.partner2 : colors.partner1,
                    borderLeftWidth: 3,
                  },
                ]}
              >
                <View style={styles.entryCardHeader}>
                  <Text style={[styles.entryAuthor, { color: isPartner ? colors.partner2 : colors.partner1 }]}>
                    {isPartner ? stats?.partner_2_name || stats?.partner_1_name : 'You'}
                  </Text>
                  <Text style={[styles.entryDate, { color: colors.textMuted }]}>
                    {formatShortDate(item.entry_date)}
                  </Text>
                  {mood && <Text>{mood.emoji}</Text>}
                </View>
                <Text style={[styles.entryTitle, { color: colors.text }]}>
                  {item.title || 'Untitled'}
                </Text>
                <Text style={[styles.entryBody, { color: colors.textSecondary }]}>
                  {item.content_plain}
                </Text>
                {item.location_name && (
                  <View style={styles.entryLocation}>
                    <FontAwesome name="map-marker" size={12} color={colors.textMuted} />
                    <Text style={[styles.entryLocationText, { color: colors.textMuted }]}>
                      {item.location_name}
                    </Text>
                  </View>
                )}
              </View>
            );
          }}
        />
      </SafeAreaView>
    );
  }

  if (!stats) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.background }]}>
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
          Loading your stats...
        </Text>
      </View>
    );
  }

  const totalEntries = stats.partner_1_entries + stats.partner_2_entries;
  const totalWords = stats.partner_1_words + stats.partner_2_words;
  const bookComparison = getBookComparison(totalWords);

  return (
    <PagerView ref={pagerRef} style={styles.pager} initialPage={0}>
      {/* Slide 1: Total Entries */}
      <View key="1">
        <StatSlide colors={colors}>
          <Animated.Text entering={FadeInDown.delay(200)} style={[styles.statEmoji]}>
            📝
          </Animated.Text>
          <Animated.Text entering={FadeInDown.delay(400)} style={[styles.statBigNumber, { color: colors.primary }]}>
            {totalEntries}
          </Animated.Text>
          <Animated.Text entering={FadeInDown.delay(600)} style={[styles.statCaption, { color: colors.text }]}>
            Together, you captured{'\n'}{totalEntries} moments this year
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
          <Animated.Text entering={FadeInDown.delay(200)} style={styles.statEmoji}>💬</Animated.Text>
          <Animated.Text entering={FadeInDown.delay(400)} style={[styles.statBigNumber, { color: colors.primary }]}>
            {totalWords.toLocaleString()}
          </Animated.Text>
          <Animated.Text entering={FadeInDown.delay(600)} style={[styles.statCaption, { color: colors.text }]}>
            words of love — that's longer than{'\n'}{bookComparison}
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
          <Animated.Text entering={FadeInDown.delay(200)} style={styles.statEmoji}>
            {Math.round(stats.partner_1_avg_hour) >= 18 ? '🌙' : '☀️'}
          </Animated.Text>
          <Animated.Text entering={FadeInDown.delay(400)} style={[styles.slideTitle, { color: colors.text }]}>
            Night Owl vs Early Bird
          </Animated.Text>
          <Animated.View entering={FadeInDown.delay(600)}>
            <Text style={[styles.timeText, { color: colors.partner1 }]}>
              {stats.partner_1_name} mostly wrote {getTimeLabel(Math.round(stats.partner_1_avg_hour))}
            </Text>
            <Text style={[styles.timeText, { color: colors.partner2 }]}>
              {stats.partner_2_name} mostly wrote {getTimeLabel(Math.round(stats.partner_2_avg_hour))}
            </Text>
          </Animated.View>
        </StatSlide>
      </View>

      {/* Slide 6: Most Active Month */}
      <View key="6">
        <StatSlide colors={colors}>
          <Animated.Text entering={FadeInDown.delay(200)} style={styles.statEmoji}>📅</Animated.Text>
          <Animated.Text entering={FadeInDown.delay(400)} style={[styles.statCaption, { color: colors.text }]}>
            Your love peaked in
          </Animated.Text>
          <Animated.Text entering={FadeInDown.delay(600)} style={[styles.statBigText, { color: colors.primary }]}>
            {stats.most_active_month?.trim()}
          </Animated.Text>
          <Animated.Text entering={FadeInDown.delay(800)} style={[styles.statSubCaption, { color: colors.textSecondary }]}>
            with {stats.most_active_month_count} entries
          </Animated.Text>
        </StatSlide>
      </View>

      {/* Slide 7: Longest Entry */}
      <View key="7">
        <StatSlide colors={colors}>
          <Animated.Text entering={FadeInDown.delay(200)} style={styles.statEmoji}>📜</Animated.Text>
          <Animated.Text entering={FadeInDown.delay(400)} style={[styles.slideTitle, { color: colors.text }]}>
            Longest Love Letter
          </Animated.Text>
          <Animated.Text entering={FadeInDown.delay(600)} style={[styles.statBigNumber, { color: colors.primary }]}>
            {stats.longest_entry_words.toLocaleString()}
          </Animated.Text>
          <Animated.Text entering={FadeInDown.delay(700)} style={[styles.statCaption, { color: colors.text }]}>
            words on {stats.longest_entry_date ? formatShortDate(stats.longest_entry_date) : ''}
          </Animated.Text>
          <Animated.Text entering={FadeInDown.delay(800)} style={[styles.statSubCaption, { color: colors.textSecondary }]}>
            Written by {stats.longest_entry_author_id === stats.partner_1_id ? stats.partner_1_name : stats.partner_2_name}
          </Animated.Text>
        </StatSlide>
      </View>

      {/* Slide 8: Longest Streak */}
      <View key="8">
        <StatSlide colors={colors}>
          <Animated.Text entering={FadeInDown.delay(200)} style={styles.statEmoji}>🔥</Animated.Text>
          <Animated.Text entering={FadeInDown.delay(400)} style={[styles.slideTitle, { color: colors.text }]}>
            Longest Writing Streak
          </Animated.Text>
          <Animated.View entering={FadeInDown.delay(600)}>
            <Text style={[styles.streakText, { color: colors.partner1 }]}>
              {stats.partner_1_name}: {stats.partner_1_longest_streak} {stats.partner_1_longest_streak === 1 ? 'day' : 'days'}
            </Text>
            <Text style={[styles.streakText, { color: colors.partner2 }]}>
              {stats.partner_2_name}: {stats.partner_2_longest_streak} {stats.partner_2_longest_streak === 1 ? 'day' : 'days'}
            </Text>
          </Animated.View>
        </StatSlide>
      </View>

      {/* Slide 9: Photos & Videos */}
      <View key="9">
        <StatSlide colors={colors}>
          <Animated.Text entering={FadeInDown.delay(200)} style={styles.statEmoji}>📸</Animated.Text>
          <Animated.Text entering={FadeInDown.delay(400)} style={[styles.slideTitle, { color: colors.text }]}>
            Captured Memories
          </Animated.Text>
          <Animated.View entering={FadeInDown.delay(600)} style={styles.mediaStats}>
            <View style={styles.mediaStat}>
              <Text style={[styles.statBigNumber, { color: colors.primary, fontSize: 48 }]}>
                {stats.total_media_images}
              </Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>photos</Text>
            </View>
            <View style={styles.mediaStat}>
              <Text style={[styles.statBigNumber, { color: colors.accent, fontSize: 48 }]}>
                {stats.total_media_videos}
              </Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>videos</Text>
            </View>
          </Animated.View>
        </StatSlide>
      </View>

      {/* Slide 10: Top Moods */}
      <View key="10">
        <StatSlide colors={colors}>
          <Animated.Text entering={FadeInDown.delay(200)} style={[styles.slideTitle, { color: colors.text }]}>
            Your Go-To Moods
          </Animated.Text>
          <Animated.View entering={FadeInDown.delay(500)} style={styles.moodDisplay}>
            <View style={styles.moodPerson}>
              <Text style={[styles.moodPersonName, { color: colors.partner1 }]}>{stats.partner_1_name}</Text>
              <Text style={styles.bigMoodEmoji}>
                {Moods.find((m) => m.key === stats.partner_1_top_mood)?.emoji || '😊'}
              </Text>
              <Text style={[styles.moodLabel, { color: colors.textSecondary }]}>
                {stats.partner_1_top_mood || 'No mood set'}
              </Text>
            </View>
            <View style={styles.moodPerson}>
              <Text style={[styles.moodPersonName, { color: colors.partner2 }]}>{stats.partner_2_name}</Text>
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
          <Animated.Text entering={FadeInDown.delay(200)} style={styles.statEmoji}>📆</Animated.Text>
          <Animated.Text entering={FadeInDown.delay(400)} style={[styles.slideTitle, { color: colors.text }]}>
            Your Journey
          </Animated.Text>
          <Animated.View entering={FadeInDown.delay(600)} style={styles.journeyContainer}>
            <View style={styles.journeyPoint}>
              <View style={[styles.journeyDot, { backgroundColor: colors.primary }]} />
              <Text style={[styles.journeyLabel, { color: colors.textSecondary }]}>First entry</Text>
              <Text style={[styles.journeyDate, { color: colors.text }]}>
                {stats.first_entry_date ? formatEntryDate(stats.first_entry_date) : '—'}
              </Text>
            </View>
            <View style={[styles.journeyLine, { backgroundColor: colors.border }]} />
            <View style={styles.journeyPoint}>
              <View style={[styles.journeyDot, { backgroundColor: colors.accent }]} />
              <Text style={[styles.journeyLabel, { color: colors.textSecondary }]}>Most recent</Text>
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
          <Animated.Text entering={FadeInDown.delay(200)} style={[styles.slideTitle, { color: colors.text }]}>
            Favorite Writing Days
          </Animated.Text>
          <Animated.View entering={FadeInDown.delay(500)}>
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
          <Animated.Text entering={FadeInDown.delay(200)} style={[styles.slideTitle, { color: colors.text }]}>
            Your Love Map
          </Animated.Text>
          {stats.locations.length > 0 ? (
            <Animated.View entering={FadeIn.delay(400)} style={styles.mapContainer}>
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
                    pinColor={loc.author_id === stats.partner_1_id ? colors.partner1 : colors.partner2}
                  />
                ))}
              </MapView>
              <Text style={[styles.mapCaption, { color: colors.textSecondary }]}>
                You made memories in {stats.unique_location_count} different {stats.unique_location_count === 1 ? 'place' : 'places'}
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
          <Animated.Text entering={FadeInDown.delay(200)} style={styles.statEmoji}>💌</Animated.Text>
          <Animated.Text entering={FadeInDown.delay(400)} style={[styles.readyTitle, { color: colors.text }]}>
            Now, read what {stats.partner_2_name} wrote for you...
          </Animated.Text>
          <Animated.View entering={FadeInUp.delay(800)}>
            <TouchableOpacity
              style={[styles.openButton, { backgroundColor: colors.primary }]}
              onPress={async () => {
                await fetchPartnerEntries(couple.id);
                setShowEntries(true);
              }}
            >
              <Text style={styles.openButtonText}>Read Their Entries</Text>
            </TouchableOpacity>
          </Animated.View>
        </StatSlide>
      </View>
    </PagerView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
  },
  pager: {
    flex: 1,
  },
  slide: {
    flex: 1,
    width: SCREEN_WIDTH,
  },
  slideContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
  },
  lockedTitle: {
    fontSize: FontSize.xxl,
    fontWeight: '700',
    marginTop: Spacing.lg,
  },
  lockedSubtitle: {
    fontSize: FontSize.md,
    textAlign: 'center',
    marginTop: Spacing.sm,
  },
  capsuleIcon: {
    marginBottom: Spacing.lg,
  },
  readyTitle: {
    fontSize: FontSize.xxl,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  readySubtitle: {
    fontSize: FontSize.md,
    textAlign: 'center',
    marginBottom: Spacing.xl,
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
  loadingText: {
    fontSize: FontSize.md,
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
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  barLabel: {
    width: 80,
    fontSize: FontSize.sm,
    fontWeight: '500',
  },
  barTrack: {
    flex: 1,
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
    width: 50,
    fontSize: FontSize.sm,
    fontWeight: '700',
    textAlign: 'right',
  },
  crown: {
    fontSize: 20,
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
  // Entries list styles
  entriesHeader: {
    padding: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  entriesTitle: {
    fontSize: FontSize.xxl,
    fontWeight: '700',
  },
  entriesSubtitle: {
    fontSize: FontSize.md,
    marginTop: Spacing.xs,
  },
  entriesList: {
    padding: Spacing.md,
    paddingBottom: Spacing.xxl,
  },
  entryCard: {
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
  },
  entryCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  entryAuthor: {
    fontSize: FontSize.sm,
    fontWeight: '600',
  },
  entryDate: {
    fontSize: FontSize.xs,
  },
  entryTitle: {
    fontSize: FontSize.lg,
    fontWeight: '600',
    marginBottom: Spacing.xs,
  },
  entryBody: {
    fontSize: FontSize.sm,
    lineHeight: 20,
  },
  entryLocation: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: Spacing.sm,
  },
  entryLocationText: {
    fontSize: FontSize.xs,
  },
});
