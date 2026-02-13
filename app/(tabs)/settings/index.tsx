import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  Image,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActionSheetIOS,
  useColorScheme,
  Share,
  Platform,
  Modal,
  SafeAreaView,
  Switch,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../../../src/providers/AuthProvider';
import { useCouple } from '../../../src/providers/CoupleProvider';
import { useCheckpoint } from '../../../src/hooks/useCheckpoint';
import { signOut } from '../../../src/lib/auth';
import { supabase } from '../../../src/lib/supabase';
import { compressImage, uploadMedia } from '../../../src/lib/storage';
import {
  formatEntryDate,
  formatCheckpointFrequency,
  formatCheckpointDescription,
  getNextCheckpointDate,
  formatNextCheckpointDate,
} from '../../../src/lib/date-utils';
import { Colors, Spacing, FontSize, BorderRadius } from '../../../src/constants/theme';
import type { CheckpointConfig, CheckpointFrequency } from '../../../src/types/database';

const FREQUENCY_OPTIONS: { value: CheckpointFrequency; label: string }[] = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'semi_annual', label: 'Every 6 months' },
  { value: 'specific_date', label: 'Specific date' },
];

const DAY_OPTIONS = Array.from({ length: 28 }, (_, i) => i + 1);

export default function SettingsScreen() {
  const { profile, user, refreshProfile } = useAuth();
  const {
    couple,
    partner,
    createCouple,
    joinCouple,
    setAnniversaryDate,
    unpairCouple,
    loading,
    profileAvatarUrl: avatarUrl,
    partnerAvatarUrl,
    refreshProfileAvatar,
  } = useCouple();
  const {
    configs: checkpointConfigs,
    loadConfigs,
    createConfig,
    updateConfig,
    deleteConfig,
    loading: checkpointLoading,
  } = useCheckpoint();
  const [unpairingLoading, setUnpairingLoading] = useState(false);
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const [inviteInput, setInviteInput] = useState('');
  const [joiningLoading, setJoiningLoading] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(profile?.display_name || '');
  // Checkpoint modal state
  const [showCheckpointModal, setShowCheckpointModal] = useState(false);
  const [editingCheckpoint, setEditingCheckpoint] = useState<CheckpointConfig | null>(null);
  const [checkpointFrequency, setCheckpointFrequency] = useState<CheckpointFrequency>('monthly');
  const [checkpointDay, setCheckpointDay] = useState(15);
  const [checkpointMonths, setCheckpointMonths] = useState<number[]>([3, 6, 9, 12]);
  const [checkpointSpecificDate, setCheckpointSpecificDate] = useState<Date>(new Date());
  const [checkpointLabel, setCheckpointLabel] = useState('');
  const [checkpointActive, setCheckpointActive] = useState(true);
  const [showCheckpointDatePicker, setShowCheckpointDatePicker] = useState(false);

  // Load checkpoint configs when couple is available
  useEffect(() => {
    if (couple?.id && partner) {
      loadConfigs(couple.id);
    }
  }, [couple?.id, partner, loadConfigs]);

  const openCheckpointModal = (config?: CheckpointConfig) => {
    if (config) {
      setEditingCheckpoint(config);
      setCheckpointFrequency(config.frequency);
      setCheckpointDay(config.day_of_month || 15);
      setCheckpointMonths(config.months || [3, 6, 9, 12]);
      setCheckpointSpecificDate(
        config.specific_date ? new Date(config.specific_date + 'T00:00:00') : new Date()
      );
      setCheckpointLabel(config.label || '');
      setCheckpointActive(config.is_active);
    } else {
      setEditingCheckpoint(null);
      setCheckpointFrequency('monthly');
      setCheckpointDay(15);
      setCheckpointMonths([3, 6, 9, 12]);
      setCheckpointSpecificDate(new Date());
      setCheckpointLabel('');
      setCheckpointActive(true);
    }
    setShowCheckpointModal(true);
  };

  const handleSaveCheckpoint = async () => {
    if (!couple) return;

    try {
      const configData = {
        couple_id: couple.id,
        frequency: checkpointFrequency,
        day_of_month: checkpointFrequency !== 'specific_date' ? checkpointDay : null,
        months:
          checkpointFrequency === 'quarterly'
            ? [3, 6, 9, 12]
            : checkpointFrequency === 'semi_annual'
              ? [6, 12]
              : null,
        specific_date:
          checkpointFrequency === 'specific_date'
            ? checkpointSpecificDate.toISOString().split('T')[0]
            : null,
        label: checkpointLabel.trim() || null,
        is_active: checkpointActive,
      };

      if (editingCheckpoint) {
        await updateConfig(editingCheckpoint.id, configData);
      } else {
        await createConfig(configData);
      }

      setShowCheckpointModal(false);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  };

  const handleDeleteCheckpoint = (config: CheckpointConfig) => {
    Alert.alert(
      'Delete Checkpoint',
      `Are you sure you want to delete "${formatCheckpointDescription(config)}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteConfig(config.id);
            } catch (e: any) {
              Alert.alert('Error', e.message);
            }
          },
        },
      ]
    );
  };

  const handleUpdateName = async () => {
    if (!user || !nameInput.trim()) return;
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ display_name: nameInput.trim(), updated_at: new Date().toISOString() })
        .eq('id', user.id);
      if (error) throw error;
      await refreshProfile();
      setEditingName(false);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  };

  const handleChangeAvatar = async () => {
    if (!user) return;
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', 'Take Photo', 'Choose from Library'],
          cancelButtonIndex: 0,
        },
        async (buttonIndex) => {
          if (buttonIndex === 1) await pickAvatar('camera');
          else if (buttonIndex === 2) await pickAvatar('library');
        }
      );
    } else {
      await pickAvatar('library');
    }
  };

  const pickAvatar = async (source: 'camera' | 'library') => {
    if (!user) return;
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      quality: 0.8,
      allowsEditing: true,
      aspect: [1, 1],
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
    try {
      const compressed = await compressImage(result.assets[0].uri);
      const storagePath = await uploadMedia(
        compressed,
        user.id,
        'avatars',
        'avatar.jpg',
        'image/jpeg'
      );
      const { error } = await supabase
        .from('profiles')
        .update({ avatar_url: storagePath, updated_at: new Date().toISOString() })
        .eq('id', user.id);
      if (error) throw error;
      await refreshProfileAvatar(storagePath);
      await refreshProfile();
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to update profile picture');
    }
  };

  const handleCreateCouple = async () => {
    try {
      const code = await createCouple();
      Alert.alert('Invite Code Created', `Share this code with your partner: ${code}`);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  };

  const handleJoinCouple = async () => {
    if (!inviteInput.trim()) {
      Alert.alert('Error', 'Please enter an invite code');
      return;
    }

    setJoiningLoading(true);
    try {
      await joinCouple(inviteInput.trim());
      Alert.alert('Success', 'You are now connected with your partner!');
      setInviteInput('');
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setJoiningLoading(false);
    }
  };

  const handleShareCode = async () => {
    if (!couple?.invite_code) return;
    try {
      await Share.share({
        message: `Join my TimeCapsule! Use this invite code: ${couple.invite_code}`,
      });
    } catch (e) {
      // User cancelled share
    }
  };

  const handleDateChange = async (_: any, selectedDate?: Date) => {
    setShowDatePicker(Platform.OS === 'ios');
    if (selectedDate) {
      const dateStr = selectedDate.toISOString().split('T')[0];
      try {
        await setAnniversaryDate(dateStr);
      } catch (e: any) {
        Alert.alert('Error', e.message);
      }
    }
  };

  const handleUnpair = () => {
    Alert.alert(
      'Unpair from Partner',
      'Are you sure you want to unpair? This will permanently delete ALL diary entries, photos, and memories for BOTH you and your partner. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unpair & Delete All Data',
          style: 'destructive',
          onPress: async () => {
            setUnpairingLoading(true);
            try {
              await unpairCouple();
              Alert.alert(
                'Unpaired',
                'You have been unpaired from your partner. All shared data has been deleted.'
              );
            } catch (e: any) {
              Alert.alert('Error', e.message);
            } finally {
              setUnpairingLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          try {
            await signOut();
          } catch (e: any) {
            Alert.alert('Error', e.message);
          }
        },
      },
    ]);
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
    >
      {/* Profile Section */}
      <View
        style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Profile</Text>
        <View style={styles.profileRow}>
          <TouchableOpacity onPress={handleChangeAvatar}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
            ) : (
              <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
                <Text style={styles.avatarText}>
                  {profile?.display_name?.charAt(0)?.toUpperCase() || '?'}
                </Text>
              </View>
            )}
            <View style={[styles.avatarEditBadge, { backgroundColor: colors.surface }]}>
              <FontAwesome name="camera" size={10} color={colors.textSecondary} />
            </View>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            {editingName ? (
              <View style={styles.nameEditRow}>
                <TextInput
                  style={[styles.nameInput, { color: colors.text, borderColor: colors.border }]}
                  value={nameInput}
                  onChangeText={setNameInput}
                  autoFocus
                  autoCapitalize="words"
                />
                <TouchableOpacity onPress={handleUpdateName}>
                  <FontAwesome name="check" size={18} color={colors.primary} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    setEditingName(false);
                    setNameInput(profile?.display_name || '');
                  }}
                >
                  <FontAwesome name="times" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                onPress={() => {
                  setEditingName(true);
                  setNameInput(profile?.display_name || '');
                }}
                style={styles.nameEditRow}
              >
                <Text style={[styles.profileName, { color: colors.text }]}>
                  {profile?.display_name}
                </Text>
                <FontAwesome name="pencil" size={14} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>

      {/* Pairing Section */}
      <View
        style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Partner Pairing</Text>

        {!couple ? (
          <>
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: colors.primary }]}
              onPress={handleCreateCouple}
            >
              <FontAwesome name="heart" size={16} color="#fff" />
              <Text style={styles.actionButtonText}>Create a Couple</Text>
            </TouchableOpacity>

            <Text style={[styles.orText, { color: colors.textMuted }]}>or</Text>

            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: colors.surfaceSecondary,
                  color: colors.text,
                  borderColor: colors.border,
                },
              ]}
              placeholder="Enter invite code"
              placeholderTextColor={colors.textMuted}
              value={inviteInput}
              onChangeText={setInviteInput}
              autoCapitalize="none"
            />
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: colors.accent }]}
              onPress={handleJoinCouple}
              disabled={joiningLoading}
            >
              <Text style={styles.actionButtonText}>
                {joiningLoading ? 'Joining...' : 'Join with Code'}
              </Text>
            </TouchableOpacity>
          </>
        ) : !partner ? (
          <>
            <Text style={[styles.infoText, { color: colors.textSecondary }]}>
              Share this code with your partner:
            </Text>
            <View
              style={[
                styles.codeBox,
                { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.codeText, { color: colors.primary }]}>{couple.invite_code}</Text>
            </View>
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: colors.primary }]}
              onPress={handleShareCode}
            >
              <FontAwesome name="share" size={16} color="#fff" />
              <Text style={styles.actionButtonText}>Share Code</Text>
            </TouchableOpacity>
            <Text style={[styles.hintText, { color: colors.textMuted }]}>
              Waiting for your partner to join...
            </Text>

            <Text style={[styles.orText, { color: colors.textMuted }]}>
              or join your partner's couple
            </Text>

            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: colors.surfaceSecondary,
                  color: colors.text,
                  borderColor: colors.border,
                },
              ]}
              placeholder="Enter partner's invite code"
              placeholderTextColor={colors.textMuted}
              value={inviteInput}
              onChangeText={setInviteInput}
              autoCapitalize="none"
            />
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: colors.accent }]}
              onPress={handleJoinCouple}
              disabled={joiningLoading}
            >
              <Text style={styles.actionButtonText}>
                {joiningLoading ? 'Joining...' : 'Join with Code'}
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <View style={styles.partnerRow}>
              {partnerAvatarUrl ? (
                <Image source={{ uri: partnerAvatarUrl }} style={styles.partnerAvatarImage} />
              ) : (
                <View style={[styles.partnerAvatar, { backgroundColor: colors.accent }]}>
                  <Text style={styles.avatarText}>
                    {partner.display_name?.charAt(0)?.toUpperCase() || '?'}
                  </Text>
                </View>
              )}
              <View>
                <Text style={[styles.partnerName, { color: colors.text }]}>
                  {partner.display_name}
                </Text>
                <Text style={[styles.partnerStatus, { color: colors.success }]}>Connected</Text>
              </View>
            </View>
            <TouchableOpacity
              style={[styles.unpairButton, { borderColor: colors.error }]}
              onPress={handleUnpair}
              disabled={unpairingLoading}
            >
              <FontAwesome name="chain-broken" size={16} color={colors.error} />
              <Text style={[styles.unpairButtonText, { color: colors.error }]}>
                {unpairingLoading ? 'Unpairing...' : 'Unpair from Partner'}
              </Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* Anniversary Date Section */}
      {couple && partner && (
        <View
          style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Anniversary Date</Text>
          {couple.anniversary_date ? (
            <Text style={[styles.dateDisplay, { color: colors.text }]}>
              {formatEntryDate(couple.anniversary_date)}
            </Text>
          ) : (
            <Text style={[styles.infoText, { color: colors.textSecondary }]}>No date set yet</Text>
          )}
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: colors.secondary }]}
            onPress={() => setShowDatePicker(true)}
          >
            <FontAwesome name="calendar" size={16} color="#fff" />
            <Text style={styles.actionButtonText}>
              {couple.anniversary_date ? 'Change Date' : 'Set Anniversary Date'}
            </Text>
          </TouchableOpacity>
          {showDatePicker && (
            <DateTimePicker
              value={
                couple.anniversary_date
                  ? new Date(couple.anniversary_date + 'T00:00:00')
                  : new Date()
              }
              mode="date"
              display="spinner"
              onChange={handleDateChange}
            />
          )}
        </View>
      )}

      {/* Checkpoints Section */}
      {couple && partner && (
        <View
          style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <View style={styles.sectionHeaderRow}>
            <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 0 }]}>
              Checkpoints
            </Text>
            <TouchableOpacity
              style={[styles.addButton, { backgroundColor: colors.primary }]}
              onPress={() => openCheckpointModal()}
            >
              <FontAwesome name="plus" size={14} color="#fff" />
            </TouchableOpacity>
          </View>
          <Text style={[styles.checkpointDescription, { color: colors.textSecondary }]}>
            Get sneak peeks of each other's entries before your anniversary
          </Text>

          {checkpointConfigs.length === 0 ? (
            <Text style={[styles.emptyText, { color: colors.textMuted }]}>
              No checkpoints set. Tap + to add one.
            </Text>
          ) : (
            <View style={styles.checkpointList}>
              {checkpointConfigs.map((config) => (
                <View
                  key={config.id}
                  style={[
                    styles.checkpointItem,
                    { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
                  ]}
                >
                  <View style={styles.checkpointItemLeft}>
                    <View
                      style={[
                        styles.checkpointDot,
                        { backgroundColor: config.is_active ? colors.success : colors.textMuted },
                      ]}
                    />
                    <View style={styles.checkpointItemText}>
                      <Text style={[styles.checkpointItemTitle, { color: colors.text }]}>
                        {formatCheckpointDescription(config)}
                      </Text>
                      <Text style={[styles.checkpointItemSubtitle, { color: colors.textMuted }]}>
                        {formatCheckpointFrequency(config.frequency, config.specific_date)}
                        {!config.is_active && ' (Paused)'}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.checkpointItemActions}>
                    <TouchableOpacity
                      style={styles.checkpointItemButton}
                      onPress={() => openCheckpointModal(config)}
                    >
                      <FontAwesome name="pencil" size={14} color={colors.textSecondary} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.checkpointItemButton}
                      onPress={() => handleDeleteCheckpoint(config)}
                    >
                      <FontAwesome name="trash" size={14} color={colors.error} />
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          )}

          {checkpointConfigs.length > 0 && (
            <Text style={[styles.nextCheckpointText, { color: colors.textSecondary }]}>
              Next checkpoint: {formatNextCheckpointDate(getNextCheckpointDate(checkpointConfigs))}
            </Text>
          )}
        </View>
      )}

      {/* Checkpoint Config Modal */}
      <Modal
        visible={showCheckpointModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowCheckpointModal(false)}
      >
        <SafeAreaView style={[styles.modalContainer, { backgroundColor: colors.background }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={() => setShowCheckpointModal(false)}>
              <Text style={[styles.modalCancel, { color: colors.textSecondary }]}>Cancel</Text>
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {editingCheckpoint ? 'Edit Checkpoint' : 'New Checkpoint'}
            </Text>
            <TouchableOpacity onPress={handleSaveCheckpoint} disabled={checkpointLoading}>
              <Text style={[styles.modalSave, { color: colors.primary }]}>
                {checkpointLoading ? 'Saving...' : 'Save'}
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalContent} contentContainerStyle={styles.modalContentInner}>
            {/* Label */}
            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: colors.text }]}>Label (optional)</Text>
              <TextInput
                style={[
                  styles.formInput,
                  {
                    backgroundColor: colors.surfaceSecondary,
                    color: colors.text,
                    borderColor: colors.border,
                  },
                ]}
                placeholder="e.g., Monthly Peek, Sarah's Birthday"
                placeholderTextColor={colors.textMuted}
                value={checkpointLabel}
                onChangeText={setCheckpointLabel}
              />
            </View>

            {/* Frequency */}
            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: colors.text }]}>Frequency</Text>
              <View style={styles.frequencyOptions}>
                {FREQUENCY_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[
                      styles.frequencyOption,
                      {
                        backgroundColor:
                          checkpointFrequency === opt.value
                            ? colors.primary
                            : colors.surfaceSecondary,
                        borderColor:
                          checkpointFrequency === opt.value ? colors.primary : colors.border,
                      },
                    ]}
                    onPress={() => setCheckpointFrequency(opt.value)}
                  >
                    <Text
                      style={[
                        styles.frequencyOptionText,
                        { color: checkpointFrequency === opt.value ? '#fff' : colors.text },
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Day of Month (for monthly, quarterly, semi_annual) */}
            {checkpointFrequency !== 'specific_date' && (
              <View style={styles.formGroup}>
                <Text style={[styles.formLabel, { color: colors.text }]}>Day of Month</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.dayScroller}
                >
                  {DAY_OPTIONS.map((day) => (
                    <TouchableOpacity
                      key={day}
                      style={[
                        styles.dayOption,
                        {
                          backgroundColor:
                            checkpointDay === day ? colors.primary : colors.surfaceSecondary,
                          borderColor: checkpointDay === day ? colors.primary : colors.border,
                        },
                      ]}
                      onPress={() => setCheckpointDay(day)}
                    >
                      <Text
                        style={[
                          styles.dayOptionText,
                          { color: checkpointDay === day ? '#fff' : colors.text },
                        ]}
                      >
                        {day}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Specific Date */}
            {checkpointFrequency === 'specific_date' && (
              <View style={styles.formGroup}>
                <Text style={[styles.formLabel, { color: colors.text }]}>Date</Text>
                <TouchableOpacity
                  style={[
                    styles.dateButton,
                    { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
                  ]}
                  onPress={() => setShowCheckpointDatePicker(true)}
                >
                  <FontAwesome name="calendar" size={16} color={colors.textSecondary} />
                  <Text style={[styles.dateButtonText, { color: colors.text }]}>
                    {formatEntryDate(checkpointSpecificDate.toISOString().split('T')[0])}
                  </Text>
                </TouchableOpacity>
                {showCheckpointDatePicker && (
                  <DateTimePicker
                    value={checkpointSpecificDate}
                    mode="date"
                    display="spinner"
                    onChange={(_, date) => {
                      setShowCheckpointDatePicker(Platform.OS === 'ios');
                      if (date) setCheckpointSpecificDate(date);
                    }}
                  />
                )}
              </View>
            )}

            {/* Active Toggle */}
            <View style={[styles.formGroup, styles.toggleRow]}>
              <View>
                <Text style={[styles.formLabel, { color: colors.text, marginBottom: 0 }]}>
                  Active
                </Text>
                <Text style={[styles.formHint, { color: colors.textMuted }]}>
                  Pause to temporarily disable
                </Text>
              </View>
              <Switch
                value={checkpointActive}
                onValueChange={setCheckpointActive}
                trackColor={{ false: colors.border, true: colors.primary }}
              />
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Sign Out */}
      <TouchableOpacity
        style={[styles.signOutButton, { borderColor: colors.error }]}
        onPress={handleSignOut}
      >
        <FontAwesome name="sign-out" size={16} color={colors.error} />
        <Text style={[styles.signOutText, { color: colors.error }]}>Sign Out</Text>
      </TouchableOpacity>
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
  section: {
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
    borderWidth: 1,
  },
  sectionTitle: {
    fontSize: FontSize.lg,
    fontWeight: '600',
    marginBottom: Spacing.md,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarImage: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  avatarEditBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  avatarText: {
    color: '#fff',
    fontSize: FontSize.lg,
    fontWeight: '700',
  },
  profileName: {
    fontSize: FontSize.md,
    fontWeight: '500',
  },
  nameEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  nameInput: {
    flex: 1,
    height: 36,
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.sm,
    fontSize: FontSize.md,
  },
  actionButton: {
    flexDirection: 'row',
    height: 44,
    borderRadius: BorderRadius.sm,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  actionButtonText: {
    color: '#fff',
    fontSize: FontSize.md,
    fontWeight: '600',
  },
  orText: {
    textAlign: 'center',
    fontSize: FontSize.sm,
    marginVertical: Spacing.sm,
  },
  input: {
    height: 44,
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    fontSize: FontSize.md,
  },
  infoText: {
    fontSize: FontSize.md,
    marginBottom: Spacing.sm,
  },
  codeBox: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    borderWidth: 1,
  },
  codeText: {
    fontSize: FontSize.xxl,
    fontWeight: '700',
    letterSpacing: 4,
  },
  hintText: {
    fontSize: FontSize.sm,
    textAlign: 'center',
    marginTop: Spacing.md,
  },
  partnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  partnerAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  partnerAvatarImage: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  partnerName: {
    fontSize: FontSize.md,
    fontWeight: '500',
  },
  partnerStatus: {
    fontSize: FontSize.sm,
    fontWeight: '500',
    marginTop: 2,
  },
  dateDisplay: {
    fontSize: FontSize.lg,
    fontWeight: '500',
    marginBottom: Spacing.sm,
  },
  signOutButton: {
    flexDirection: 'row',
    height: 44,
    borderRadius: BorderRadius.sm,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.sm,
    borderWidth: 1,
    marginTop: Spacing.md,
  },
  signOutText: {
    fontSize: FontSize.md,
    fontWeight: '500',
  },
  unpairButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    marginTop: Spacing.lg,
  },
  unpairButtonText: {
    fontSize: FontSize.sm,
    fontWeight: '600',
  },
  // Checkpoint styles
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  addButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkpointDescription: {
    fontSize: FontSize.sm,
    marginBottom: Spacing.md,
  },
  emptyText: {
    fontSize: FontSize.sm,
    textAlign: 'center',
    paddingVertical: Spacing.md,
  },
  checkpointList: {
    gap: Spacing.sm,
  },
  checkpointItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  checkpointItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: Spacing.sm,
  },
  checkpointDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  checkpointItemText: {
    flex: 1,
  },
  checkpointItemTitle: {
    fontSize: FontSize.md,
    fontWeight: '500',
  },
  checkpointItemSubtitle: {
    fontSize: FontSize.xs,
    marginTop: 2,
  },
  checkpointItemActions: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  checkpointItemButton: {
    padding: Spacing.xs,
  },
  nextCheckpointText: {
    fontSize: FontSize.sm,
    marginTop: Spacing.md,
    textAlign: 'center',
  },
  // Modal styles
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.md,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: FontSize.lg,
    fontWeight: '600',
  },
  modalCancel: {
    fontSize: FontSize.md,
  },
  modalSave: {
    fontSize: FontSize.md,
    fontWeight: '600',
  },
  modalContent: {
    flex: 1,
  },
  modalContentInner: {
    padding: Spacing.lg,
  },
  formGroup: {
    marginBottom: Spacing.lg,
  },
  formLabel: {
    fontSize: FontSize.md,
    fontWeight: '500',
    marginBottom: Spacing.sm,
  },
  formHint: {
    fontSize: FontSize.xs,
    marginTop: 2,
  },
  formInput: {
    height: 44,
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    fontSize: FontSize.md,
  },
  frequencyOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  frequencyOption: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
  },
  frequencyOptionText: {
    fontSize: FontSize.sm,
    fontWeight: '500',
  },
  dayScroller: {
    maxHeight: 44,
  },
  dayOption: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.xs,
    borderWidth: 1,
  },
  dayOptionText: {
    fontSize: FontSize.sm,
    fontWeight: '600',
  },
  dateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    height: 44,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
  },
  dateButtonText: {
    fontSize: FontSize.md,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
