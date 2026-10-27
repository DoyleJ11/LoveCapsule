import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  Image,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Keyboard,
  Platform,
  useColorScheme,
  ActionSheetIOS,
  ActivityIndicator,
  AppState,
  Button as NativeButton,
} from 'react-native';
import {
  KeyboardAwareScrollView,
  KeyboardStickyView,
  useKeyboardState,
} from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, IconButton } from '../../../src/components/Button';
import { useRouter, useNavigation, useLocalSearchParams } from 'expo-router';
import { usePreventRemove } from '@react-navigation/native';
import { uuid } from 'expo-modules-core';
import { encryptedStorage } from '../../../src/lib/secure-storage';
import { format } from 'date-fns';
import DateTimePicker from '@react-native-community/datetimepicker';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as ImagePicker from 'expo-image-picker';
import { useCouple } from '../../../src/providers/CoupleProvider';
import { useAuth } from '../../../src/providers/AuthProvider';
import type { CreateEntryInput } from '../../../src/hooks/useEntries';
import { loadEditableEntry, saveEntry } from '../../../src/features/entries/api';
import { entryContent } from '../../../src/features/entries/content';
import { createDraftStore, draftKey, type EntryDraft } from '../../../src/features/entries/drafts';
import { keepDraftFile, removeDraftFiles } from '../../../src/features/entries/files';
import type { PendingAttachment, SavePlan } from '../../../src/features/entries/save-workflow';
import { entryEvents } from '../../../src/lib/entryEvents';
import { errorMessage } from '../../../src/lib/errors';
import { getSignedUrl } from '../../../src/lib/storage';
import type { Media } from '../../../src/types/database';
import { useVoiceMemo } from '../../../src/hooks/useVoiceMemo';
import { getCurrentDateString, formatEntryDate, formatDuration } from '../../../src/lib/date-utils';
import { compressImage } from '../../../src/lib/storage';
import { LocationSheet } from '../../../src/features/entries/LocationSheet';
import {
  Colors,
  Spacing,
  FontSize,
  BorderRadius,
  Moods,
  type MoodKey,
} from '../../../src/constants/theme';

type DraftImage = ImagePicker.ImagePickerAsset & { draftId: string };

export default function NewEntryScreen() {
  const { user } = useAuth();
  const { couple } = useCouple();
  const { entryId } = useLocalSearchParams<{ entryId?: string }>();
  return <EntryEditor key={`${user?.id}:${couple?.id}:${entryId ?? 'new'}`} />;
}

function EntryEditor() {
  const { entryId } = useLocalSearchParams<{ entryId?: string }>();
  const isEditMode = !!entryId;
  const { couple } = useCouple();
  const { user } = useAuth();
  const userId = user?.id;
  const coupleId = couple?.id;
  const router = useRouter();
  const navigation = useNavigation();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [mood, setMood] = useState<MoodKey | null>(null);
  const [entryDate, setEntryDate] = useState(getCurrentDateString());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [locationName, setLocationName] = useState<string | null>(null);
  const [locationLat, setLocationLat] = useState<number | null>(null);
  const [locationLng, setLocationLng] = useState<number | null>(null);
  const [pendingImages, setPendingImages] = useState<DraftImage[]>([]);
  const [pendingVoiceMemo, setPendingVoiceMemo] = useState<{
    id: string;
    uri: string;
    durationMs: number;
  } | null>(null);
  const [existingImages, setExistingImages] = useState<(Media & { signedUrl?: string })[]>([]);
  const [imagesToDelete, setImagesToDelete] = useState<Media[]>([]);
  const [existingVoiceMemo, setExistingVoiceMemo] = useState<
    (Media & { signedUrl?: string }) | null
  >(null);
  const [deleteExistingVoiceMemo, setDeleteExistingVoiceMemo] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const stagingRef = useRef(false);
  const [staging, setStaging] = useState(false);
  const savedSuccessfully = useRef(false);
  const [loadingEntry, setLoadingEntry] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [draftEntryId, setDraftEntryId] = useState(() => entryId ?? uuid.v4());
  const expectedVersion = useRef<string | null>(null);
  const originalDraftStatus = useRef(true);
  const baseline = useRef('');
  const [pendingSave, setPendingSave] = useState<SavePlan | null>(null);
  const pendingSaveRef = useRef<SavePlan | null>(null);
  const snapshotRef = useRef<EntryDraft | null>(null);
  const recordingSaved = useRef<(uri: string, ms: number) => Promise<string | void>>(
    async () => {}
  );
  const voiceMemo = useVoiceMemo((uri, ms) => recordingSaved.current(uri, ms));
  const key = user && couple ? draftKey(user.id, couple.id, entryId) : null;
  const store = useMemo(() => (key ? createDraftStore(encryptedStorage, key) : null), [key]);
  const [allowExit, setAllowExit] = useState(false);
  const exitAction = useRef<(() => void) | null>(null);
  const [locationSearchVisible, setLocationSearchVisible] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);
  const insets = useSafeAreaInsets();
  const [footerHeight, setFooterHeight] = useState(72);
  const keyboardVisible = useKeyboardState((state) => state.isVisible);
  const footerInset = keyboardVisible ? Spacing.sm : Math.max(insets.bottom, Spacing.sm);
  const keyboardFooterHeight = Math.max(0, footerHeight - footerInset);

  const navigateAway = useCallback(() => {
    const state = navigation.getState();
    if ((state?.routes.length ?? 0) > 1) router.dismiss();
    else router.navigate('/(tabs)/entries');
  }, [navigation, router]);

  useEffect(() => {
    if (!userId || !coupleId || !store) return;
    let cancelled = false;
    setLoadingEntry(true);
    setLoadError(null);
    snapshotRef.current = null;
    savedSuccessfully.current = false;
    const load = async () => {
      try {
        const loaded = entryId ? await loadEditableEntry(entryId, userId, coupleId) : null;
        const draft = await store.load(userId, coupleId);
        if (cancelled) return;
        const blank: CreateEntryInput = {
          couple_id: coupleId,
          title: '',
          ...entryContent(''),
          mood: null,
          is_draft: true,
          entry_date: getCurrentDateString(),
          location_name: null,
          location_lat: null,
          location_lng: null,
        };
        const initial = loaded?.entry ?? blank;
        baseline.current = JSON.stringify({
          title: initial.title,
          content: initial.content_plain,
          mood: initial.mood,
          entryDate: initial.entry_date,
          locationName: initial.location_name,
          locationLat: initial.location_lat,
          locationLng: initial.location_lng,
        });
        const fields = draft?.pendingSave?.fields ?? draft?.fields ?? initial;
        setTitle(fields.title);
        setContent(fields.content_plain);
        setMood(fields.mood as MoodKey | null);
        setEntryDate(fields.entry_date);
        setLocationName(fields.location_name);
        setLocationLat(fields.location_lat);
        setLocationLng(fields.location_lng);
        setDraftEntryId(draft?.entryId ?? entryId ?? uuid.v4());
        expectedVersion.current = draft
          ? draft.expectedUpdatedAt
          : (loaded?.entry.updated_at ?? null);
        originalDraftStatus.current = loaded?.entry.is_draft ?? true;
        pendingSaveRef.current = draft?.pendingSave ?? null;
        setPendingSave(pendingSaveRef.current);
        const attachments = draft?.attachments ?? [];
        setPendingImages(
          attachments
            .filter((a) => a.media_type === 'image')
            .map((a) => ({
              uri: a.uri,
              width: a.width ?? 0,
              height: a.height ?? 0,
              draftId: a.id,
            }))
        );
        const audio = attachments.find((a) => a.media_type === 'audio');
        setPendingVoiceMemo(
          audio ? { id: audio.id, uri: audio.uri, durationMs: audio.duration_ms ?? 0 } : null
        );
        const removed = draft?.removeMediaIds ?? [];
        const media = await Promise.all(
          (loaded?.media ?? []).map(async (m: Media) => {
            try {
              return { ...m, signedUrl: await getSignedUrl(m.storage_path) };
            } catch {
              return m;
            }
          })
        );
        if (cancelled) return;
        setExistingImages(media.filter((m) => m.media_type === 'image' && !removed.includes(m.id)));
        setImagesToDelete(media.filter((m) => m.media_type === 'image' && removed.includes(m.id)));
        const existingAudio = media.find((m) => m.media_type === 'audio') ?? null;
        setExistingVoiceMemo(existingAudio);
        setDeleteExistingVoiceMemo(!!existingAudio && removed.includes(existingAudio.id));
      } catch (error) {
        if (!cancelled) setLoadError(errorMessage(error));
      } finally {
        if (!cancelled) setLoadingEntry(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [userId, coupleId, store, entryId, reload]);

  const attachments: PendingAttachment[] = pendingImages.map((a) => ({
    id: a.draftId,
    uri: a.uri,
    media_type: 'image',
    mime_type: 'image/jpeg',
    width: a.width,
    height: a.height,
  }));
  if (pendingVoiceMemo)
    attachments.push({
      id: pendingVoiceMemo.id,
      uri: pendingVoiceMemo.uri,
      media_type: 'audio',
      mime_type: 'audio/mp4',
      duration_ms: pendingVoiceMemo.durationMs,
    });
  const fields: CreateEntryInput = {
    couple_id: couple?.id ?? '',
    title: title.trim(),
    ...entryContent(content),
    mood,
    is_draft: originalDraftStatus.current,
    entry_date: entryDate,
    location_name: locationName,
    location_lat: locationLat,
    location_lng: locationLng,
  };
  const snapshot: EntryDraft = {
    version: 1,
    userId: user?.id ?? '',
    coupleId: couple?.id ?? '',
    entryId: draftEntryId,
    expectedUpdatedAt: expectedVersion.current,
    fields: pendingSave?.fields ?? fields,
    attachments,
    removeMediaIds: [
      ...imagesToDelete.map((m) => m.id),
      ...(deleteExistingVoiceMemo && existingVoiceMemo ? [existingVoiceMemo.id] : []),
    ],
    pendingSave,
  };
  if (!loadingEntry && !loadError && user && couple) snapshotRef.current = snapshot;
  const serialized = JSON.stringify(snapshot);
  const hasMemo = !!pendingVoiceMemo || (!!existingVoiceMemo && !deleteExistingVoiceMemo);
  const mediaControlsDisabled = saving || !!pendingSave || staging || voiceMemo.isFinalizing;
  const hasContent = !!(
    title.trim() ||
    content.trim() ||
    attachments.length ||
    voiceMemo.isRecording
  );
  const dirty =
    baseline.current !==
      JSON.stringify({ title, content, mood, entryDate, locationName, locationLat, locationLng }) ||
    attachments.length > 0 ||
    imagesToDelete.length > 0 ||
    deleteExistingVoiceMemo;

  const flushDraft = useCallback(async () => {
    if (!store || !snapshotRef.current) return;
    await store.save({ ...snapshotRef.current, pendingSave: pendingSaveRef.current });
    setDraftError(null);
  }, [store]);

  useEffect(() => {
    if (loadingEntry || loadError || savedSuccessfully.current || !store) return;
    // Serial writes prevent an older autosave from undoing Save/Discard.
    void store
      .save(JSON.parse(serialized) as EntryDraft)
      .then(() => setDraftError(null))
      .catch((error) => setDraftError(errorMessage(error)));
  }, [serialized, loadingEntry, loadError, store]);

  recordingSaved.current = async (uri, ms) => {
    const current = snapshotRef.current;
    if (!current || !store)
      throw new Error('Your diary is not ready. Keep this recording and retry.');
    const id = uuid.v4();
    const durableUri = keepDraftFile(
      uri,
      current.userId,
      current.coupleId,
      current.entryId,
      `${id}.m4a`
    );
    const audio: PendingAttachment = {
      id,
      uri: durableUri,
      media_type: 'audio',
      mime_type: 'audio/mp4',
      duration_ms: ms,
    };
    snapshotRef.current = {
      ...current,
      attachments: [...current.attachments.filter((a) => a.media_type !== 'audio'), audio],
    };
    setPendingVoiceMemo({ id, uri: durableUri, durationMs: ms });
    await store.save(snapshotRef.current);
    return durableUri;
  };

  const latest = useRef({
    stopRecording: voiceMemo.stopRecording,
    isRecording: voiceMemo.isRecording || voiceMemo.isFinalizing,
    flushDraft,
  });
  latest.current = {
    stopRecording: voiceMemo.stopRecording,
    isRecording: voiceMemo.isRecording || voiceMemo.isFinalizing,
    flushDraft,
  };
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') return;
      const work = latest.current;
      void (async () => {
        if (work.isRecording && !(await work.stopRecording()))
          throw new Error('The recording could not be kept yet.');
        await work.flushDraft();
      })().catch((error) => setDraftError(errorMessage(error)));
    });
    return () => subscription.remove();
  }, []);

  const leave = useCallback((action: () => void) => {
    exitAction.current = action;
    setAllowExit(true);
  }, []);
  useEffect(() => {
    if (allowExit && exitAction.current) {
      const action = exitAction.current;
      exitAction.current = null;
      action();
    }
  }, [allowExit]);

  const requestLeave = useCallback(
    (action: () => void) => {
      if (savingRef.current || stagingRef.current || voiceMemo.isFinalizing) {
        Alert.alert('Keeping your memory', 'Please wait for the attachment or save to finish.');
        return;
      }
      if (
        savedSuccessfully.current ||
        loadingEntry ||
        loadError ||
        (!dirty && !voiceMemo.isRecording && !pendingSaveRef.current)
      ) {
        leave(action);
        return;
      }
      const keep = async () => {
        try {
          if (latest.current.isRecording && !(await latest.current.stopRecording()))
            throw new Error('The recording could not be kept yet.');
          await latest.current.flushDraft();
          leave(action);
        } catch (error) {
          Alert.alert('Draft could not be saved', errorMessage(error));
        }
      };
      Alert.alert(
        'Keep your draft?',
        pendingSaveRef.current
          ? 'This save needs a retry. Keep the draft to resume it safely next time.'
          : 'Text, photos and voice memos can be kept on this device for next time.',
        [
          { text: 'Keep Editing', style: 'cancel' },
          {
            text: 'Keep Draft',
            onPress: () => {
              void keep();
            },
          },
          ...(!pendingSaveRef.current
            ? [
                {
                  text: 'Discard',
                  style: 'destructive' as const,
                  onPress: () => {
                    void (async () => {
                      if (latest.current.isRecording && !(await latest.current.stopRecording()))
                        throw new Error('The recording could not be kept yet.');
                      await store?.clear();
                      if (snapshotRef.current) removeDraftFiles(snapshotRef.current);
                      savedSuccessfully.current = true;
                      leave(action);
                    })().catch((error) =>
                      Alert.alert('Could not discard draft', errorMessage(error))
                    );
                  },
                },
              ]
            : []),
        ]
      );
    },
    [dirty, leave, loadError, loadingEntry, store, voiceMemo.isRecording, voiceMemo.isFinalizing]
  );
  usePreventRemove(
    !allowExit &&
      (dirty ||
        voiceMemo.isRecording ||
        voiceMemo.isFinalizing ||
        staging ||
        saving ||
        !!pendingSave),
    ({ data }) => {
      requestLeave(() => navigation.dispatch(data.action));
    }
  );
  useEffect(() => {
    navigation.setOptions({
      headerTitle: isEditMode ? 'Edit Entry' : 'New Entry',
      // UIKit centers the label within its own glass background on iOS.
      headerLeft: () =>
        Platform.OS === 'ios' ? (
          <NativeButton
            title="Cancel"
            color={colors.text}
            onPress={() => requestLeave(navigateAway)}
            disabled={saving}
          />
        ) : (
          <Button
            title="Cancel"
            compact
            onPress={() => requestLeave(navigateAway)}
            disabled={saving}
          />
        ),
    });
  }, [navigation, isEditMode, requestLeave, navigateAway, saving, colors.text]);

  const handleSave = async (isDraft: boolean) => {
    if (savingRef.current) return;
    if (loadingEntry || loadError || !snapshotRef.current || !user || !couple || !store) {
      Alert.alert('Entry not ready', 'Load your diary successfully before saving.');
      return;
    }
    if (voiceMemo.isRecording || voiceMemo.isFinalizing || stagingRef.current) {
      Alert.alert('Finish recording', 'Stop the voice memo before saving.');
      return;
    }
    if (!hasContent && !existingImages.length && !hasMemo) {
      Alert.alert('Add a memory', 'Add text, a photo, or a voice memo before saving.');
      return;
    }
    Keyboard.dismiss();
    savingRef.current = true;
    setSaving(true);
    try {
      const current = snapshotRef.current;
      const plan = pendingSaveRef.current ?? {
        operationId: uuid.v4(),
        entryId: current.entryId,
        expectedUpdatedAt: current.expectedUpdatedAt,
        fields: { ...current.fields, is_draft: isEditMode ? originalDraftStatus.current : isDraft },
        attachments: current.attachments,
        removeMediaIds: current.removeMediaIds,
      };
      pendingSaveRef.current = plan;
      setPendingSave(plan);
      await saveEntry(plan, user.id, async (request) => {
        await store.save({ ...current, fields: request.fields, pendingSave: request });
      });
      await store.clear();
      savedSuccessfully.current = true;
      try {
        removeDraftFiles(current);
      } catch {
        /* A local orphan is safe to clean up later. */
      }
      entryEvents.emit();
      leave(navigateAway);
    } catch (error) {
      const message = errorMessage(error);
      const conflict = (error as { code?: string })?.code === '40001';
      Alert.alert(
        conflict ? 'Entry changed' : 'Save needs a retry',
        `${message}\n\nYour draft and attachments are kept on this device.`,
        [
          { text: 'Keep Draft', style: 'cancel' },
          ...(conflict
            ? [
                {
                  text: 'Discard changes & reload',
                  style: 'destructive' as const,
                  onPress: () => {
                    void store
                      .clear()
                      .then(() => {
                        pendingSaveRef.current = null;
                        setPendingSave(null);
                        setReload((n) => n + 1);
                      })
                      .catch((failure) => Alert.alert('Could not reload', errorMessage(failure)));
                  },
                },
              ]
            : []),
        ]
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleDateChange = (_: unknown, selectedDate?: Date) => {
    setShowDatePicker(false);
    if (selectedDate) {
      const dateStr = format(selectedDate, 'yyyy-MM-dd');
      setEntryDate(dateStr);
    }
  };

  const handleAddLocation = () => setLocationSearchVisible(true);

  const handleAddImage = async () => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', 'Take Photo', 'Choose from Library'],
          cancelButtonIndex: 0,
        },
        async (buttonIndex) => {
          if (buttonIndex === 1) {
            await pickImage('camera');
          } else if (buttonIndex === 2) {
            await pickImage('library');
          }
        }
      );
    } else {
      Alert.alert('Add photo', 'Choose a source', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Camera', onPress: () => void pickImage('camera') },
        { text: 'Photo library', onPress: () => void pickImage('library') },
      ]);
    }
  };

  const pickImage = async (source: 'camera' | 'library') => {
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      quality: 0.8,
      allowsEditing: false,
    };

    let result;
    if (source === 'camera') {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Camera permission is required');
        return;
      }
      result = await ImagePicker.launchCameraAsync(options);
    } else {
      result = await ImagePicker.launchImageLibraryAsync(options);
    }

    if (!result.canceled && result.assets[0]) {
      stagingRef.current = true;
      setStaging(true);
      try {
        if (!user || !couple || !snapshotRef.current) return;
        const asset = result.assets[0];
        const draftId = uuid.v4();
        const compressed = await compressImage(asset.uri);
        const current = snapshotRef.current;
        if (!current || current.userId !== user.id || current.coupleId !== couple.id) return;
        const uri = keepDraftFile(compressed, user.id, couple.id, draftEntryId, `${draftId}.jpg`);
        const addition: PendingAttachment = {
          id: draftId,
          uri,
          media_type: 'image',
          mime_type: 'image/jpeg',
          width: asset.width,
          height: asset.height,
        };
        snapshotRef.current = {
          ...snapshotRef.current,
          attachments: [...snapshotRef.current.attachments, addition],
        };
        setPendingImages((prev) => [...prev, { ...asset, uri, draftId }]);
        await store?.save(snapshotRef.current);
      } catch (error) {
        Alert.alert('Photo could not be kept', errorMessage(error));
      } finally {
        stagingRef.current = false;
        setStaging(false);
      }
    }
  };

  if (loadError) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.error }}>{loadError}</Text>
        <Button title="Retry loading entry" onPress={() => setReload((n) => n + 1)} />
      </View>
    );
  }

  if (loadingEntry) {
    return (
      <View
        style={[
          styles.container,
          { backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' },
        ]}
      >
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {draftError && <Text style={{ color: colors.error }}>{draftError}</Text>}
      {pendingSave && !saving && (
        <Text style={{ color: colors.textSecondary }}>
          Your previous save needs a retry. Your words and attachments are kept.
        </Text>
      )}
      <KeyboardAwareScrollView
        bottomOffset={keyboardFooterHeight + Spacing.md}
        extraKeyboardSpace={keyboardFooterHeight}
        disableScrollOnKeyboardHide
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        pointerEvents={saving || pendingSave || staging || voiceMemo.isFinalizing ? 'none' : 'auto'}
        ref={scrollViewRef}
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: footerHeight + Spacing.lg }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {/* Title */}
        <TextInput
          style={[styles.titleInput, { color: colors.text, borderBottomColor: colors.border }]}
          placeholder="Entry title..."
          placeholderTextColor={colors.textMuted}
          value={title}
          onChangeText={setTitle}
        />

        {/* Date Selector - when the entry's event took place */}
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Choose entry date"
          style={styles.datePickerRow}
          onPress={() => setShowDatePicker(!showDatePicker)}
        >
          <FontAwesome name="calendar" size={14} color={colors.primary} />
          <Text style={[styles.datePickerText, { color: colors.text }]}>
            {formatEntryDate(entryDate)}
          </Text>
          <FontAwesome
            name={showDatePicker ? 'chevron-up' : 'chevron-down'}
            size={10}
            color={colors.textMuted}
          />
        </TouchableOpacity>
        {showDatePicker && (
          <DateTimePicker
            value={new Date(entryDate + 'T12:00:00')}
            mode="date"
            display="inline"
            maximumDate={new Date()}
            onChange={handleDateChange}
          />
        )}

        {/* Mood Selector */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.moodScroll}
          contentContainerStyle={styles.moodContainer}
        >
          {Moods.map((m) => (
            <TouchableOpacity
              key={m.key}
              accessibilityRole="button"
              accessibilityLabel={m.label}
              accessibilityState={{ selected: mood === m.key }}
              style={[
                styles.moodChip,
                {
                  backgroundColor: mood === m.key ? colors.primary + '20' : colors.surfaceSecondary,
                  borderColor: mood === m.key ? colors.primary : colors.border,
                },
              ]}
              onPress={() => setMood(mood === m.key ? null : m.key)}
            >
              <Text style={styles.moodChipEmoji}>{m.emoji}</Text>
              <Text
                style={[
                  styles.moodChipLabel,
                  { color: mood === m.key ? colors.primary : colors.textSecondary },
                ]}
              >
                {m.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Location */}
        {locationName ? (
          <View style={[styles.locationDisplay, { backgroundColor: colors.surfaceSecondary }]}>
            <FontAwesome name="map-marker" size={14} color={colors.primary} />
            <Text style={[styles.locationDisplayText, { color: colors.text }]} numberOfLines={1}>
              {locationName}
            </Text>
            <IconButton
              label="Remove location"
              icon="times"
              disabled={mediaControlsDisabled}
              onPress={() => {
                setLocationName(null);
                setLocationLat(null);
                setLocationLng(null);
              }}
            />
          </View>
        ) : null}

        {/* Images (existing + pending) */}
        {(existingImages.length > 0 || pendingImages.length > 0) && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.imageScroll}
            contentContainerStyle={styles.imageScrollContent}
          >
            {existingImages.map((img, index) => (
              <View key={img.id} style={styles.imageThumbContainer}>
                {img.signedUrl && (
                  <Image source={{ uri: img.signedUrl }} style={styles.imageThumb} />
                )}
                <IconButton
                  label={`Remove attached photo ${index + 1}`}
                  disabled={mediaControlsDisabled}
                  icon="times"
                  destructive
                  style={styles.imageRemoveButton}
                  onPress={() => {
                    setExistingImages((prev) => prev.filter((i) => i.id !== img.id));
                    setImagesToDelete((prev) => [...prev, img]);
                  }}
                />
              </View>
            ))}
            {pendingImages.map((asset, index) => (
              <View key={asset.draftId} style={styles.imageThumbContainer}>
                <Image source={{ uri: asset.uri }} style={styles.imageThumb} />
                <IconButton
                  label={`Remove new photo ${index + 1}`}
                  disabled={mediaControlsDisabled}
                  icon="times"
                  destructive
                  style={styles.imageRemoveButton}
                  onPress={() => setPendingImages((prev) => prev.filter((_, i) => i !== index))}
                />
              </View>
            ))}
          </ScrollView>
        )}

        {/* Existing Voice Memo (edit mode) */}
        {existingVoiceMemo && !deleteExistingVoiceMemo && !pendingVoiceMemo && (
          <View
            style={[
              styles.voiceMemoCard,
              { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
            ]}
          >
            <IconButton
              label={voiceMemo.isPlaying ? 'Pause voice memo' : 'Play voice memo'}
              icon={voiceMemo.isPlaying ? 'pause' : 'play'}
              onPress={() =>
                voiceMemo.isPlaying
                  ? voiceMemo.pauseAudio()
                  : voiceMemo.playAudio(existingVoiceMemo.signedUrl!)
              }
              disabled={mediaControlsDisabled || !existingVoiceMemo.signedUrl}
            />
            <View style={styles.voiceMemoInfo}>
              <Text style={[styles.voiceMemoLabel, { color: colors.text }]}>Voice Memo</Text>
              <Text style={[styles.voiceMemoDuration, { color: colors.textMuted }]}>
                {voiceMemo.isPlaying
                  ? formatDuration(voiceMemo.playbackPositionSecs * 1000)
                  : formatDuration(existingVoiceMemo.duration_ms || 0)}
                {' / '}
                {formatDuration(existingVoiceMemo.duration_ms || 0)}
              </Text>
            </View>
            <IconButton
              label="Remove voice memo"
              icon="trash"
              destructive
              disabled={mediaControlsDisabled}
              onPress={() => {
                voiceMemo.stopPlayback();
                setDeleteExistingVoiceMemo(true);
              }}
            />
          </View>
        )}

        {/* Pending Voice Memo (new recording) */}
        {pendingVoiceMemo && (
          <View
            style={[
              styles.voiceMemoCard,
              { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
            ]}
          >
            <IconButton
              label={voiceMemo.isPlaying ? 'Pause voice memo' : 'Play voice memo'}
              icon={voiceMemo.isPlaying ? 'pause' : 'play'}
              disabled={mediaControlsDisabled}
              onPress={() =>
                voiceMemo.isPlaying
                  ? voiceMemo.pauseAudio()
                  : voiceMemo.playAudio(pendingVoiceMemo.uri)
              }
            />
            <View style={styles.voiceMemoInfo}>
              <Text style={[styles.voiceMemoLabel, { color: colors.text }]}>Voice Memo</Text>
              <Text style={[styles.voiceMemoDuration, { color: colors.textMuted }]}>
                {voiceMemo.isPlaying
                  ? formatDuration(voiceMemo.playbackPositionSecs * 1000)
                  : formatDuration(pendingVoiceMemo.durationMs)}
                {' / '}
                {formatDuration(pendingVoiceMemo.durationMs)}
              </Text>
            </View>
            <IconButton
              label="Remove voice memo"
              icon="trash"
              destructive
              disabled={mediaControlsDisabled}
              onPress={() => {
                voiceMemo.stopPlayback();
                voiceMemo.resetRecording();
                setPendingVoiceMemo(null);
              }}
            />
          </View>
        )}

        {/* Content */}
        <TextInput
          style={[styles.contentInput, { color: colors.text }]}
          placeholder="Write your thoughts..."
          placeholderTextColor={colors.textMuted}
          value={content}
          onChangeText={setContent}
          multiline
          textAlignVertical="top"
          scrollEnabled={false}
        />
      </KeyboardAwareScrollView>

      <KeyboardStickyView
        offset={{ closed: 0, opened: 0 }}
        style={[
          styles.stickyFooter,
          { backgroundColor: colors.surface, paddingBottom: footerInset },
        ]}
        onLayout={(event) => setFooterHeight(event.nativeEvent.layout.height)}
      >
        {/* Recording Indicator */}
        {voiceMemo.isRecording && (
          <View
            style={[
              styles.recordingBar,
              { backgroundColor: colors.error + '10', borderTopColor: colors.border },
            ]}
          >
            <View style={[styles.recordingDot, { backgroundColor: colors.error }]} />
            <Text style={[styles.recordingText, { color: colors.error }]}>
              {formatDuration(voiceMemo.recordingDurationSecs * 1000)}
            </Text>
            <IconButton
              label="Stop recording"
              icon="stop"
              destructive
              onPress={voiceMemo.stopRecording}
            />
          </View>
        )}

        {/* Toolbar */}
        <View
          style={[
            styles.toolbar,
            { backgroundColor: colors.surface, borderTopColor: colors.border },
          ]}
        >
          <View
            style={styles.toolbarLeft}
            pointerEvents={
              saving || pendingSave || staging || voiceMemo.isFinalizing ? 'none' : 'auto'
            }
          >
            <IconButton
              label="Add photo"
              icon="image"
              disabled={mediaControlsDisabled}
              onPress={handleAddImage}
            />
            <IconButton
              label="Add location"
              icon="map-marker"
              disabled={mediaControlsDisabled}
              onPress={handleAddLocation}
            />
            <IconButton
              label={voiceMemo.isRecording ? 'Stop recording' : 'Record voice memo'}
              icon={voiceMemo.isRecording ? 'stop' : 'microphone'}
              onPress={voiceMemo.isRecording ? voiceMemo.stopRecording : voiceMemo.startRecording}
              disabled={hasMemo || mediaControlsDisabled}
            />
          </View>
          <View style={styles.toolbarRight}>
            {!isEditMode && (
              <Button
                title="Save Draft"
                compact
                onPress={() => handleSave(true)}
                disabled={
                  saving ||
                  loadingEntry ||
                  !!loadError ||
                  voiceMemo.isRecording ||
                  voiceMemo.isFinalizing ||
                  staging
                }
              />
            )}
            <Button
              title={
                saving
                  ? 'Saving…'
                  : pendingSave
                    ? 'Retry Save'
                    : isEditMode
                      ? 'Save Changes'
                      : 'Publish'
              }
              variant="primary"
              compact
              loading={saving}
              onPress={() => handleSave(false)}
              disabled={
                saving ||
                loadingEntry ||
                !!loadError ||
                voiceMemo.isRecording ||
                voiceMemo.isFinalizing ||
                staging
              }
            />
          </View>
        </View>
      </KeyboardStickyView>

      {/* Location Search Modal */}
      <LocationSheet
        visible={locationSearchVisible}
        onClose={() => setLocationSearchVisible(false)}
        onSelect={(name, lat, lng) => {
          setLocationName(name);
          setLocationLat(lat);
          setLocationLng(lng);
          setLocationSearchVisible(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },
  titleInput: {
    fontSize: FontSize.xl,
    fontWeight: '600',
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
    marginBottom: Spacing.md,
  },
  datePickerRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  datePickerText: {
    fontSize: FontSize.sm,
    fontWeight: '500',
  },
  moodScroll: {
    marginBottom: Spacing.md,
  },
  moodContainer: {
    gap: Spacing.sm,
  },
  moodChip: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
  },
  moodChipEmoji: {
    fontSize: 16,
  },
  moodChipLabel: {
    fontSize: FontSize.xs,
  },
  locationDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
    marginBottom: Spacing.md,
  },
  locationDisplayText: {
    flex: 1,
    fontSize: FontSize.sm,
  },
  imageScroll: {
    marginBottom: Spacing.md,
  },
  imageScrollContent: {
    gap: Spacing.sm,
  },
  imageThumbContainer: {
    position: 'relative',
  },
  imageThumb: {
    width: 80,
    height: 80,
    borderRadius: BorderRadius.sm,
  },
  imageRemoveButton: {
    position: 'absolute',
    top: 0,
    right: 0,
  },
  contentInput: {
    fontSize: FontSize.md,
    lineHeight: 24,
    minHeight: 300,
  },
  recordingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderTopWidth: 1,
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  recordingText: {
    flex: 1,
    fontSize: FontSize.sm,
    fontWeight: '600',
  },
  voiceMemoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    marginBottom: Spacing.md,
  },
  voiceMemoInfo: {
    flex: 1,
  },
  voiceMemoLabel: {
    fontSize: FontSize.sm,
    fontWeight: '500',
  },
  voiceMemoDuration: {
    fontSize: FontSize.xs,
    marginTop: 2,
  },
  stickyFooter: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  toolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderTopWidth: 1,
  },
  toolbarLeft: {
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  toolbarRight: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
});
