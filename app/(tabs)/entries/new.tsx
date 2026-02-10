import { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  Image,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  useColorScheme,
  ActionSheetIOS,
  Modal,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { useRouter, useNavigation } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as ImagePicker from 'expo-image-picker';
import { useCouple } from '../../../src/hooks/useCouple';
import { useAuth } from '../../../src/providers/AuthProvider';
import { useEntries, type CreateEntryInput } from '../../../src/hooks/useEntries';
import { getCurrentDateString, formatEntryDate } from '../../../src/lib/date-utils';
import { compressImage, uploadMedia } from '../../../src/lib/storage';
import { supabase } from '../../../src/lib/supabase';
import { searchLocations, type LocationResult } from '../../../src/lib/location-search';
import {
  Colors,
  Spacing,
  FontSize,
  BorderRadius,
  Moods,
  type MoodKey,
} from '../../../src/constants/theme';

const DRAFT_KEY = 'new_entry_draft';

export default function NewEntryScreen() {
  const { couple } = useCouple();
  const { user } = useAuth();
  const { createEntry } = useEntries(couple?.id);
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
  const [pendingImages, setPendingImages] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [saving, setSaving] = useState(false);
  const [locationSearchVisible, setLocationSearchVisible] = useState(false);
  const [locationQuery, setLocationQuery] = useState('');
  const [locationSearching, setLocationSearching] = useState(false);
  const [locationResults, setLocationResults] = useState<LocationResult[]>([]);
  const savedSuccessfully = useRef(false);
  const locationSearchRef = useRef<TextInput>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore draft on mount
  useEffect(() => {
    AsyncStorage.getItem(DRAFT_KEY).then((raw) => {
      if (!raw) return;
      try {
        const draft = JSON.parse(raw);
        if (draft.title) setTitle(draft.title);
        if (draft.content) setContent(draft.content);
        if (draft.mood) setMood(draft.mood);
        if (draft.entryDate) setEntryDate(draft.entryDate);
        if (draft.locationName) setLocationName(draft.locationName);
        if (draft.locationLat) setLocationLat(draft.locationLat);
        if (draft.locationLng) setLocationLng(draft.locationLng);
      } catch {}
    });
  }, []);

  // Auto-save draft on changes (debounced)
  useEffect(() => {
    if (savedSuccessfully.current) return;
    const timeout = setTimeout(() => {
      if (title.trim() || content.trim()) {
        AsyncStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({
            title,
            content,
            mood,
            entryDate,
            locationName,
            locationLat,
            locationLng,
          })
        );
      }
    }, 500);
    return () => clearTimeout(timeout);
  }, [title, content, mood, entryDate, locationName, locationLat, locationLng]);

  const hasContent = !!(title.trim() || content.trim() || pendingImages.length > 0);

  // Disable swipe-to-dismiss gesture when there's content to prevent accidental loss
  useEffect(() => {
    navigation.setOptions({
      gestureEnabled: !hasContent,
    });
  }, [navigation, hasContent]);

  const handleClose = () => {
    if (!hasContent || savedSuccessfully.current) {
      AsyncStorage.removeItem(DRAFT_KEY);
      router.dismiss();
      return;
    }
    Alert.alert(
      'Discard Entry?',
      'You have unsaved changes. Your draft has been saved and will be restored next time.',
      [
        { text: 'Keep Editing', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            AsyncStorage.removeItem(DRAFT_KEY);
            router.dismiss();
          },
        },
      ]
    );
  };

  // Add a close button to the header
  useEffect(() => {
    navigation.setOptions({
      headerLeft: () => (
        <TouchableOpacity onPress={handleClose} style={{ padding: 8 }}>
          <Text style={{ color: colors.primary, fontSize: FontSize.md }}>Cancel</Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation, hasContent, colors.primary]);

  const handleSave = async (isDraft: boolean) => {
    if (!couple) {
      Alert.alert('Error', 'You need to pair with a partner first');
      return;
    }

    if (!isDraft && !title.trim() && !content.trim()) {
      Alert.alert('Error', 'Please add a title or some content');
      return;
    }

    setSaving(true);
    try {
      const entryData: CreateEntryInput = {
        couple_id: couple.id,
        title: title.trim(),
        content_html: `<p>${content.replace(/\n/g, '</p><p>')}</p>`,
        content_plain: content,
        word_count: content.trim() ? content.trim().split(/\s+/).length : 0,
        mood,
        is_draft: isDraft,
        entry_date: entryDate,
        location_name: locationName,
        location_lat: locationLat,
        location_lng: locationLng,
      };

      const entry = await createEntry(entryData);

      // Upload pending images
      if (pendingImages.length > 0 && user) {
        for (const asset of pendingImages) {
          try {
            const compressed = await compressImage(asset.uri);
            const fileName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
            const storagePath = await uploadMedia(
              compressed,
              user.id,
              entry.id,
              fileName,
              'image/jpeg'
            );
            await supabase.from('media').insert({
              entry_id: entry.id,
              author_id: user.id,
              storage_path: storagePath,
              media_type: 'image',
              mime_type: 'image/jpeg',
              width: asset.width,
              height: asset.height,
            });
          } catch (uploadErr: any) {
            console.warn('Image upload failed:', uploadErr.message);
          }
        }
      }

      savedSuccessfully.current = true;
      await AsyncStorage.removeItem(DRAFT_KEY);
      router.dismiss();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDateChange = (_: unknown, selectedDate?: Date) => {
    setShowDatePicker(false);
    if (selectedDate) {
      const dateStr = selectedDate.toISOString().split('T')[0];
      setEntryDate(dateStr);
    }
  };

  const handleAddLocation = () => {
    setLocationQuery('');
    setLocationResults([]);
    setLocationSearchVisible(true);
  };

  const handleLocationQueryChange = (text: string) => {
    setLocationQuery(text);

    // Debounced autocomplete search
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (!text.trim()) {
      setLocationResults([]);
      return;
    }
    searchDebounceRef.current = setTimeout(async () => {
      setLocationSearching(true);
      try {
        const results = await searchLocations(text.trim());
        setLocationResults(results);
      } catch {
        // Silently fail for autocomplete
      } finally {
        setLocationSearching(false);
      }
    }, 400);
  };

  const handleLocationSearch = async () => {
    const query = locationQuery.trim();
    if (!query) return;

    setLocationSearching(true);
    try {
      const results = await searchLocations(query);
      if (results.length === 0) {
        setLocationResults([]);
        Alert.alert(
          'Not Found',
          'No locations found for that search. Try a different name or address.'
        );
        return;
      }
      setLocationResults(results);
    } catch (e: any) {
      Alert.alert('Error', 'Could not search for location');
    } finally {
      setLocationSearching(false);
    }
  };

  const handleSelectLocation = (loc: LocationResult) => {
    // Store a concise display name — avoid duplicating the name in the address
    const address = loc.address || '';
    const nameIsInAddress = address.toLowerCase().includes(loc.name.toLowerCase());
    setLocationName(nameIsInAddress ? loc.name : loc.name);
    setLocationLat(loc.lat);
    setLocationLng(loc.lng);
    setLocationSearchVisible(false);
  };

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
      await pickImage('library');
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
      setPendingImages((prev) => [...prev, result.assets[0]]);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Title */}
        <TextInput
          style={[styles.titleInput, { color: colors.text, borderBottomColor: colors.border }]}
          placeholder="Entry title..."
          placeholderTextColor={colors.textMuted}
          value={title}
          onChangeText={setTitle}
          autoFocus
        />

        {/* Date Selector - when the entry's event took place */}
        <TouchableOpacity
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
            <TouchableOpacity
              onPress={() => {
                setLocationName(null);
                setLocationLat(null);
                setLocationLng(null);
              }}
            >
              <FontAwesome name="times" size={14} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Pending Images */}
        {pendingImages.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.imageScroll}
            contentContainerStyle={styles.imageScrollContent}
          >
            {pendingImages.map((asset, index) => (
              <View key={index} style={styles.imageThumbContainer}>
                <Image source={{ uri: asset.uri }} style={styles.imageThumb} />
                <TouchableOpacity
                  style={styles.imageRemoveButton}
                  onPress={() => setPendingImages((prev) => prev.filter((_, i) => i !== index))}
                >
                  <FontAwesome name="times-circle" size={20} color={colors.error} />
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
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
        />
      </ScrollView>

      {/* Toolbar */}
      <View
        style={[styles.toolbar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}
      >
        <View style={styles.toolbarLeft}>
          <TouchableOpacity style={styles.toolbarButton} onPress={handleAddImage}>
            <FontAwesome name="image" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.toolbarButton} onPress={handleAddLocation}>
            <FontAwesome
              name="map-marker"
              size={20}
              color={locationName ? colors.primary : colors.textSecondary}
            />
          </TouchableOpacity>
        </View>
        <View style={styles.toolbarRight}>
          <TouchableOpacity
            style={[styles.draftButton, { borderColor: colors.border }]}
            onPress={() => handleSave(true)}
            disabled={saving}
          >
            <Text style={[styles.draftButtonText, { color: colors.textSecondary }]}>
              Save Draft
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.publishButton, { backgroundColor: colors.primary }]}
            onPress={() => handleSave(false)}
            disabled={saving}
          >
            <Text style={styles.publishButtonText}>{saving ? 'Saving...' : 'Publish'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Location Search Modal */}
      <Modal
        visible={locationSearchVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setLocationSearchVisible(false)}
      >
        <View style={[styles.locationModal, { backgroundColor: colors.background }]}>
          <View style={[styles.locationModalHeader, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={() => setLocationSearchVisible(false)}>
              <Text style={{ color: colors.primary, fontSize: FontSize.md }}>Cancel</Text>
            </TouchableOpacity>
            <Text style={[styles.locationModalTitle, { color: colors.text }]}>Add Location</Text>
            <View style={{ width: 50 }} />
          </View>

          <View style={styles.locationSearchRow}>
            <TextInput
              ref={locationSearchRef}
              style={[
                styles.locationSearchInput,
                {
                  color: colors.text,
                  backgroundColor: colors.surfaceSecondary,
                  borderColor: colors.border,
                },
              ]}
              placeholder="Search for a place or address..."
              placeholderTextColor={colors.textMuted}
              value={locationQuery}
              onChangeText={handleLocationQueryChange}
              onSubmitEditing={handleLocationSearch}
              returnKeyType="search"
              autoFocus
            />
            <TouchableOpacity
              style={[styles.locationSearchButton, { backgroundColor: colors.primary }]}
              onPress={handleLocationSearch}
              disabled={locationSearching || !locationQuery.trim()}
            >
              {locationSearching ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <FontAwesome name="search" size={16} color="#fff" />
              )}
            </TouchableOpacity>
          </View>

          <Text style={[styles.locationSearchHint, { color: colors.textMuted }]}>
            Search for the location of your date, event, or memory
          </Text>

          <FlatList
            data={locationResults}
            keyExtractor={(_, i) => i.toString()}
            contentContainerStyle={{ padding: Spacing.md }}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[
                  styles.locationResultItem,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
                onPress={() => handleSelectLocation(item)}
              >
                <FontAwesome
                  name="map-marker"
                  size={16}
                  color={colors.primary}
                  style={{ marginTop: 2 }}
                />
                <View style={{ flex: 1 }}>
                  <Text
                    style={[styles.locationResultText, { color: colors.text }]}
                    numberOfLines={1}
                  >
                    {item.name}
                  </Text>
                  {item.address ? (
                    <Text
                      style={[styles.locationResultAddress, { color: colors.textMuted }]}
                      numberOfLines={1}
                    >
                      {item.address}
                    </Text>
                  ) : null}
                </View>
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              locationQuery.trim() && !locationSearching ? (
                <Text style={[styles.locationEmptyText, { color: colors.textMuted }]}>
                  No results found. Try a different search.
                </Text>
              ) : null
            }
          />
        </View>
      </Modal>
    </KeyboardAvoidingView>
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
    top: -6,
    right: -6,
    backgroundColor: '#fff',
    borderRadius: 10,
  },
  contentInput: {
    fontSize: FontSize.md,
    lineHeight: 24,
    minHeight: 300,
  },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xl,
    borderTopWidth: 1,
  },
  toolbarLeft: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  toolbarButton: {
    padding: Spacing.sm,
  },
  toolbarRight: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  draftButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
  },
  draftButtonText: {
    fontSize: FontSize.sm,
    fontWeight: '500',
  },
  publishButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm,
  },
  publishButtonText: {
    color: '#fff',
    fontSize: FontSize.sm,
    fontWeight: '600',
  },
  // Location search modal styles
  locationModal: {
    flex: 1,
  },
  locationModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.md,
    borderBottomWidth: 1,
  },
  locationModalTitle: {
    fontSize: FontSize.lg,
    fontWeight: '600',
  },
  locationSearchRow: {
    flexDirection: 'row',
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  locationSearchInput: {
    flex: 1,
    height: 44,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    fontSize: FontSize.md,
  },
  locationSearchButton: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  locationSearchHint: {
    fontSize: FontSize.xs,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
  },
  locationResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    marginBottom: Spacing.sm,
  },
  locationResultText: {
    fontSize: FontSize.md,
  },
  locationResultAddress: {
    fontSize: FontSize.xs,
    marginTop: 2,
  },
  locationEmptyText: {
    textAlign: 'center',
    marginTop: Spacing.lg,
    fontSize: FontSize.sm,
  },
});
