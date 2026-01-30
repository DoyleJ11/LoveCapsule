import { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  useColorScheme,
  ActionSheetIOS,
} from 'react-native';
import { useRouter } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useCouple } from '../../../src/hooks/useCouple';
import { useEntries, type CreateEntryInput } from '../../../src/hooks/useEntries';
import { getCurrentDateString } from '../../../src/lib/date-utils';
import { Colors, Spacing, FontSize, BorderRadius, Moods, type MoodKey } from '../../../src/constants/theme';

export default function NewEntryScreen() {
  const { couple } = useCouple();
  const { createEntry } = useEntries(couple?.id);
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [mood, setMood] = useState<MoodKey | null>(null);
  const [entryDate, setEntryDate] = useState(getCurrentDateString());
  const [locationName, setLocationName] = useState<string | null>(null);
  const [locationLat, setLocationLat] = useState<number | null>(null);
  const [locationLng, setLocationLng] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

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

      await createEntry(entryData);
      router.back();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleAddLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Location permission is required to add location');
        return;
      }

      const location = await Location.getCurrentPositionAsync({});
      const [address] = await Location.reverseGeocodeAsync({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });

      const name = [address?.name, address?.city, address?.region]
        .filter(Boolean)
        .join(', ');

      setLocationName(name || 'Current Location');
      setLocationLat(location.coords.latitude);
      setLocationLng(location.coords.longitude);
    } catch (e: any) {
      Alert.alert('Error', 'Could not get location');
    }
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
      allowsEditing: true,
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
      // For now, append a placeholder. Full media upload integration
      // will connect with the rich text editor in a future iteration.
      setContent((prev) => prev + '\n[Image attached]\n');
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
      <View style={[styles.toolbar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
        <View style={styles.toolbarLeft}>
          <TouchableOpacity style={styles.toolbarButton} onPress={handleAddImage}>
            <FontAwesome name="image" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.toolbarButton} onPress={handleAddLocation}>
            <FontAwesome name="map-marker" size={20} color={locationName ? colors.primary : colors.textSecondary} />
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
            <Text style={styles.publishButtonText}>
              {saving ? 'Saving...' : 'Publish'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
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
    paddingVertical: Spacing.sm,
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
});
