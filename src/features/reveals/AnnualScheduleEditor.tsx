import { useState } from 'react';
import {
  View,
  Text,
  Button,
  Modal,
  SafeAreaView,
  ScrollView,
  Alert,
  useColorScheme,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useCouple } from '../../providers/CoupleProvider';
import { Colors, Spacing } from '../../constants/theme';
import { ScheduleFields } from './ScheduleFields';
import { calendarDate, validTimezone } from './time';

export function AnnualScheduleEditor() {
  const { couple, saveAnnualSchedule } = useCouple();
  const colors = Colors[useColorScheme() ?? 'light'];
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(new Date());
  const [time, setTime] = useState('00:00');
  const [zone, setZone] = useState('UTC');
  const [version, setVersion] = useState(1);
  const [saving, setSaving] = useState(false);
  if (!couple) return null;
  return (
    <View style={{ gap: 12 }}>
      <Text style={{ fontSize: 22, color: colors.text }}>Anniversary reveal</Text>
      <Text style={{ color: colors.text }}>
        {couple.anniversary_date || 'No date set'} · {couple.reveal_time.slice(0, 5)} ·{' '}
        {couple.reveal_timezone}
      </Text>
      <Button
        title="Set anniversary date and time"
        onPress={() => {
          setDate(
            couple.anniversary_date ? new Date(`${couple.anniversary_date}T12:00:00`) : new Date()
          );
          setVersion(couple.schedule_version);
          setTime(couple.reveal_time);
          setZone(couple.reveal_timezone);
          setOpen(true);
        }}
      />
      {open && (
        <Modal
          visible={open}
          onRequestClose={() => {
            if (!saving) setOpen(false);
          }}
          animationType="slide"
        >
          <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
            <ScrollView contentContainerStyle={{ padding: Spacing.lg, gap: 16 }}>
              <Text style={{ fontSize: 24, color: colors.text }}>Anniversary schedule</Text>
              <Text style={{ color: colors.text }}>
                Choose your relationship start date. The reveal repeats each year; February 29 opens
                on March 1 in other years. Opened capsules keep their original boundary and recap.
              </Text>
              <DateTimePicker
                value={date}
                mode="date"
                display="spinner"
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
              <Text style={{ color: colors.text }}>
                Save: {calendarDate(date)} at {time.slice(0, 5)} · {zone}
              </Text>
              <Button
                title={saving ? 'Saving…' : 'Save anniversary schedule'}
                disabled={saving}
                onPress={async () => {
                  if (!validTimezone(zone.trim())) {
                    Alert.alert('Timezone', 'Choose a valid IANA timezone.');
                    return;
                  }
                  setSaving(true);
                  try {
                    await saveAnnualSchedule(calendarDate(date), time, zone.trim(), version);
                    setOpen(false);
                  } catch (e: any) {
                    Alert.alert('Could not save schedule', e.message);
                  } finally {
                    setSaving(false);
                  }
                }}
              />
              <Button title="Cancel" disabled={saving} onPress={() => setOpen(false)} />
            </ScrollView>
          </SafeAreaView>
        </Modal>
      )}
    </View>
  );
}
