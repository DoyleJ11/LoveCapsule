import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Alert,
  Platform,
  SafeAreaView,
} from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeInUp, ZoomIn } from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCouple } from '../providers/CoupleProvider';
import { supabase } from '../lib/supabase';
import {
  shouldShowValentine,
  VALENTINE_STORAGE_KEY,
  VALENTINE_LETTER_PARAGRAPHS,
} from '../lib/valentine';
import { Spacing, BorderRadius, FontSize } from '../constants/theme';

type ValentineStep = 'hidden' | 'envelope' | 'letter' | 'sweet_treat';

export function ValentineSurprise() {
  const { couple } = useCouple();
  const [step, setStep] = useState<ValentineStep>('hidden');
  const [completed, setCompleted] = useState<boolean | null>(null); // null = still loading

  // 1. Load completion state from AsyncStorage on mount.
  //    Once loaded, if the surprise should trigger we move to 'envelope'.
  useEffect(() => {
    AsyncStorage.getItem(VALENTINE_STORAGE_KEY).then((val) => {
      const done = val === 'true';
      setCompleted(done);
      if (!done && shouldShowValentine(couple, false, __DEV__)) {
        setStep('envelope');
      }
    });
    // couple is read inside the async callback; we only run this once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2. Once completed state is loaded, watch for couple changes that could
  //    satisfy the trigger (e.g. couple data finishes loading after the
  //    initial AsyncStorage check).
  const coupleId = couple?.id;

  useEffect(() => {
    if (completed !== false || !couple) return;
    setStep((current) => {
      if (current !== 'hidden') return current;
      return shouldShowValentine(couple, false, __DEV__) ? 'envelope' : current;
    });
  }, [completed, couple, coupleId]);

  // 3. Periodic time-based check (for the case where the app is open and
  //    6 PM rolls around). Time is an external system, so polling in a
  //    setInterval callback is the correct pattern.
  useEffect(() => {
    if (completed !== false) return;

    const interval = setInterval(() => {
      setStep((current) => {
        if (current !== 'hidden') return current;
        if (shouldShowValentine(couple, false, __DEV__)) return 'envelope';
        return current;
      });
    }, 60_000);

    return () => clearInterval(interval);
  }, [completed, couple]);

  // 4. Real-time subscription for remote trigger
  useEffect(() => {
    if (!coupleId || completed !== false) return;

    const channel = supabase
      .channel(`valentine-${coupleId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'couples',
          filter: `id=eq.${coupleId}`,
        },
        (payload) => {
          const newRow = payload.new as { valentine_surprise_triggered?: boolean };
          if (newRow.valentine_surprise_triggered) {
            setStep((current) => (current === 'hidden' ? 'envelope' : current));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [coupleId, completed]);

  // 4. Handle final completion
  const handleComplete = async () => {
    await AsyncStorage.setItem(VALENTINE_STORAGE_KEY, 'true');
    setCompleted(true);
    setStep('hidden');
  };

  // 5. Handle "No" press → native alert with joke options
  const handleNo = () => {
    Alert.alert('Are you sure? 🥺', undefined, [
      { text: 'On second thought, I can\u2019t say no to Tunk', style: 'cancel' },
      { text: 'Actually... go back', style: 'default' },
    ]);
  };

  // Don't render anything while loading or if completed
  if (completed !== false || step === 'hidden') return null;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent>
      {step === 'envelope' && <EnvelopeStep onOpen={() => setStep('letter')} />}
      {step === 'letter' && <LetterStep onYes={() => setStep('sweet_treat')} onNo={handleNo} />}
      {step === 'sweet_treat' && <SweetTreatStep onClose={handleComplete} />}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Step 1: Envelope
// ---------------------------------------------------------------------------

function EnvelopeStep({ onOpen }: { onOpen: () => void }) {
  return (
    <View style={styles.overlay}>
      <View style={styles.envelopeCard}>
        <Animated.Text entering={ZoomIn.duration(600)} style={styles.envelopeEmoji}>
          💌
        </Animated.Text>
        <Animated.Text entering={FadeInUp.delay(400).duration(500)} style={styles.envelopeText}>
          I've got a question for you...
        </Animated.Text>
        <Animated.View entering={FadeInUp.delay(800).duration(500)}>
          <TouchableOpacity style={styles.openButton} onPress={onOpen} activeOpacity={0.8}>
            <Text style={styles.openButtonText}>Open</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Step 2: Letter
// ---------------------------------------------------------------------------

function LetterStep({ onYes, onNo }: { onYes: () => void; onNo: () => void }) {
  return (
    <Animated.View entering={FadeIn.duration(500)} style={styles.letterOverlay}>
      <SafeAreaView style={styles.letterSafeArea}>
        <ScrollView
          style={styles.letterScroll}
          contentContainerStyle={styles.letterScrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View entering={FadeInDown.delay(300).duration(600)} style={styles.letterCard}>
            {/* Decorative top line */}
            <View style={styles.letterDivider} />

            {VALENTINE_LETTER_PARAGRAPHS.map((paragraph, index) => (
              <Text key={index} style={styles.letterParagraph}>
                {paragraph}
              </Text>
            ))}

            {/* Valentine question */}
            <View style={styles.letterDivider} />
            <Animated.Text
              entering={FadeInUp.delay(600).duration(500)}
              style={styles.valentineQuestion}
            >
              Will you be my Valentine?
            </Animated.Text>

            {/* Buttons */}
            <Animated.View
              entering={FadeInUp.delay(800).duration(500)}
              style={styles.letterButtons}
            >
              <TouchableOpacity style={styles.yesButton} onPress={onYes} activeOpacity={0.8}>
                <Text style={styles.yesButtonText}>Yes</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.noButton} onPress={onNo} activeOpacity={0.8}>
                <Text style={styles.noButtonText}>No</Text>
              </TouchableOpacity>
            </Animated.View>
          </Animated.View>
        </ScrollView>
      </SafeAreaView>
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Step 3: Sweet Treat
// ---------------------------------------------------------------------------

function SweetTreatStep({ onClose }: { onClose: () => void }) {
  return (
    <View style={styles.overlay}>
      <View style={styles.sweetTreatCard}>
        <Animated.Text entering={ZoomIn.springify()} style={styles.sweetTreatEmoji}>
          🍪
        </Animated.Text>
        <Animated.Text
          entering={FadeInDown.delay(400).duration(500)}
          style={styles.sweetTreatTitle}
        >
          Time for a sweet treat!
        </Animated.Text>
        <Animated.Text
          entering={FadeInDown.delay(600).duration(500)}
          style={styles.sweetTreatSubtitle}
        >
          Happy Valentine's Day ❤️
        </Animated.Text>
        <Animated.View entering={FadeInUp.delay(900).duration(500)}>
          <TouchableOpacity style={styles.closeButton} onPress={onClose} activeOpacity={0.8}>
            <Text style={styles.closeButtonText}>Close</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const SERIF_FONT = Platform.select({ ios: 'Georgia', default: 'serif' });
const PAPER_BG = '#faf3e3';
const INK_COLOR = '#4a3728';
const ACCENT = '#e07a5f';

const styles = StyleSheet.create({
  // Shared overlay backdrop
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
  },

  // ---- Envelope step ----
  envelopeCard: {
    backgroundColor: PAPER_BG,
    borderRadius: BorderRadius.xl,
    padding: Spacing.xxl,
    alignItems: 'center',
    width: '90%',
    maxWidth: 340,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },
  envelopeEmoji: {
    fontSize: 72,
    marginBottom: Spacing.lg,
  },
  envelopeText: {
    fontFamily: SERIF_FONT,
    fontSize: FontSize.xl,
    fontStyle: 'italic',
    color: INK_COLOR,
    textAlign: 'center',
    marginBottom: Spacing.xl,
    lineHeight: 30,
  },
  openButton: {
    backgroundColor: ACCENT,
    paddingHorizontal: Spacing.xxl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  openButtonText: {
    color: '#fff',
    fontSize: FontSize.lg,
    fontWeight: '600',
  },

  // ---- Letter step ----
  letterOverlay: {
    flex: 1,
    backgroundColor: PAPER_BG,
  },
  letterSafeArea: {
    flex: 1,
  },
  letterScroll: {
    flex: 1,
  },
  letterScrollContent: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },
  letterCard: {
    backgroundColor: PAPER_BG,
    borderWidth: 1,
    borderColor: '#d4c5a9',
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  letterDivider: {
    height: 1,
    backgroundColor: '#d4c5a9',
    marginVertical: Spacing.lg,
  },
  letterParagraph: {
    fontFamily: SERIF_FONT,
    fontSize: 17,
    lineHeight: 28,
    color: INK_COLOR,
    marginBottom: Spacing.lg,
  },
  valentineQuestion: {
    fontFamily: SERIF_FONT,
    fontSize: 24,
    fontWeight: '600',
    color: INK_COLOR,
    textAlign: 'center',
    marginTop: Spacing.sm,
    marginBottom: Spacing.xl,
    lineHeight: 32,
  },
  letterButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.md,
  },
  yesButton: {
    backgroundColor: ACCENT,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    minWidth: 100,
    alignItems: 'center',
  },
  yesButtonText: {
    color: '#fff',
    fontSize: FontSize.lg,
    fontWeight: '600',
  },
  noButton: {
    backgroundColor: 'transparent',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: '#b8a898',
    minWidth: 100,
    alignItems: 'center',
  },
  noButtonText: {
    color: '#b8a898',
    fontSize: FontSize.lg,
    fontWeight: '500',
  },

  // ---- Sweet treat step ----
  sweetTreatCard: {
    backgroundColor: PAPER_BG,
    borderRadius: BorderRadius.xl,
    padding: Spacing.xxl,
    alignItems: 'center',
    width: '90%',
    maxWidth: 340,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },
  sweetTreatEmoji: {
    fontSize: 72,
    marginBottom: Spacing.lg,
  },
  sweetTreatTitle: {
    fontFamily: SERIF_FONT,
    fontSize: FontSize.xxl,
    fontWeight: '600',
    color: INK_COLOR,
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  sweetTreatSubtitle: {
    fontFamily: SERIF_FONT,
    fontSize: FontSize.lg,
    color: INK_COLOR,
    textAlign: 'center',
    marginBottom: Spacing.xl,
  },
  closeButton: {
    backgroundColor: ACCENT,
    paddingHorizontal: Spacing.xxl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  closeButtonText: {
    color: '#fff',
    fontSize: FontSize.lg,
    fontWeight: '600',
  },
});
