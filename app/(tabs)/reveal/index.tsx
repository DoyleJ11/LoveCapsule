import { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  FlatList,
  useColorScheme,
  SafeAreaView,
  Alert,
  Modal,
  ScrollView,
} from 'react-native';
import PagerView from 'react-native-pager-view';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import Animated, { FadeIn, FadeInDown, FadeInUp, ZoomIn } from 'react-native-reanimated';
import MapView, { Marker } from 'react-native-maps';
import { useCouple } from '../../../src/hooks/useCouple';
import { useReveal } from '../../../src/hooks/useReveal';
import { useCheckpoint } from '../../../src/hooks/useCheckpoint';
import { useAuth } from '../../../src/providers/AuthProvider';
import { supabase } from '../../../src/lib/supabase';
import {
  formatEntryDate,
  formatShortDate,
  formatCheckpointDescription,
} from '../../../src/lib/date-utils';
import { Colors, Spacing, FontSize, BorderRadius, Moods } from '../../../src/constants/theme';
import { DEV_TOOLS_ENABLED } from '../../../src/lib/dev-tools';
import type { RevealStats, Entry } from '../../../src/types/database';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

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
  const winner1 = value1 > value2;
  const winner2 = value2 > value1;

  return (
    <View style={styles.barContainer}>
      {/* Row 1 */}
      <Animated.View entering={FadeInDown.delay(300)}>
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
            entering={FadeIn.delay(500)}
            style={[styles.bar, { width: `${(value1 / maxVal) * 100}%`, backgroundColor: color1 }]}
          />
        </View>
      </Animated.View>
      {/* Row 2 */}
      <Animated.View entering={FadeInDown.delay(500)}>
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
            entering={FadeIn.delay(700)}
            style={[styles.bar, { width: `${(value2 / maxVal) * 100}%`, backgroundColor: color2 }]}
          />
        </View>
      </Animated.View>
    </View>
  );
}

export default function RevealScreen() {
  const { couple, partner, isRevealReady, isRevealed, refresh: refreshCouple } = useCouple();
  const { user } = useAuth();
  const {
    stats,
    partnerEntries,
    revealYears,
    selectedYear,
    loading,
    error,
    triggerReveal,
    loadStats,
    loadRevealYears,
    fetchPartnerEntries,
    setSelectedYear,
    reset,
  } = useReveal();
  const {
    isCheckpointDay,
    todaysCheckpoints,
    checkpointEntry,
    alreadyRevealed: checkpointAlreadyRevealed,
    noEntriesRemaining,
    checkpointHistory,
    checkToday,
    revealEntry: revealCheckpointEntry,
    loadHistory,
    loading: checkpointLoading,
    error: checkpointError,
    reset: resetCheckpoint,
  } = useCheckpoint();
  const [started, setStarted] = useState(false);
  const [showEntries, setShowEntries] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<Entry | null>(null);
  const [showYearPicker, setShowYearPicker] = useState(false);
  const [showCheckpointEntry, setShowCheckpointEntry] = useState(false);
  const [showCheckpointHistory, setShowCheckpointHistory] = useState(false);
  const pagerRef = useRef<PagerView>(null);
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  // Load reveal years when couple is available
  useEffect(() => {
    if (couple?.id) {
      loadRevealYears(couple.id);
    }
  }, [couple?.id, loadRevealYears]);

  // Check for checkpoint day when couple is available and it's not anniversary ready
  useEffect(() => {
    if (couple?.id && !isRevealReady) {
      checkToday(couple.id);
    }
  }, [couple?.id, isRevealReady, checkToday]);

  // Determine partner name (the OTHER person) based on who's logged in
  const getPartnerName = () => {
    if (!stats || !user) return '';
    return user.id === stats.partner_1_id ? stats.partner_2_name : stats.partner_1_name;
  };

  // NOTE: We removed the auto-load useEffect that was causing the reveal
  // to start automatically. Now users must always click the button to view
  // the reveal, even if they've already opened it this year.

  // Debug logging to track state changes
  useEffect(() => {
    if (DEV_TOOLS_ENABLED) {
      console.log('[Reveal] State:', {
        coupleId: couple?.id,
        isRevealReady,
        isRevealed,
        lastRevealYear: couple?.last_reveal_year,
        started,
        hasStats: !!stats,
      });
    }
  }, [couple, isRevealReady, isRevealed, started, stats]);

  const handleReplay = () => {
    reset();
    setShowEntries(false);
    setStarted(false);
    // Small delay so state clears before re-triggering
    setTimeout(async () => {
      if (!couple) return;
      const success = await loadStats(couple.id, selectedYear ?? undefined);
      if (success) {
        setStarted(true);
      }
    }, 100);
  };

  // Handler for viewing a specific year's reveal
  const handleViewYear = async (year: number) => {
    if (!couple) return;
    setShowYearPicker(false);
    setSelectedYear(year);
    reset();
    setShowEntries(false);
    const success = await loadStats(couple.id, year);
    if (success) {
      setStarted(true);
    }
  };

  // --- DEV TOOLS ---
  const handleDevForceReveal = async () => {
    if (!couple) return;
    Alert.alert(
      'Dev: Force Reveal',
      'This will set is_revealed=true, last_reveal_year=current year, and load stats. Proceed?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Force Reveal',
          onPress: async () => {
            const currentYear = new Date().getFullYear();
            await supabase
              .from('couples')
              .update({ is_revealed: true, last_reveal_year: currentYear })
              .eq('id', couple.id);
            await refreshCouple();
            const success = await loadStats(couple.id);
            if (success) setStarted(true);
          },
        },
      ]
    );
  };

  const handleDevResetReveal = async () => {
    if (!couple) return;
    Alert.alert(
      'Dev: Reset Reveal',
      'This will set is_revealed=false and clear last_reveal_year. The capsule will look like it was never opened (but will still be ready to open if the anniversary date matches today). Proceed?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            await supabase
              .from('couples')
              .update({ is_revealed: false, last_reveal_year: null })
              .eq('id', couple.id);
            reset();
            setStarted(false);
            setShowEntries(false);
            await refreshCouple();
          },
        },
      ]
    );
  };

  const handleDevSetAnniversaryToday = async () => {
    if (!couple) return;
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    await supabase.from('couples').update({ anniversary_date: dateStr }).eq('id', couple.id);
    await refreshCouple();
    Alert.alert('Dev', `Anniversary set to ${dateStr}`);
  };

  const renderDevTools = () => {
    if (!DEV_TOOLS_ENABLED || !couple) return null;
    return (
      <View
        style={[
          styles.devToolsContainer,
          {
            backgroundColor: colors.warning + '15',
            borderColor: colors.warning,
          },
        ]}
      >
        <Text style={[styles.devToolsTitle, { color: colors.warning }]}>🛠 Developer Tools</Text>
        <View style={styles.devToolsButtons}>
          <TouchableOpacity
            style={[styles.devButton, { backgroundColor: colors.accent }]}
            onPress={handleDevForceReveal}
          >
            <Text style={styles.devButtonText}>Force Reveal</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.devButton, { backgroundColor: colors.error }]}
            onPress={handleDevResetReveal}
          >
            <Text style={styles.devButtonText}>Reset Reveal</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.devButton, { backgroundColor: colors.secondary }]}
            onPress={handleDevSetAnniversaryToday}
          >
            <Text style={styles.devButtonText}>Set Anniversary Today</Text>
          </TouchableOpacity>
        </View>
        <Text style={[styles.devToolsInfo, { color: colors.textMuted }]}>
          isRevealReady: {String(isRevealReady)} | isRevealed: {String(isRevealed)} |
          last_reveal_year: {String(couple.last_reveal_year)} | started: {String(started)}
        </Text>
      </View>
    );
  };

  // Render the "Previous Years" banner at the top of the screen
  const renderPreviousYearsBanner = () => {
    if (revealYears.length === 0) return null;

    return (
      <TouchableOpacity
        style={[
          styles.previousYearsBanner,
          { backgroundColor: colors.accent + '15', borderColor: colors.accent + '30' },
        ]}
        onPress={() => setShowYearPicker(true)}
        activeOpacity={0.7}
      >
        <FontAwesome name="book" size={16} color={colors.accent} />
        <Text style={[styles.previousYearsBannerText, { color: colors.accent }]}>
          View {revealYears.length} previous year{revealYears.length !== 1 ? 's' : ''} of memories
        </Text>
        <FontAwesome name="chevron-right" size={12} color={colors.accent} />
      </TouchableOpacity>
    );
  };

  // Year picker modal
  const renderYearPickerModal = () => (
    <Modal
      visible={showYearPicker}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => setShowYearPicker(false)}
    >
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.yearPickerHeader, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => setShowYearPicker(false)}>
            <FontAwesome name="times" size={20} color={colors.textMuted} />
          </TouchableOpacity>
          <Text style={[styles.yearPickerTitle, { color: colors.text }]}>
            Previous TimeCapsules
          </Text>
          <View style={{ width: 20 }} />
        </View>
        <ScrollView contentContainerStyle={styles.yearPickerList}>
          {revealYears.map((item) => (
            <TouchableOpacity
              key={item.year}
              style={[
                styles.yearPickerItem,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
              onPress={() => handleViewYear(item.year)}
            >
              <View style={styles.yearPickerItemContent}>
                <Text style={[styles.yearPickerYear, { color: colors.text }]}>{item.year}</Text>
                <Text style={[styles.yearPickerDate, { color: colors.textSecondary }]}>
                  Opened {formatEntryDate(item.revealed_at.split('T')[0])}
                </Text>
              </View>
              <FontAwesome name="chevron-right" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );

  // Handle checkpoint reveal
  const handleCheckpointReveal = async () => {
    if (!couple) return;
    const configId = todaysCheckpoints.length > 0 ? todaysCheckpoints[0].id : undefined;
    await revealCheckpointEntry(couple.id, configId);
    setShowCheckpointEntry(true);
  };

  // Handle viewing checkpoint history
  const handleViewCheckpointHistory = async () => {
    if (!couple) return;
    await loadHistory(couple.id);
    setShowCheckpointHistory(true);
  };

  // Get the checkpoint label for display
  const getCheckpointLabel = () => {
    if (todaysCheckpoints.length > 0) {
      const checkpoint = todaysCheckpoints[0];
      return (
        checkpoint.label ||
        formatCheckpointDescription({
          id: checkpoint.id,
          couple_id: couple?.id || '',
          frequency: checkpoint.frequency,
          day_of_month: checkpoint.day_of_month,
          months: checkpoint.months,
          specific_date: checkpoint.specific_date,
          label: checkpoint.label,
          is_active: true,
          created_at: '',
        })
      );
    }
    return 'Checkpoint';
  };

  // Render checkpoint history modal
  const renderCheckpointHistoryModal = () => (
    <Modal
      visible={showCheckpointHistory}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => setShowCheckpointHistory(false)}
    >
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.yearPickerHeader, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => setShowCheckpointHistory(false)}>
            <FontAwesome name="times" size={20} color={colors.textMuted} />
          </TouchableOpacity>
          <Text style={[styles.yearPickerTitle, { color: colors.text }]}>Checkpoint History</Text>
          <View style={{ width: 20 }} />
        </View>
        <ScrollView contentContainerStyle={styles.yearPickerList}>
          {checkpointHistory.length === 0 ? (
            <Text style={[styles.emptyHistoryText, { color: colors.textMuted }]}>
              No checkpoint reveals yet
            </Text>
          ) : (
            checkpointHistory.map((item) => (
              <TouchableOpacity
                key={item.id}
                style={[
                  styles.yearPickerItem,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
                onPress={() => {
                  setSelectedEntry({
                    id: item.entry.id,
                    couple_id: couple?.id || '',
                    author_id: '',
                    title: item.entry.title,
                    content_html: '',
                    content_plain: item.entry.content_plain,
                    word_count: item.entry.word_count,
                    mood: item.entry.mood,
                    is_draft: false,
                    is_favorite: false,
                    entry_date: item.entry.entry_date,
                    location_name: item.entry.location_name,
                    location_lat: null,
                    location_lng: null,
                    created_at: '',
                    updated_at: '',
                  });
                  setShowCheckpointHistory(false);
                }}
              >
                <View style={styles.yearPickerItemContent}>
                  <Text style={[styles.checkpointHistoryTitle, { color: colors.text }]}>
                    {item.entry.title || 'Untitled'}
                  </Text>
                  <Text style={[styles.yearPickerDate, { color: colors.textSecondary }]}>
                    {item.config_label || 'Checkpoint'} - {formatShortDate(item.checkpoint_date)}
                  </Text>
                </View>
                <FontAwesome name="chevron-right" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );

  // Show checkpoint entry view
  if (showCheckpointEntry && checkpointEntry) {
    const mood = Moods.find((m) => m.key === checkpointEntry.mood);
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.checkpointEntryHeader, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => setShowCheckpointEntry(false)}>
            <FontAwesome name="chevron-left" size={18} color={colors.primary} />
          </TouchableOpacity>
          <Text style={[styles.checkpointEntryHeaderTitle, { color: colors.text }]}>
            {getCheckpointLabel()}
          </Text>
          <View style={{ width: 18 }} />
        </View>
        <ScrollView
          style={styles.checkpointEntryContent}
          contentContainerStyle={styles.checkpointEntryContentInner}
        >
          <Text style={[styles.checkpointEntryFrom, { color: colors.textSecondary }]}>
            From {partner?.display_name || 'your partner'} -{' '}
            {formatEntryDate(checkpointEntry.entry_date)}
          </Text>
          <Text style={[styles.checkpointEntryTitle, { color: colors.text }]}>
            {checkpointEntry.title || 'Untitled'}
          </Text>
          {mood && (
            <View style={[styles.checkpointMoodChip, { backgroundColor: colors.primary + '15' }]}>
              <Text style={styles.checkpointMoodEmoji}>{mood.emoji}</Text>
              <Text style={[styles.checkpointMoodLabel, { color: colors.primary }]}>
                {mood.label}
              </Text>
            </View>
          )}
          <Text style={[styles.checkpointEntryBody, { color: colors.text }]}>
            {checkpointEntry.content_plain}
          </Text>
          {checkpointEntry.location_name && (
            <View style={styles.checkpointLocation}>
              <FontAwesome name="map-marker" size={14} color={colors.primary} />
              <Text style={[styles.checkpointLocationText, { color: colors.textSecondary }]}>
                {checkpointEntry.location_name}
              </Text>
            </View>
          )}
          <Text style={[styles.checkpointWordCount, { color: colors.textMuted }]}>
            {checkpointEntry.word_count} {checkpointEntry.word_count === 1 ? 'word' : 'words'}
          </Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // Show "no entries remaining" checkpoint state
  if (showCheckpointEntry && noEntriesRemaining) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.checkpointReadyContent, styles.centered]}>
          <Animated.Text entering={ZoomIn.duration(600)} style={styles.checkpointIcon}>
            {'\u{1F4ED}'}
          </Animated.Text>
          <Animated.Text
            entering={FadeInUp.delay(400)}
            style={[styles.checkpointReadyTitle, { color: colors.text }]}
          >
            All Caught Up!
          </Animated.Text>
          <Animated.Text
            entering={FadeInUp.delay(600)}
            style={[styles.checkpointReadySubtitle, { color: colors.textSecondary }]}
          >
            You've seen all of {partner?.display_name || 'your partner'}'s entries through
            checkpoints.{'\n\n'}
            Write more together, or wait for your anniversary!
          </Animated.Text>
          <Animated.View entering={FadeInUp.delay(800)}>
            <TouchableOpacity
              style={[styles.checkpointSecondaryButton, { borderColor: colors.textMuted }]}
              onPress={() => setShowCheckpointEntry(false)}
            >
              <Text style={[styles.checkpointSecondaryButtonText, { color: colors.textSecondary }]}>
                Go Back
              </Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </SafeAreaView>
    );
  }

  // Show locked screen when it's NOT the anniversary day
  // But first check if it's a checkpoint day
  if (!couple || !isRevealReady) {
    // Checkpoint day - show checkpoint UI instead of locked
    if (isCheckpointDay && todaysCheckpoints.length > 0) {
      return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
          {renderPreviousYearsBanner()}
          <View style={[styles.checkpointReadyContent, styles.centered]}>
            <Animated.Text entering={ZoomIn.duration(600)} style={styles.checkpointIcon}>
              {'\u{1F4EC}'}
            </Animated.Text>
            <Animated.Text
              entering={FadeInUp.delay(400)}
              style={[styles.checkpointReadyTitle, { color: colors.text }]}
            >
              {getCheckpointLabel()}!
            </Animated.Text>
            <Animated.Text
              entering={FadeInUp.delay(600)}
              style={[styles.checkpointReadySubtitle, { color: colors.textSecondary }]}
            >
              Peek at one of {partner?.display_name || 'your partner'}'s entries
            </Animated.Text>
            {checkpointError && (
              <Text style={[styles.errorText, { color: colors.error }]}>{checkpointError}</Text>
            )}
            <Animated.View entering={FadeInUp.delay(800)}>
              <TouchableOpacity
                style={[styles.openButton, { backgroundColor: colors.primary }]}
                onPress={handleCheckpointReveal}
                disabled={checkpointLoading}
              >
                <Text style={styles.openButtonText}>
                  {checkpointLoading ? 'Revealing...' : 'Reveal Entry'}
                </Text>
              </TouchableOpacity>
            </Animated.View>
            <Animated.View entering={FadeInUp.delay(1000)}>
              <TouchableOpacity
                style={styles.checkpointHistoryLink}
                onPress={handleViewCheckpointHistory}
              >
                <Text style={[styles.checkpointHistoryLinkText, { color: colors.primary }]}>
                  View checkpoint history
                </Text>
                <FontAwesome name="chevron-right" size={12} color={colors.primary} />
              </TouchableOpacity>
            </Animated.View>
          </View>
          {renderYearPickerModal()}
          {renderCheckpointHistoryModal()}
          {renderDevTools()}
        </SafeAreaView>
      );
    }

    // Regular locked screen
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        {renderPreviousYearsBanner()}
        <View style={[styles.lockedContent, styles.centered]}>
          <FontAwesome name="lock" size={64} color={colors.textMuted} />
          <Text style={[styles.lockedTitle, { color: colors.text }]}>Not Yet...</Text>
          <Text style={[styles.lockedSubtitle, { color: colors.textSecondary }]}>
            Your TimeCapsule will unlock on your anniversary
          </Text>
        </View>
        {renderYearPickerModal()}
        {renderCheckpointHistoryModal()}
        {renderDevTools()}
      </SafeAreaView>
    );
  }

  if (!started) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        {renderPreviousYearsBanner()}
        <View style={[styles.readyContent, styles.centered]}>
          <Animated.View entering={ZoomIn.duration(600)} style={styles.capsuleIcon}>
            <FontAwesome name="gift" size={80} color={colors.primary} />
          </Animated.View>
          <Animated.Text
            entering={FadeInUp.delay(400)}
            style={[styles.readyTitle, { color: colors.text }]}
          >
            {isRevealed ? 'Welcome back!' : 'Your TimeCapsule is ready!'}
          </Animated.Text>
          <Animated.Text
            entering={FadeInUp.delay(600)}
            style={[styles.readySubtitle, { color: colors.textSecondary }]}
          >
            {isRevealed
              ? 'Tap to revisit your memories'
              : "Tap to reveal what you've written for each other"}
          </Animated.Text>
          {error && <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>}
          <Animated.View entering={FadeInUp.delay(800)}>
            <TouchableOpacity
              style={[styles.openButton, { backgroundColor: colors.primary }]}
              onPress={async () => {
                if (!couple) return;
                const currentYear = new Date().getFullYear();
                // If already revealed, just load stats (no edge function needed)
                const success = isRevealed
                  ? await loadStats(couple.id, currentYear)
                  : await triggerReveal(couple.id);
                if (success) setStarted(true);
              }}
              disabled={loading}
            >
              <Text style={styles.openButtonText}>
                {loading ? 'Opening...' : isRevealed ? 'View TimeCapsule' : 'Open TimeCapsule'}
              </Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
        {renderYearPickerModal()}
        {renderDevTools()}
      </SafeAreaView>
    );
  }

  if (showEntries) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.entriesHeader}>
          <View style={styles.entriesHeaderRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.entriesTitle, { color: colors.text }]}>Your Love Story</Text>
              <Text style={[styles.entriesSubtitle, { color: colors.textSecondary }]}>
                {selectedYear ? `All entries from ${selectedYear}` : 'All entries from this year'}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.replaySmallButton, { borderColor: colors.primary }]}
              onPress={handleReplay}
            >
              <FontAwesome name="refresh" size={14} color={colors.primary} />
              <Text style={[styles.replaySmallText, { color: colors.primary }]}>Replay</Text>
            </TouchableOpacity>
          </View>
        </View>
        <FlatList
          data={partnerEntries}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.entriesList}
          renderItem={({ item }) => {
            const isPartner = item.author_id !== user?.id;
            const mood = Moods.find((m) => m.key === item.mood);
            return (
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => setSelectedEntry(item)}
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
                  <Text
                    style={[
                      styles.entryAuthor,
                      { color: isPartner ? colors.partner2 : colors.partner1 },
                    ]}
                  >
                    {isPartner ? getPartnerName() : 'You'}
                  </Text>
                  {mood && (
                    <View
                      style={[
                        styles.moodChip,
                        {
                          backgroundColor: isPartner
                            ? colors.partner2 + '15'
                            : colors.partner1 + '15',
                          borderColor: isPartner ? colors.partner2 : colors.partner1,
                        },
                      ]}
                    >
                      <Text style={styles.moodChipEmoji}>{mood.emoji}</Text>
                      <Text
                        style={[
                          styles.moodChipLabel,
                          {
                            color: isPartner ? colors.partner2 : colors.partner1, // TODO: Fix font to be darker
                          },
                        ]}
                      >
                        {mood.label}
                      </Text>
                    </View>
                  )}
                  <Text style={[styles.entryDate, { color: colors.textMuted }]}>
                    {formatShortDate(item.entry_date)}
                  </Text>
                </View>
                <Text style={[styles.entryTitle, { color: colors.text }]}>
                  {item.title || 'Untitled'}
                </Text>
                <Text style={[styles.entryBody, { color: colors.textSecondary }]} numberOfLines={3}>
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
                <Text style={[styles.entryReadMore, { color: colors.primary }]}>Read more →</Text>
              </TouchableOpacity>
            );
          }}
        />

        {/* Entry Detail Modal */}
        <Modal
          visible={!!selectedEntry}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setSelectedEntry(null)}
        >
          <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
            <View style={[styles.entryModalHeader, { borderBottomColor: colors.border }]}>
              <TouchableOpacity onPress={() => setSelectedEntry(null)}>
                <FontAwesome name="chevron-left" size={18} color={colors.primary} />
              </TouchableOpacity>
              <Text style={[styles.entryModalTitle, { color: colors.text }]} numberOfLines={1}>
                {selectedEntry?.title || 'Untitled Entry'}
              </Text>
              <View style={{ width: 18 }} />
            </View>
            {selectedEntry && (
              <ScrollView
                style={styles.entryModalContent}
                contentContainerStyle={styles.entryModalContentInner}
              >
                <View style={styles.entryModalMeta}>
                  <Text style={[styles.entryModalDate, { color: colors.textMuted }]}>
                    {formatEntryDate(selectedEntry.entry_date)}
                  </Text>
                  {selectedEntry.mood && (
                    <Text style={styles.entryModalMood}>
                      {Moods.find((m) => m.key === selectedEntry.mood)?.emoji}{' '}
                      {Moods.find((m) => m.key === selectedEntry.mood)?.label}
                    </Text>
                  )}
                </View>
                {selectedEntry.location_name && (
                  <View style={[styles.entryLocation, { marginBottom: Spacing.md }]}>
                    <FontAwesome name="map-marker" size={14} color={colors.primary} />
                    <Text
                      style={[
                        styles.entryLocationText,
                        { color: colors.textSecondary, fontSize: FontSize.sm },
                      ]}
                    >
                      {selectedEntry.location_name}
                    </Text>
                  </View>
                )}
                <Text style={[styles.entryModalBody, { color: colors.text }]}>
                  {selectedEntry.content_plain}
                </Text>
                <Text style={[styles.entryModalWordCount, { color: colors.textMuted }]}>
                  {selectedEntry.word_count} {selectedEntry.word_count === 1 ? 'word' : 'words'}
                </Text>
              </ScrollView>
            )}
          </SafeAreaView>
        </Modal>
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
          <Animated.Text
            entering={FadeInDown.delay(400)}
            style={[styles.statBigNumber, { color: colors.primary }]}
          >
            {totalEntries}
          </Animated.Text>
          <Animated.Text
            entering={FadeInDown.delay(600)}
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
          <Animated.Text entering={FadeInDown.delay(200)} style={styles.statEmoji}>
            💬
          </Animated.Text>
          <Animated.Text
            entering={FadeInDown.delay(400)}
            style={[styles.statBigNumber, { color: colors.primary }]}
          >
            {totalWords.toLocaleString()}
          </Animated.Text>
          <Animated.Text
            entering={FadeInDown.delay(600)}
            style={[styles.statCaption, { color: colors.text }]}
          >
            words of love — that's longer than{'\n'}
            {bookComparison}
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
          <Animated.Text
            entering={FadeInDown.delay(400)}
            style={[styles.slideTitle, { color: colors.text }]}
          >
            Night Owl vs Early Bird
          </Animated.Text>
          <Animated.View entering={FadeInDown.delay(600)}>
            <Text style={[styles.timeText, { color: colors.partner1 }]}>
              {stats.partner_1_name} mostly wrote{' '}
              {getTimeLabel(Math.round(stats.partner_1_avg_hour))}
            </Text>
            <Text style={[styles.timeText, { color: colors.partner2 }]}>
              {stats.partner_2_name} mostly wrote{' '}
              {getTimeLabel(Math.round(stats.partner_2_avg_hour))}
            </Text>
          </Animated.View>
        </StatSlide>
      </View>

      {/* Slide 6: Most Active Month */}
      <View key="6">
        <StatSlide colors={colors}>
          <Animated.Text entering={FadeInDown.delay(200)} style={styles.statEmoji}>
            📅
          </Animated.Text>
          <Animated.Text
            entering={FadeInDown.delay(400)}
            style={[styles.statCaption, { color: colors.text }]}
          >
            Your love peaked in
          </Animated.Text>
          <Animated.Text
            entering={FadeInDown.delay(600)}
            style={[styles.statBigText, { color: colors.primary }]}
          >
            {stats.most_active_month?.trim()}
          </Animated.Text>
          <Animated.Text
            entering={FadeInDown.delay(800)}
            style={[styles.statSubCaption, { color: colors.textSecondary }]}
          >
            with {stats.most_active_month_count} entries
          </Animated.Text>
        </StatSlide>
      </View>

      {/* Slide 7: Longest Entry */}
      <View key="7">
        <StatSlide colors={colors}>
          <Animated.Text entering={FadeInDown.delay(200)} style={styles.statEmoji}>
            📜
          </Animated.Text>
          <Animated.Text
            entering={FadeInDown.delay(400)}
            style={[styles.slideTitle, { color: colors.text }]}
          >
            Longest Love Letter
          </Animated.Text>
          <Animated.Text
            entering={FadeInDown.delay(600)}
            style={[styles.statBigNumber, { color: colors.primary }]}
          >
            {stats.longest_entry_words.toLocaleString()}
          </Animated.Text>
          <Animated.Text
            entering={FadeInDown.delay(700)}
            style={[styles.statCaption, { color: colors.text }]}
          >
            words on {stats.longest_entry_date ? formatShortDate(stats.longest_entry_date) : ''}
          </Animated.Text>
          <Animated.Text
            entering={FadeInDown.delay(800)}
            style={[styles.statSubCaption, { color: colors.textSecondary }]}
          >
            Written by{' '}
            {stats.longest_entry_author_id === stats.partner_1_id
              ? stats.partner_1_name
              : stats.partner_2_name}
          </Animated.Text>
        </StatSlide>
      </View>

      {/* Slide 8: Longest Streak */}
      <View key="8">
        <StatSlide colors={colors}>
          <Animated.Text entering={FadeInDown.delay(200)} style={styles.statEmoji}>
            🔥
          </Animated.Text>
          <Animated.Text
            entering={FadeInDown.delay(400)}
            style={[styles.slideTitle, { color: colors.text }]}
          >
            Longest Writing Streak
          </Animated.Text>
          <Animated.View entering={FadeInDown.delay(600)}>
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

      {/* Slide 9: Photos & Videos */}
      <View key="9">
        <StatSlide colors={colors}>
          <Animated.Text entering={FadeInDown.delay(200)} style={styles.statEmoji}>
            📸
          </Animated.Text>
          <Animated.Text
            entering={FadeInDown.delay(400)}
            style={[styles.slideTitle, { color: colors.text }]}
          >
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
          <Animated.Text
            entering={FadeInDown.delay(200)}
            style={[styles.slideTitle, { color: colors.text }]}
          >
            Your Go-To Moods
          </Animated.Text>
          <Animated.View entering={FadeInDown.delay(500)} style={styles.moodDisplay}>
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
          <Animated.Text entering={FadeInDown.delay(200)} style={styles.statEmoji}>
            📆
          </Animated.Text>
          <Animated.Text
            entering={FadeInDown.delay(400)}
            style={[styles.slideTitle, { color: colors.text }]}
          >
            Your Journey
          </Animated.Text>
          <Animated.View entering={FadeInDown.delay(600)} style={styles.journeyContainer}>
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
            entering={FadeInDown.delay(200)}
            style={[styles.slideTitle, { color: colors.text }]}
          >
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
          <Animated.Text
            entering={FadeInDown.delay(200)}
            style={[styles.slideTitle, { color: colors.text }]}
          >
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
                    pinColor={
                      loc.author_id === stats.partner_1_id ? colors.partner1 : colors.partner2
                    }
                  />
                ))}
              </MapView>
              <Text style={[styles.mapCaption, { color: colors.textSecondary }]}>
                You made memories in {stats.unique_location_count} different{' '}
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
          <Animated.Text entering={FadeInDown.delay(200)} style={styles.statEmoji}>
            💌
          </Animated.Text>
          <Animated.Text
            entering={FadeInDown.delay(400)}
            style={[styles.readyTitle, { color: colors.text }]}
          >
            Now, read what {getPartnerName()} wrote for you...
          </Animated.Text>
          <Animated.View entering={FadeInUp.delay(800)} style={styles.outroButtons}>
            <TouchableOpacity
              style={[styles.openButton, { backgroundColor: colors.primary }]}
              onPress={async () => {
                await fetchPartnerEntries(couple.id, selectedYear ?? undefined);
                setShowEntries(true);
              }}
            >
              <Text style={styles.openButtonText}>Read Their Entries</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.replayButton, { borderColor: colors.textMuted }]}
              onPress={handleReplay}
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
  errorText: {
    fontSize: FontSize.sm,
    textAlign: 'center',
    marginBottom: Spacing.md,
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
  moodChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
  },
  moodContainer: {
    gap: Spacing.sm,
  },
  moodChipEmoji: {
    fontSize: 12,
  },
  moodChipLabel: {
    fontSize: FontSize.xs,
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
  dateContainer: {
    justifyContent: 'space-between',
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
  entryReadMore: {
    fontSize: FontSize.sm,
    fontWeight: '500',
    marginTop: Spacing.sm,
  },
  entriesHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  replaySmallButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
  },
  replaySmallText: {
    fontSize: FontSize.sm,
    fontWeight: '500',
  },
  // Dev tools
  devToolsContainer: {
    position: 'absolute',
    bottom: 40,
    left: Spacing.md,
    right: Spacing.md,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  devToolsTitle: {
    fontSize: FontSize.sm,
    fontWeight: '700',
    marginBottom: Spacing.sm,
    textAlign: 'center',
  },
  devToolsButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    justifyContent: 'center',
  },
  devButton: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.sm,
  },
  devButtonText: {
    color: '#fff',
    fontSize: FontSize.xs,
    fontWeight: '600',
  },
  devToolsInfo: {
    fontSize: 10,
    textAlign: 'center',
    marginTop: Spacing.sm,
  },
  // Entry detail modal
  entryModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.md,
    borderBottomWidth: 1,
  },
  entryModalTitle: {
    fontSize: FontSize.lg,
    fontWeight: '600',
    flex: 1,
    textAlign: 'center',
    marginHorizontal: Spacing.sm,
  },
  entryModalContent: {
    flex: 1,
  },
  entryModalContentInner: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },
  entryModalMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  entryModalDate: {
    fontSize: FontSize.sm,
  },
  entryModalMood: {
    fontSize: FontSize.sm,
  },
  entryModalBody: {
    fontSize: FontSize.md,
    lineHeight: 26,
    marginBottom: Spacing.lg,
  },
  entryModalWordCount: {
    fontSize: FontSize.xs,
  },
  // Locked/ready content wrapper
  lockedContent: {
    flex: 1,
  },
  readyContent: {
    flex: 1,
  },
  // Previous years banner (top of screen)
  previousYearsBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  previousYearsBannerText: {
    fontSize: FontSize.sm,
    fontWeight: '600',
  },
  // Year picker modal
  yearPickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.md,
    borderBottomWidth: 1,
  },
  yearPickerTitle: {
    fontSize: FontSize.lg,
    fontWeight: '600',
  },
  yearPickerList: {
    padding: Spacing.md,
  },
  yearPickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    marginBottom: Spacing.sm,
  },
  yearPickerItemContent: {
    flex: 1,
  },
  yearPickerYear: {
    fontSize: FontSize.xl,
    fontWeight: '700',
  },
  yearPickerDate: {
    fontSize: FontSize.sm,
    marginTop: 2,
  },
  // Checkpoint styles
  checkpointReadyContent: {
    flex: 1,
  },
  checkpointIcon: {
    fontSize: 80,
    marginBottom: Spacing.lg,
  },
  checkpointReadyTitle: {
    fontSize: FontSize.xxl,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  checkpointReadySubtitle: {
    fontSize: FontSize.md,
    textAlign: 'center',
    marginBottom: Spacing.xl,
    paddingHorizontal: Spacing.lg,
  },
  checkpointHistoryLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.lg,
  },
  checkpointHistoryLinkText: {
    fontSize: FontSize.md,
    fontWeight: '500',
  },
  checkpointSecondaryButton: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  checkpointSecondaryButtonText: {
    fontSize: FontSize.md,
    fontWeight: '500',
  },
  checkpointEntryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.md,
    borderBottomWidth: 1,
  },
  checkpointEntryHeaderTitle: {
    fontSize: FontSize.lg,
    fontWeight: '600',
  },
  checkpointEntryContent: {
    flex: 1,
  },
  checkpointEntryContentInner: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },
  checkpointEntryFrom: {
    fontSize: FontSize.sm,
    marginBottom: Spacing.md,
  },
  checkpointEntryTitle: {
    fontSize: FontSize.xxl,
    fontWeight: '700',
    marginBottom: Spacing.md,
  },
  checkpointMoodChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
    marginBottom: Spacing.lg,
  },
  checkpointMoodEmoji: {
    fontSize: FontSize.md,
  },
  checkpointMoodLabel: {
    fontSize: FontSize.sm,
    fontWeight: '500',
  },
  checkpointEntryBody: {
    fontSize: FontSize.md,
    lineHeight: 26,
    marginBottom: Spacing.lg,
  },
  checkpointLocation: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginBottom: Spacing.md,
  },
  checkpointLocationText: {
    fontSize: FontSize.sm,
  },
  checkpointWordCount: {
    fontSize: FontSize.xs,
  },
  emptyHistoryText: {
    fontSize: FontSize.md,
    textAlign: 'center',
    paddingVertical: Spacing.xl,
  },
  checkpointHistoryTitle: {
    fontSize: FontSize.md,
    fontWeight: '600',
  },
});
