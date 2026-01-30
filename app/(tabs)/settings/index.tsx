import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  useColorScheme,
  Share,
  Platform,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useAuth } from '../../../src/providers/AuthProvider';
import { useCouple } from '../../../src/hooks/useCouple';
import { signOut } from '../../../src/lib/auth';
import { formatEntryDate } from '../../../src/lib/date-utils';
import { Colors, Spacing, FontSize, BorderRadius } from '../../../src/constants/theme';

export default function SettingsScreen() {
  const { profile } = useAuth();
  const {
    couple,
    partner,
    createCouple,
    joinCouple,
    setAnniversaryDate,
    loading,
  } = useCouple();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const [inviteInput, setInviteInput] = useState('');
  const [joiningLoading, setJoiningLoading] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);

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
      <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Profile</Text>
        <View style={styles.profileRow}>
          <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
            <Text style={styles.avatarText}>
              {profile?.display_name?.charAt(0)?.toUpperCase() || '?'}
            </Text>
          </View>
          <View>
            <Text style={[styles.profileName, { color: colors.text }]}>
              {profile?.display_name}
            </Text>
          </View>
        </View>
      </View>

      {/* Pairing Section */}
      <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
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
                { backgroundColor: colors.surfaceSecondary, color: colors.text, borderColor: colors.border },
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
            <View style={[styles.codeBox, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
              <Text style={[styles.codeText, { color: colors.primary }]}>
                {couple.invite_code}
              </Text>
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
          </>
        ) : (
          <View style={styles.partnerRow}>
            <View style={[styles.partnerAvatar, { backgroundColor: colors.accent }]}>
              <Text style={styles.avatarText}>
                {partner.display_name?.charAt(0)?.toUpperCase() || '?'}
              </Text>
            </View>
            <View>
              <Text style={[styles.partnerName, { color: colors.text }]}>
                {partner.display_name}
              </Text>
              <Text style={[styles.partnerStatus, { color: colors.success }]}>Connected</Text>
            </View>
          </View>
        )}
      </View>

      {/* Anniversary Date Section */}
      {couple && partner && (
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Anniversary Date</Text>
          {couple.anniversary_date ? (
            <Text style={[styles.dateDisplay, { color: colors.text }]}>
              {formatEntryDate(couple.anniversary_date)}
            </Text>
          ) : (
            <Text style={[styles.infoText, { color: colors.textSecondary }]}>
              No date set yet
            </Text>
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
  avatarText: {
    color: '#fff',
    fontSize: FontSize.lg,
    fontWeight: '700',
  },
  profileName: {
    fontSize: FontSize.md,
    fontWeight: '500',
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
});
