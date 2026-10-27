import { useState } from 'react';
import { View, Text, TextInput, Button, useColorScheme, StyleSheet, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Colors } from '../../constants/theme';
import { DST_RULE, wallTime } from './time';

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
  const colors = Colors[useColorScheme() ?? 'light'];
  const [h, m] = time.split(':').map(Number);
  return (
    <View style={styles.form}>
      <Text style={{ color: colors.text }}>Reveal time · {time.slice(0, 5)}</Text>
      <Button
        disabled={disabled}
        title="Choose exact time"
        onPress={() => setPicker((value) => !value)}
      />
      {picker && (
        <DateTimePicker
          value={new Date(2000, 0, 15, h || 0, m || 0)}
          disabled={disabled}
          mode="time"
          display="spinner"
          onChange={(_, date) => {
            if (date) onTime(wallTime(date));
            if (Platform.OS !== 'ios') setPicker(false);
          }}
        />
      )}
      <Text style={{ color: colors.text }}>Timezone (IANA name)</Text>
      <TextInput
        editable={!disabled}
        accessibilityLabel="Reveal timezone"
        autoCapitalize="none"
        autoCorrect={false}
        value={zone}
        onChangeText={onZone}
        placeholder="America/Los_Angeles"
        placeholderTextColor={colors.textMuted}
        style={[
          styles.input,
          { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface },
        ]}
      />
      <Button
        disabled={disabled}
        title="Use this device’s timezone"
        onPress={() => onZone(Intl.DateTimeFormat().resolvedOptions().timeZone)}
      />
      <Text style={{ color: colors.textSecondary }}>{DST_RULE}</Text>
      <Text style={{ color: colors.text }}>
        Both partners open at {time.slice(0, 5)} in {zone}.
      </Text>
    </View>
  );
}
const styles = StyleSheet.create({
  form: { gap: 10 },
  input: { borderWidth: 1, padding: 12, borderRadius: 8 },
});
