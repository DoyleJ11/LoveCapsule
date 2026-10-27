import { errorMessage } from '../../lib/errors';
import { useRef, useState } from 'react';
import {
  View,
  Text,
  Modal,
  ScrollView,
  Alert,
  useColorScheme,
  StyleSheet,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useCouple } from '../../providers/CoupleProvider';
import { Colors, Spacing, FontSize } from '../../constants/theme';
import { Button } from '../../components/Button';
import { ScheduleFields } from './ScheduleFields';
import { calendarDate, deviceTimezone, formatWallTime, validTimezone } from './time';
import { formatEntryDate } from '../../lib/date-utils';

export function AnnualScheduleEditor() {
  const { couple, saveAnnualSchedule } = useCouple();
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(new Date());
  const [time, setTime] = useState('00:00');
  const [zone, setZone] = useState(deviceTimezone);
  const [version, setVersion] = useState(1);
  const [saving, setSaving] = useState(false);
  const saveInFlight = useRef(false);
  if (!couple) return null;
  const save = async () => {
    if (saveInFlight.current) return;
    if (!validTimezone(zone.trim())) {
      Alert.alert('Timezone', 'Choose a valid timezone.');
      return;
    }
    saveInFlight.current = true;
    setSaving(true);
    try {
      await saveAnnualSchedule(calendarDate(date), time, zone.trim(), version);
      setOpen(false);
    } catch (e: unknown) {
      Alert.alert('Could not save schedule', errorMessage(e));
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  };
  return (
    <View style={styles.cardContent}>
      <View style={styles.headingRow}>
        <FontAwesome name="heart" size={20} color={colors.primary} />
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Anniversary reveal</Text>
      </View>
      <Text style={[styles.date, { color: colors.text }]}>
        {couple.anniversary_date
          ? formatEntryDate(couple.anniversary_date)
          : 'Choose your special day'}
      </Text>
      {couple.anniversary_date && (
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          {formatWallTime(couple.reveal_time)} · {couple.reveal_timezone.replace(/_/g, ' ')}
        </Text>
      )}
      <Button
        title="Set anniversary date and time"
        icon="calendar"
        onPress={() => {
          setDate(
            couple.anniversary_date ? new Date(couple.anniversary_date + 'T12:00:00') : new Date()
          );
          setVersion(couple.schedule_version);
          setTime(couple.reveal_time);
          setZone(couple.anniversary_date ? couple.reveal_timezone : deviceTimezone());
          setOpen(true);
        }}
      />
      {open && (
        <Modal
          visible
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => {
            if (!saveInFlight.current) setOpen(false);
          }}
        >
          <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
            <View style={[styles.header, { borderBottomColor: colors.border }]}>
              <Button title="Cancel" compact disabled={saving} onPress={() => setOpen(false)} />
              <Text maxFontSizeMultiplier={1.4} style={[styles.heading, { color: colors.text }]}>
                Anniversary
              </Text>
              <Button
                title={saving ? 'Saving…' : 'Save'}
                accessibilityLabel="Save anniversary schedule"
                variant="primary"
                compact
                loading={saving}
                onPress={() => void save()}
              />
            </View>
            <ScrollView
              style={styles.screen}
              contentContainerStyle={styles.form}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
                Your relationship start date
              </Text>
              <DateTimePicker
                value={date}
                mode="date"
                display={Platform.OS === 'ios' ? 'inline' : 'default'}
                themeVariant={scheme}
                accentColor={scheme === 'dark' ? colors.primary : colors.primaryAction}
                disabled={saving}
                onChange={(_, value) => {
                  if (value) setDate(value);
                }}
              />
              <ScheduleFields
                disabled={saving}
                time={time}
                zone={zone}
                onTime={setTime}
                onZone={setZone}
              />
              <Text style={[styles.summary, { color: colors.textSecondary }]}>
                Every year on{' '}
                {new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric' }).format(date)}{' '}
                at {formatWallTime(time)}.
                {date.getMonth() === 1 && date.getDate() === 29
                  ? ' Opens March 1 in non-leap years.'
                  : ''}
              </Text>
            </ScrollView>
          </SafeAreaView>
        </Modal>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1 },
  cardContent: { gap: Spacing.sm },
  headingRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' },
  sectionTitle: { fontSize: FontSize.lg, fontWeight: '600', flexShrink: 1 },
  date: { fontSize: FontSize.lg, fontWeight: '500', marginTop: Spacing.sm },
  subtitle: { fontSize: FontSize.sm, lineHeight: 21 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.md,
    borderBottomWidth: 1,
    gap: Spacing.sm,
  },
  heading: { fontSize: FontSize.lg, fontWeight: '600', flex: 1, textAlign: 'center' },
  form: { padding: Spacing.md, gap: Spacing.md, paddingBottom: Spacing.xxl },
  summary: { fontSize: FontSize.sm, lineHeight: 21 },
});
