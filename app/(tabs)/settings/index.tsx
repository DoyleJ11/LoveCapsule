import { SafeAreaView } from 'react-native-safe-area-context';
import { errorMessage } from '../../../src/lib/errors';
import { useState, useEffect, useCallback, useRef } from 'react';
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
  Switch,
} from 'react-native';
import { uuid } from 'expo-modules-core';
import { useFocusEffect } from '@react-navigation/native';
import { AnnualScheduleEditor } from '../../../src/features/reveals/AnnualScheduleEditor';
import { Button, IconButton } from '../../../src/components/Button';
import { ScheduleFields } from '../../../src/features/reveals/ScheduleFields';
import {
  calendarDate,
  deviceTimezone,
  formatWallTime,
  validTimezone,
  formatRevealInstant,
} from '../../../src/features/reveals/time';
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
} from '../../../src/lib/date-utils';
import { Colors, Spacing, FontSize, BorderRadius } from '../../../src/constants/theme';
import { registerForPushNotifications, unregisterPushDevice } from '../../../src/lib/notifications';
import { requestDeletion } from '../../../src/features/account/deletion';
import { uuid as avatarUuid } from 'expo-modules-core';
import type { CheckpointConfig, CheckpointFrequency } from '../../../src/types/database';

const FREQUENCY_OPTIONS: { value: CheckpointFrequency; label: string }[] = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'semi_annual', label: 'Every 6 months' },
  { value: 'specific_date', label: 'One-time date' },
];

const DAY_OPTIONS = Array.from({ length: 31 }, (_, i) => i + 1);

export default function SettingsScreen() {
  const { profile, user, refreshProfile } = useAuth();
  const {
    couple,
    partner,
    createCouple,
    joinCouple,
    overview,
    refresh,
    unpairCouple,
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
  const [notificationLoading, setNotificationLoading] = useState(false);
  const notificationBusy = useRef(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const deletionBusy = useRef(false);
  const [unpairingLoading, setUnpairingLoading] = useState(false);
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const [inviteInput, setInviteInput] = useState('');
  const [joiningLoading, setJoiningLoading] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(profile?.display_name || '');
  // Checkpoint modal state
  const checkpointCreateId = useRef<string | null>(null);
  const [checkpointModalScope, setCheckpointModalScope] = useState<string>();
  const [showCheckpointModal, setShowCheckpointModal] = useState(false);
  const [editingCheckpoint, setEditingCheckpoint] = useState<CheckpointConfig | null>(null);
  const [checkpointFrequency, setCheckpointFrequency] = useState<CheckpointFrequency>('monthly');
  const [checkpointDay, setCheckpointDay] = useState(15);
  const [, setCheckpointMonths] = useState<number[]>([3, 6, 9, 12]);
  const [checkpointSpecificDate, setCheckpointSpecificDate] = useState<Date>(new Date());
  const [checkpointTime, setCheckpointTime] = useState('00:00');
  const [checkpointZone, setCheckpointZone] = useState(deviceTimezone);
  const [checkpointLabel, setCheckpointLabel] = useState('');
  const [checkpointActive, setCheckpointActive] = useState(true);
  const [showCheckpointDatePicker, setShowCheckpointDatePicker] = useState(false);

  // Load checkpoint configs when couple is available
  useEffect(() => {
    if (couple?.id && partner) {
      loadConfigs(couple.id);
    }
  }, [couple?.id, partner, loadConfigs, overview?.server_now]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  const openCheckpointModal = (config?: CheckpointConfig) => {
    setCheckpointModalScope(`${user?.id}:${couple?.id}`);
    setShowCheckpointDatePicker(false);
    checkpointCreateId.current = config?.id ?? uuid.v4();
    setCheckpointTime(config?.reveal_time ?? couple?.reveal_time ?? '00:00');
    setCheckpointZone(config?.timezone ?? deviceTimezone());
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
      if (!validTimezone(checkpointZone.trim())) throw new Error('Choose a valid IANA timezone.');
      const configData = {
        id: checkpointCreateId.current!,
        version: editingCheckpoint?.version ?? undefined,
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
          checkpointFrequency === 'specific_date' ? calendarDate(checkpointSpecificDate) : null,
        label: checkpointLabel.trim() || null,
        reveal_time: checkpointTime,
        timezone: checkpointZone.trim(),
        is_active: checkpointActive,
      };

      if (editingCheckpoint) {
        await updateConfig(editingCheckpoint.id, configData);
      } else {
        await createConfig(configData);
      }

      setShowCheckpointModal(false);
    } catch (e: unknown) {
      Alert.alert('Error', errorMessage(e));
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
            } catch (e: unknown) {
              Alert.alert('Error', errorMessage(e));
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
    } catch (e: unknown) {
      Alert.alert('Error', errorMessage(e));
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
        `${avatarUuid.v4()}.jpg`,
        'image/jpeg'
      );
      const { error } = await supabase
        .from('profiles')
        .update({ avatar_url: storagePath, updated_at: new Date().toISOString() })
        .eq('id', user.id);
      if (error) throw error;
      await refreshProfileAvatar(storagePath);
      await refreshProfile();
    } catch (e: unknown) {
      Alert.alert('Error', errorMessage(e) || 'Failed to update profile picture');
    }
  };

  const handleCreateCouple = async () => {
    try {
      const code = await createCouple();
      Alert.alert('Invite Code Created', `Share this code with your partner: ${code}`);
    } catch (e: unknown) {
      Alert.alert('Error', errorMessage(e));
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
    } catch (e: unknown) {
      Alert.alert('Error', errorMessage(e));
    } finally {
      setJoiningLoading(false);
    }
  };

  const handleShareCode = async () => {
    if (!couple?.invite_code) return;
    try {
      await Share.share({
        message: `Join my LoveCapsule! Use this invite code: ${couple.invite_code}`,
      });
    } catch {
      // User cancelled share
    }
  };

  const handleUnpair = () => {
    Alert.alert(
      'Unpair from Partner',
      'Are you sure you want to unpair? This will permanently delete ALL diary entries, photos, and memories for BOTH you and your partner. Private file cleanup may continue in the background. This cannot be undone.',
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
                'You are unpaired and the shared diary records have been removed. Private file cleanup is queued and continues in the background.'
              );
            } catch (e: unknown) {
              Alert.alert('Error', errorMessage(e));
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
          } catch (e: unknown) {
            Alert.alert('Error', errorMessage(e));
          }
        },
      },
    ]);
  };

  const handleNotifications = async (enable: boolean) => {
    if (!user || notificationBusy.current) return;
    notificationBusy.current = true;
    setNotificationLoading(true);
    try {
      if (enable) {
        const token = await registerForPushNotifications(user.id, true);
        await refreshProfile();
        Alert.alert(
          'Notifications',
          token
            ? 'Enabled on this phone.'
            : 'Allow notifications in iPhone Settings to enable reminders.'
        );
      } else {
        await unregisterPushDevice();
        Alert.alert('Notifications', 'Disabled on this phone.');
      }
    } catch (e) {
      Alert.alert('Notifications', errorMessage(e));
    } finally {
      notificationBusy.current = false;
      setNotificationLoading(false);
    }
  };
  const handleDeleteAccount = () => {
    if (!user || deletionBusy.current) return;
    Alert.alert(
      'Delete account?',
      'This removes your account and the shared diary for both partners. Private file cleanup continues securely in the background. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: async () => {
            if (deletionBusy.current) return;
            deletionBusy.current = true;
            setDeletingAccount(true);
            try {
              await requestDeletion('account', user.id);
              await signOut();
            } catch (e) {
              Alert.alert('Deletion', errorMessage(e));
            } finally {
              deletionBusy.current = false;
              setDeletingAccount(false);
            }
          },
        },
      ]
    );
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
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Change profile photo"
            onPress={handleChangeAvatar}
          >
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
            ) : (
              <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
                <Text maxFontSizeMultiplier={1.2} style={styles.avatarText}>
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
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Save display name"
                  onPress={handleUpdateName}
                >
                  <FontAwesome name="check" size={18} color={colors.primary} />
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="button"
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
                accessibilityRole="button"
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
              accessibilityRole="button"
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
              accessibilityRole="button"
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
              accessibilityRole="button"
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
              accessibilityRole="button"
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
                  <Text maxFontSizeMultiplier={1.2} style={styles.avatarText}>
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
              accessibilityRole="button"
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
          <AnnualScheduleEditor />
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
              accessibilityRole="button"
              style={[styles.addButton, { backgroundColor: colors.primary }]}
              accessibilityLabel="Add reveal checkpoint"
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
                        {` · ${config.reveal_time?.slice(0, 5) ?? '00:00'} · ${config.timezone ?? 'UTC'}`}
                        {!config.is_active && ' (Paused)'}
                        {config.schedule_error && ` · ${config.schedule_error}`}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.checkpointItemActions}>
                    <IconButton
                      label={`Edit ${config.label || 'checkpoint'}`}
                      icon="pencil"
                      onPress={() => openCheckpointModal(config)}
                    />
                    <IconButton
                      label={`Delete ${config.label || 'checkpoint'}`}
                      icon="trash"
                      destructive
                      onPress={() => handleDeleteCheckpoint(config)}
                    />
                  </View>
                </View>
              ))}
            </View>
          )}

          {checkpointConfigs.length > 0 && (
            <Text style={[styles.nextCheckpointText, { color: colors.textSecondary }]}>
              Next checkpoint:{' '}
              {overview?.checkpoints[0]
                ? formatRevealInstant(
                    overview.checkpoints[0].due_at,
                    overview.checkpoints[0].timezone
                  )
                : 'No pending checkpoint'}
            </Text>
          )}
        </View>
      )}

      {/* Checkpoint Config Modal */}
      <Modal
        visible={showCheckpointModal && checkpointModalScope === `${user?.id}:${couple?.id}`}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => {
          if (!checkpointLoading) setShowCheckpointModal(false);
        }}
      >
        <SafeAreaView style={[styles.modalContainer, { backgroundColor: colors.background }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <Button
              title="Cancel"
              compact
              disabled={checkpointLoading}
              onPress={() => setShowCheckpointModal(false)}
            />
            <Text maxFontSizeMultiplier={1.4} style={[styles.modalTitle, { color: colors.text }]}>
              {editingCheckpoint ? 'Edit Checkpoint' : 'New Checkpoint'}
            </Text>
            <Button
              title="Save"
              variant="primary"
              compact
              loading={checkpointLoading}
              onPress={handleSaveCheckpoint}
            />
          </View>

          <ScrollView
            pointerEvents={checkpointLoading ? 'none' : 'auto'}
            style={styles.modalContent}
            contentContainerStyle={styles.modalContentInner}
          >
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
                    accessibilityRole="button"
                    key={opt.value}
                    style={[
                      styles.frequencyOption,
                      {
                        backgroundColor:
                          checkpointFrequency === opt.value
                            ? colors.primaryAction
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
                <View style={styles.dayGrid}>
                  {DAY_OPTIONS.map((day) => (
                    <TouchableOpacity
                      accessibilityRole="button"
                      key={day}
                      hitSlop={2}
                      accessibilityLabel={`Day ${day}`}
                      accessibilityState={{ selected: checkpointDay === day }}
                      style={[
                        styles.dayOption,
                        {
                          backgroundColor:
                            checkpointDay === day ? colors.primaryAction : colors.surfaceSecondary,
                          borderColor: checkpointDay === day ? colors.primary : colors.border,
                        },
                      ]}
                      onPress={() => setCheckpointDay(day)}
                    >
                      <Text
                        maxFontSizeMultiplier={1.4}
                        style={[
                          styles.dayOptionText,
                          { color: checkpointDay === day ? '#fff' : colors.text },
                        ]}
                      >
                        {day}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {checkpointDay > 28 && (
                  <Text style={[styles.formHint, { color: colors.textSecondary }]}>
                    Shorter months use their last day.
                  </Text>
                )}
              </View>
            )}

            {/* Specific Date */}
            {checkpointFrequency === 'specific_date' && (
              <View style={styles.formGroup}>
                <Text style={[styles.formLabel, { color: colors.text }]}>Date</Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  style={[
                    styles.dateButton,
                    { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
                  ]}
                  onPress={() => setShowCheckpointDatePicker(true)}
                >
                  <FontAwesome name="calendar" size={16} color={colors.textSecondary} />
                  <Text style={[styles.dateButtonText, { color: colors.text }]}>
                    {formatEntryDate(calendarDate(checkpointSpecificDate))}
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

            <ScheduleFields
              disabled={checkpointLoading}
              time={checkpointTime}
              zone={checkpointZone}
              onTime={setCheckpointTime}
              onZone={setCheckpointZone}
            />
            <Text style={[styles.scheduleSummary, { color: colors.textSecondary }]}>
              {checkpointFrequency === 'specific_date'
                ? `One time on ${formatEntryDate(calendarDate(checkpointSpecificDate))}`
                : `${FREQUENCY_OPTIONS.find((option) => option.value === checkpointFrequency)?.label} on day ${checkpointDay}`}
              {' at '}
              {formatWallTime(checkpointTime)}.
            </Text>
            {/* Active Toggle */}
            <View style={[styles.formGroup, styles.toggleRow]}>
              <View style={styles.toggleText}>
                <Text style={[styles.formLabel, { color: colors.text, marginBottom: 0 }]}>
                  Active
                </Text>
                <Text style={[styles.formHint, { color: colors.textMuted }]}>
                  Pause future occurrences; due reveals stay saved
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

      <View
        style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Notifications</Text>
        <Text style={[styles.notificationDescription, { color: colors.textSecondary }]}>
          Optional reminders contain no diary text. Reveals work even when notifications are off.
        </Text>
        <View style={styles.notificationActions}>
          <Button
            compact
            title="Enable"
            variant="primary"
            icon="bell"
            disabled={notificationLoading}
            style={styles.equalAction}
            onPress={() => void handleNotifications(true)}
          />
          <Button
            compact
            title="Disable"
            icon="bell-slash"
            disabled={notificationLoading}
            style={styles.equalAction}
            onPress={() => void handleNotifications(false)}
          />
        </View>
      </View>
      <View
        style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Account</Text>
        <Text style={[styles.notificationDescription, { color: colors.textSecondary }]}>
          Permanently removes your account and the shared diary for both partners.
        </Text>
        <Button
          title="Delete my account and diary"
          variant="destructive"
          icon="trash"
          loading={deletingAccount}
          onPress={handleDeleteAccount}
        />
      </View>

      {/* Sign Out */}
      <TouchableOpacity
        accessibilityRole="button"
        style={[styles.signOutButton, { borderColor: colors.error }]}
        disabled={deletingAccount}
        onPress={handleSignOut}
      >
        <FontAwesome name="sign-out" size={16} color={colors.error} />
        <Text style={[styles.signOutText, { color: colors.error }]}>Sign Out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  notificationDescription: { fontSize: FontSize.sm, lineHeight: 21, marginBottom: Spacing.md },
  notificationActions: { flexDirection: 'row', gap: Spacing.sm },
  equalAction: { flex: 1 },
  scheduleSummary: { fontSize: FontSize.sm, lineHeight: 21, marginVertical: Spacing.md },
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
    width: 44,
    height: 44,
    borderRadius: 22,
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
    gap: Spacing.xs,
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
    flex: 1,
    textAlign: 'center',
    marginHorizontal: Spacing.sm,
    fontSize: FontSize.lg,
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
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
  },
  frequencyOptionText: {
    fontSize: FontSize.sm,
    fontWeight: '500',
  },
  dayGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    rowGap: Spacing.sm,
  },
  dayOption: {
    width: '13%',
    marginRight: '1%',
    minHeight: 44,
    borderRadius: BorderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
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
  toggleText: { flex: 1 },
  toggleRow: {
    gap: Spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
