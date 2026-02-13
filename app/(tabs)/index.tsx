import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, useColorScheme } from 'react-native';
import { useRouter } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useAuth } from '../../src/providers/AuthProvider';
import { useCouple } from '../../src/providers/CoupleProvider';
import { useEntries } from '../../src/hooks/useEntries';
import { supabase } from '../../src/lib/supabase';
import { Colors, Spacing, FontSize, BorderRadius } from '../../src/constants/theme';

export default function HomeScreen() {
  const { profile } = useAuth();
  const {
    couple,
    partner,
    daysUntilAnniversary,
    isRevealReady,
    loading: coupleLoading,
  } = useCouple();
  const { entries, loading: entriesLoading } = useEntries(couple?.id);
  const [partnerEntryCount, setPartnerEntryCount] = useState<number>(0);
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  useEffect(() => {
    if (couple?.id) {
      supabase.rpc('get_partner_entry_count', { p_couple_id: couple.id }).then(({ data }) => {
        if (data !== null) setPartnerEntryCount(data);
      });
    }
  }, [couple?.id]);

  const publishedEntries = entries.filter((e) => !e.is_draft);
  const totalWords = publishedEntries.reduce((sum, e) => sum + e.word_count, 0);

  if (coupleLoading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading...</Text>
      </View>
    );
  }

  if (!couple) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.centered}>
          <FontAwesome name="heart" size={64} color={colors.primary} />
          <Text style={[styles.welcomeTitle, { color: colors.text }]}>Welcome to TimeCapsule</Text>
          <Text style={[styles.welcomeSubtitle, { color: colors.textSecondary }]}>
            Connect with your partner to start writing diary entries for each other
          </Text>
          <TouchableOpacity
            style={[styles.ctaButton, { backgroundColor: colors.primary }]}
            onPress={() => router.push('/(tabs)/settings')}
          >
            <Text style={styles.ctaButtonText}>Get Started</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.scrollContent}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.greeting, { color: colors.textSecondary }]}>
          Hello, {profile?.display_name}
        </Text>
        {partner && (
          <Text style={[styles.partnerInfo, { color: colors.textMuted }]}>
            Paired with {partner.display_name}
          </Text>
        )}
      </View>

      {/* Anniversary Countdown */}
      {daysUntilAnniversary !== null && (
        <View
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <View style={styles.countdownContent}>
            <Text style={[styles.countdownNumber, { color: colors.primary }]}>
              {daysUntilAnniversary}
            </Text>
            <Text style={[styles.countdownLabel, { color: colors.textSecondary }]}>
              {daysUntilAnniversary === 1 ? 'day' : 'days'} until your anniversary
            </Text>
          </View>
        </View>
      )}

      {/* Reveal Button */}
      {isRevealReady && (
        <TouchableOpacity
          style={[styles.revealButton, { backgroundColor: colors.primary }]}
          onPress={() => router.push('/(tabs)/reveal')}
        >
          <FontAwesome name="gift" size={24} color="#fff" />
          <Text style={styles.revealButtonText}>Open Your TimeCapsule!</Text>
        </TouchableOpacity>
      )}

      {/* Your Stats */}
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>Your Diary</Text>
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={[styles.statNumber, { color: colors.primary }]}>
              {publishedEntries.length}
            </Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>entries</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statNumber, { color: colors.primary }]}>
              {totalWords.toLocaleString()}
            </Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>words</Text>
          </View>
        </View>
      </View>

      {/* Partner Teaser */}
      {partner && (
        <View
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Text style={[styles.cardTitle, { color: colors.text }]}>
            {partner.display_name}'s Diary
          </Text>
          <Text style={[styles.partnerTeaser, { color: colors.textSecondary }]}>
            {partnerEntryCount === 0
              ? 'No entries yet'
              : `${partnerEntryCount} ${partnerEntryCount === 1 ? 'entry' : 'entries'} waiting for you`}
          </Text>
          <Text style={[styles.teaserHint, { color: colors.textMuted }]}>
            You'll get to read them on your anniversary
          </Text>
        </View>
      )}

      {/* Write Entry CTA */}
      <TouchableOpacity
        style={[styles.writeButton, { backgroundColor: colors.primary }]}
        onPress={() => {
          // Navigate to entries tab first, then push the new entry modal.
          // Using router.navigate ensures the entries stack is properly initialized
          // before pushing the modal, avoiding POP errors when the Diary tab
          // hasn't been visited yet.
          router.navigate('/(tabs)/entries');
          setTimeout(() => router.push('/(tabs)/entries/new'), 0);
        }}
      >
        <FontAwesome name="pencil" size={20} color="#fff" />
        <Text style={styles.writeButtonText}>Write a New Entry</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
  },
  loadingText: {
    fontSize: FontSize.md,
    textAlign: 'center',
    marginTop: Spacing.xxl,
  },
  welcomeTitle: {
    fontSize: FontSize.xxl,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  welcomeSubtitle: {
    fontSize: FontSize.md,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: Spacing.xl,
  },
  ctaButton: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  ctaButtonText: {
    color: '#fff',
    fontSize: FontSize.lg,
    fontWeight: '600',
  },
  header: {
    marginBottom: Spacing.lg,
  },
  greeting: {
    fontSize: FontSize.xl,
    fontWeight: '600',
  },
  partnerInfo: {
    fontSize: FontSize.sm,
    marginTop: Spacing.xs,
  },
  card: {
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
    borderWidth: 1,
  },
  cardTitle: {
    fontSize: FontSize.lg,
    fontWeight: '600',
    marginBottom: Spacing.md,
  },
  countdownContent: {
    alignItems: 'center',
  },
  countdownNumber: {
    fontSize: 64,
    fontWeight: '700',
  },
  countdownLabel: {
    fontSize: FontSize.md,
    marginTop: Spacing.xs,
  },
  revealButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    padding: Spacing.lg,
    borderRadius: BorderRadius.lg,
    marginBottom: Spacing.md,
  },
  revealButtonText: {
    color: '#fff',
    fontSize: FontSize.lg,
    fontWeight: '700',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  statItem: {
    alignItems: 'center',
  },
  statNumber: {
    fontSize: FontSize.xxl,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: FontSize.sm,
    marginTop: Spacing.xs,
  },
  partnerTeaser: {
    fontSize: FontSize.lg,
    fontWeight: '500',
  },
  teaserHint: {
    fontSize: FontSize.sm,
    marginTop: Spacing.xs,
  },
  writeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    height: 52,
    borderRadius: BorderRadius.md,
    marginTop: Spacing.sm,
  },
  writeButtonText: {
    color: '#fff',
    fontSize: FontSize.lg,
    fontWeight: '600',
  },
});
