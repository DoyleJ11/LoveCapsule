import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Image,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Platform,
  ActionSheetIOS,
  useColorScheme,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../../src/lib/supabase';
import { useAuth } from '../../../src/providers/AuthProvider';
import { useCouple } from '../../../src/hooks/useCouple';
import { useEntries } from '../../../src/hooks/useEntries';
import { formatEntryDate } from '../../../src/lib/date-utils';
import { compressImage, uploadMedia, getSignedUrl, deleteMedia } from '../../../src/lib/storage';
import { Colors, Spacing, FontSize, BorderRadius, Moods } from '../../../src/constants/theme';
import type { Entry, Media } from '../../../src/types/database';

export default function EntryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { couple } = useCouple();
  const { updateEntry, deleteEntry } = useEntries(couple?.id);
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const [entry, setEntry] = useState<Entry | null>(null);
  const [media, setMedia] = useState<(Media & { signedUrl?: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');

  useEffect(() => {
    fetchEntry();
  }, [id]);

  const fetchEntry = async () => {
    const { data, error } = await supabase.from('entries').select('*').eq('id', id).single();

    if (error) {
      Alert.alert('Error', 'Entry not found');
      router.back();
      return;
    }

    setEntry(data);
    setEditTitle(data.title);
    setEditContent(data.content_plain);
    setLoading(false);
    fetchMedia(data.id);
  };

  const fetchMedia = async (entryId: string) => {
    const { data: mediaData } = await supabase
      .from('media')
      .select('*')
      .eq('entry_id', entryId)
      .order('created_at', { ascending: true });

    if (mediaData && mediaData.length > 0) {
      const withUrls = await Promise.all(
        mediaData.map(async (m) => {
          try {
            const signedUrl = await getSignedUrl(m.storage_path);
            return { ...m, signedUrl };
          } catch {
            return { ...m, signedUrl: undefined };
          }
        })
      );
      setMedia(withUrls);
    } else {
      setMedia([]);
    }
  };

  const handleAddImageToEntry = async () => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', 'Take Photo', 'Choose from Library'],
          cancelButtonIndex: 0,
        },
        async (buttonIndex) => {
          if (buttonIndex === 1) await pickAndUploadImage('camera');
          else if (buttonIndex === 2) await pickAndUploadImage('library');
        }
      );
    } else {
      await pickAndUploadImage('library');
    }
  };

  const pickAndUploadImage = async (source: 'camera' | 'library') => {
    if (!entry || !user) return;
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
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    try {
      const compressed = await compressImage(asset.uri);
      const fileName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
      const storagePath = await uploadMedia(compressed, user.id, entry.id, fileName, 'image/jpeg');
      await supabase.from('media').insert({
        entry_id: entry.id,
        author_id: user.id,
        storage_path: storagePath,
        media_type: 'image',
        mime_type: 'image/jpeg',
        width: asset.width,
        height: asset.height,
      });
      await fetchMedia(entry.id);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to upload image');
    }
  };

  const handleDeleteMedia = async (m: Media) => {
    Alert.alert('Remove Image', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteMedia(m.storage_path);
            await supabase.from('media').delete().eq('id', m.id);
            await fetchMedia(entry!.id);
          } catch (e: any) {
            Alert.alert('Error', 'Failed to remove image');
          }
        },
      },
    ]);
  };

  const isOwner = entry?.author_id === user?.id;
  const mood = Moods.find((m) => m.key === entry?.mood);

  const handleSave = async () => {
    if (!entry) return;

    try {
      await updateEntry(entry.id, {
        title: editTitle.trim(),
        content_html: `<p>${editContent.replace(/\n/g, '</p><p>')}</p>`,
        content_plain: editContent,
        word_count: editContent.trim() ? editContent.trim().split(/\s+/).length : 0,
      });
      await fetchEntry();
      setEditing(false);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  };

  const handleDelete = () => {
    Alert.alert('Delete Entry', 'Are you sure? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteEntry(entry!.id);
            router.back();
          } catch (e: any) {
            Alert.alert('Error', e.message);
          }
        },
      },
    ]);
  };

  const handlePublish = async () => {
    if (!entry) return;
    try {
      await updateEntry(entry.id, { is_draft: false });
      await fetchEntry();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  };

  if (loading || !entry) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
    >
      {/* Meta info */}
      <View style={styles.metaRow}>
        <Text style={[styles.date, { color: colors.textMuted }]}>
          {formatEntryDate(entry.entry_date)}
        </Text>
        {entry.is_draft && (
          <View style={[styles.draftBadge, { backgroundColor: colors.warning + '20' }]}>
            <Text style={[styles.draftBadgeText, { color: colors.warning }]}>Draft</Text>
          </View>
        )}
        {mood && (
          <Text style={styles.moodEmoji}>
            {mood.emoji} {mood.label}
          </Text>
        )}
      </View>

      {/* Location */}
      {entry.location_name && (
        <View style={styles.locationRow}>
          <FontAwesome name="map-marker" size={14} color={colors.primary} />
          <Text style={[styles.locationText, { color: colors.textSecondary }]}>
            {entry.location_name}
          </Text>
        </View>
      )}

      {/* Title & Content */}
      {editing ? (
        <>
          <TextInput
            style={[styles.editTitle, { color: colors.text, borderBottomColor: colors.border }]}
            value={editTitle}
            onChangeText={setEditTitle}
            placeholder="Title..."
            placeholderTextColor={colors.textMuted}
          />
          <TextInput
            style={[styles.editContent, { color: colors.text }]}
            value={editContent}
            onChangeText={setEditContent}
            multiline
            textAlignVertical="top"
            placeholder="Write your thoughts..."
            placeholderTextColor={colors.textMuted}
          />

          {/* Media in edit mode */}
          {media.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.mediaScroll}
              contentContainerStyle={styles.mediaScrollContent}
            >
              {media.map((m) => (
                <View key={m.id} style={styles.mediaThumbContainer}>
                  {m.signedUrl && <Image source={{ uri: m.signedUrl }} style={styles.mediaThumb} />}
                  {isOwner && (
                    <TouchableOpacity
                      style={styles.mediaRemoveButton}
                      onPress={() => handleDeleteMedia(m)}
                    >
                      <FontAwesome name="times-circle" size={20} color={colors.error} />
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </ScrollView>
          )}

          {/* Add image button in edit mode */}
          <TouchableOpacity
            style={[styles.addImageButton, { borderColor: colors.border }]}
            onPress={handleAddImageToEntry}
          >
            <FontAwesome name="image" size={16} color={colors.textSecondary} />
            <Text style={[styles.addImageText, { color: colors.textSecondary }]}>Add Image</Text>
          </TouchableOpacity>

          <View style={styles.editActions}>
            <TouchableOpacity
              style={[styles.cancelButton, { borderColor: colors.border }]}
              onPress={() => {
                setEditTitle(entry.title);
                setEditContent(entry.content_plain);
                setEditing(false);
              }}
            >
              <Text style={[styles.cancelButtonText, { color: colors.textSecondary }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.saveButton, { backgroundColor: colors.primary }]}
              onPress={handleSave}
            >
              <Text style={styles.saveButtonText}>Save Changes</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <>
          <Text style={[styles.title, { color: colors.text }]}>
            {entry.title || 'Untitled Entry'}
          </Text>
          <Text style={[styles.body, { color: colors.text }]}>{entry.content_plain}</Text>

          {/* Entry Images */}
          {media.length > 0 && (
            <View style={styles.mediaGallery}>
              {media.map((m) =>
                m.signedUrl ? (
                  <Image
                    key={m.id}
                    source={{ uri: m.signedUrl }}
                    style={styles.mediaImage}
                    resizeMode="cover"
                  />
                ) : null
              )}
            </View>
          )}

          <Text style={[styles.wordCount, { color: colors.textMuted }]}>
            {entry.word_count} {entry.word_count === 1 ? 'word' : 'words'}
          </Text>

          {/* Actions (only for owner) */}
          {isOwner && (
            <View style={styles.actions}>
              {entry.is_draft && (
                <TouchableOpacity
                  style={[styles.publishButton, { backgroundColor: colors.accent }]}
                  onPress={handlePublish}
                >
                  <Text style={styles.publishButtonText}>Publish Entry</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.editButton, { borderColor: colors.border }]}
                onPress={() => setEditing(true)}
              >
                <FontAwesome name="pencil" size={16} color={colors.textSecondary} />
                <Text style={[styles.editButtonText, { color: colors.textSecondary }]}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.deleteButton, { borderColor: colors.error }]}
                onPress={handleDelete}
              >
                <FontAwesome name="trash" size={16} color={colors.error} />
                <Text style={[styles.deleteButtonText, { color: colors.error }]}>Delete</Text>
              </TouchableOpacity>
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },
  loadingText: {
    fontSize: FontSize.md,
    textAlign: 'center',
    marginTop: Spacing.xxl,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  date: {
    fontSize: FontSize.sm,
  },
  draftBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
  },
  draftBadgeText: {
    fontSize: FontSize.xs,
    fontWeight: '600',
  },
  moodEmoji: {
    fontSize: FontSize.sm,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginBottom: Spacing.md,
  },
  locationText: {
    fontSize: FontSize.sm,
  },
  title: {
    fontSize: FontSize.xxl,
    fontWeight: '700',
    marginBottom: Spacing.md,
  },
  body: {
    fontSize: FontSize.md,
    lineHeight: 26,
    marginBottom: Spacing.lg,
  },
  wordCount: {
    fontSize: FontSize.xs,
    marginBottom: Spacing.lg,
  },
  mediaGallery: {
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  mediaImage: {
    width: '100%',
    height: 250,
    borderRadius: BorderRadius.md,
  },
  mediaScroll: {
    marginBottom: Spacing.sm,
  },
  mediaScrollContent: {
    gap: Spacing.sm,
  },
  mediaThumbContainer: {
    position: 'relative',
  },
  mediaThumb: {
    width: 80,
    height: 80,
    borderRadius: BorderRadius.sm,
  },
  mediaRemoveButton: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: '#fff',
    borderRadius: 10,
  },
  addImageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    height: 40,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    marginBottom: Spacing.md,
  },
  addImageText: {
    fontSize: FontSize.sm,
    fontWeight: '500',
  },
  editTitle: {
    fontSize: FontSize.xl,
    fontWeight: '600',
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
    marginBottom: Spacing.md,
  },
  editContent: {
    fontSize: FontSize.md,
    lineHeight: 24,
    minHeight: 200,
    marginBottom: Spacing.md,
  },
  editActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  cancelButton: {
    flex: 1,
    height: 44,
    borderRadius: BorderRadius.sm,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  cancelButtonText: {
    fontSize: FontSize.md,
    fontWeight: '500',
  },
  saveButton: {
    flex: 1,
    height: 44,
    borderRadius: BorderRadius.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveButtonText: {
    color: '#fff',
    fontSize: FontSize.md,
    fontWeight: '600',
  },
  actions: {
    gap: Spacing.sm,
  },
  publishButton: {
    height: 44,
    borderRadius: BorderRadius.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  publishButtonText: {
    color: '#fff',
    fontSize: FontSize.md,
    fontWeight: '600',
  },
  editButton: {
    height: 44,
    borderRadius: BorderRadius.sm,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.sm,
    borderWidth: 1,
  },
  editButtonText: {
    fontSize: FontSize.md,
    fontWeight: '500',
  },
  deleteButton: {
    height: 44,
    borderRadius: BorderRadius.sm,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.sm,
    borderWidth: 1,
  },
  deleteButtonText: {
    fontSize: FontSize.md,
    fontWeight: '500',
  },
});
