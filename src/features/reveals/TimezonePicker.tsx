import { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { rawTimeZones, timeZonesNames } from '@vvo/tzdb';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Button } from '../../components/Button';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/theme';
import { deviceTimezone, validTimezone } from './time';

const zones = timeZonesNames.map((name) => {
  const info = rawTimeZones.find((zone) => zone.name === name || zone.group.includes(name));
  return {
    name,
    title: name.split('/').at(-1)!.replace(/_/g, ' '),
    detail: info?.alternativeName ?? name,
    search:
      `${name} ${info?.alternativeName ?? ''} ${info?.mainCities.join(' ') ?? ''}`.toLowerCase(),
  };
});

export function TimezonePicker({
  visible,
  zone,
  onSelect,
  onClose,
}: {
  visible: boolean;
  zone: string;
  onSelect: (zone: string) => void;
  onClose: () => void;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const [query, setQuery] = useState('');
  const results = useMemo(() => {
    const preferred = [zone, deviceTimezone(), 'UTC'];
    const all = [...zones];
    for (const name of preferred) {
      if (validTimezone(name) && !all.some((item) => item.name === name)) {
        all.unshift({
          name,
          title: name.replace(/_/g, ' '),
          detail: name,
          search: name.toLowerCase(),
        });
      }
    }
    return all
      .filter((item) =>
        item.search.replace(/_/g, ' ').includes(query.trim().toLowerCase().replace(/_/g, ' '))
      )
      .sort((a, b) => {
        const term = query.trim().toLowerCase().replace(/_/g, ' ');
        const direct = (item: (typeof all)[number]) =>
          item.name.toLowerCase().replace(/_/g, ' ').includes(term) ||
          item.title.toLowerCase().includes(term);
        return (
          (term ? Number(direct(b)) - Number(direct(a)) : 0) ||
          Number(preferred.includes(b.name)) - Number(preferred.includes(a.name)) ||
          a.title.localeCompare(b.title)
        );
      });
  }, [query, zone]);
  const close = () => {
    setQuery('');
    onClose();
  };
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={close}
    >
      <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
        <View style={styles.header}>
          <Text style={[styles.heading, { color: colors.text }]}>Timezone</Text>
          <Button title="Done" onPress={close} compact />
        </View>
        <TextInput
          accessibilityLabel="Search timezones"
          placeholder="Search city or timezone"
          autoCapitalize="none"
          autoCorrect={false}
          value={query}
          onChangeText={setQuery}
          placeholderTextColor={colors.textMuted}
          style={[
            styles.search,
            { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
          ]}
        />
        <FlatList
          data={results}
          keyExtractor={(item) => item.name}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          keyboardDismissMode="on-drag"
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={{ color: colors.textSecondary }}>No matching timezones.</Text>
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={item.name}
              accessibilityState={{ selected: item.name === zone }}
              onPress={() => {
                onSelect(item.name);
                close();
              }}
              style={[
                styles.row,
                {
                  backgroundColor: colors.surface,
                  borderColor: item.name === zone ? colors.primary : colors.border,
                },
              ]}
            >
              <View style={styles.rowText}>
                <Text style={[styles.zoneTitle, { color: colors.text }]}>{item.title}</Text>
                <Text style={[styles.detail, { color: colors.textSecondary }]}>
                  {item.detail} · {item.name}
                </Text>
              </View>
              {item.name === zone && <FontAwesome name="check" size={16} color={colors.primary} />}
            </Pressable>
          )}
        />
      </SafeAreaView>
    </Modal>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heading: { fontSize: FontSize.xl, fontWeight: '700' },
  search: {
    marginHorizontal: Spacing.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    fontSize: FontSize.md,
  },
  list: { padding: Spacing.md, gap: Spacing.sm },
  row: {
    padding: Spacing.md,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  rowText: { flex: 1 },
  zoneTitle: { fontSize: FontSize.md, fontWeight: '600' },
  detail: { fontSize: FontSize.xs, marginTop: Spacing.xs },
});
