import { useState } from 'react';
import { View, Text, Pressable, useColorScheme, StyleSheet, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Colors, Spacing, BorderRadius, FontSize } from '../../constants/theme';
import { DST_RULE, formatWallTime, wallTime } from './time';
import { TimezonePicker } from './TimezonePicker';

export function ScheduleFields({
  time,
  zone,
  onTime,
  onZone,
  disabled = false,
}: {
  time: string;
  zone: string;
  onTime: (time: string) => void;
  onZone: (zone: string) => void;
  disabled?: boolean;
}) {
  const [picker, setPicker] = useState(false);
  const [timezoneOpen, setTimezoneOpen] = useState(false);
  const [details, setDetails] = useState(false);
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const [h, m] = time.split(':').map(Number);
  return (
    <View style={styles.form}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Choose exact time"
        accessibilityState={{ expanded: picker, disabled }}
        disabled={disabled}
        style={[styles.field, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => setPicker((value) => !value)}
      >
        <FontAwesome name="clock-o" size={20} color={colors.primary} />
        <View style={styles.fieldText}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>Reveal time</Text>
          <Text style={[styles.value, { color: colors.text }]}>{formatWallTime(time)}</Text>
        </View>
        <FontAwesome
          name={picker ? 'chevron-up' : 'chevron-down'}
          size={12}
          color={colors.textMuted}
        />
      </Pressable>
      {picker && (
        <DateTimePicker
          value={new Date(2000, 0, 15, h || 0, m || 0)}
          disabled={disabled}
          mode="time"
          display="spinner"
          themeVariant={scheme}
          onChange={(_, date) => {
            if (date) onTime(wallTime(date));
            if (Platform.OS !== 'ios') setPicker(false);
          }}
        />
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Reveal timezone"
        accessibilityValue={{ text: zone }}
        disabled={disabled}
        accessibilityState={{ disabled }}
        onPress={() => setTimezoneOpen(true)}
        style={[styles.field, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <FontAwesome name="globe" size={20} color={colors.primary} />
        <View style={styles.fieldText}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>Timezone</Text>
          <Text style={[styles.value, { color: colors.text }]}>{zone.replace(/_/g, ' ')}</Text>
        </View>
        <FontAwesome name="chevron-right" size={12} color={colors.textMuted} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: details }}
        onPress={() => setDetails((value) => !value)}
        style={styles.detailsButton}
      >
        <FontAwesome name="info-circle" size={16} color={colors.textSecondary} />
        <Text style={[styles.label, { color: colors.textSecondary }]}>How timing works</Text>
        <FontAwesome
          name={details ? 'chevron-up' : 'chevron-down'}
          size={10}
          color={colors.textMuted}
        />
      </Pressable>
      {details && (
        <Text style={[styles.hint, { color: colors.textSecondary }]}>
          {DST_RULE} Missed reveals stay available. Changes apply to future reveals; opened memories
          stay saved.
        </Text>
      )}
      <TimezonePicker
        visible={timezoneOpen}
        zone={zone}
        onSelect={onZone}
        onClose={() => setTimezoneOpen(false)}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  form: { gap: Spacing.sm },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    borderWidth: 1,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    minHeight: 64,
  },
  fieldText: { flex: 1 },
  label: { fontSize: FontSize.sm },
  value: { fontSize: FontSize.md, fontWeight: '500', marginTop: Spacing.xs },
  detailsButton: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center', minHeight: 44 },
  hint: { fontSize: FontSize.sm, lineHeight: 21 },
});
