import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../components/Button';
import {
  Modal,
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  useColorScheme,
  StyleSheet,
} from 'react-native';
import { useLocationSearch } from '../../hooks/useLocationSearch';
import { Colors, Spacing } from '../../constants/theme';
export function LocationSheet({
  visible,
  onClose,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (name: string, lat: number, lng: number) => void;
}) {
  const search = useLocationSearch(visible);
  const colors = Colors[useColorScheme() ?? 'light'];
  return (
    <Modal visible={visible} onRequestClose={onClose} animationType="slide">
      <SafeAreaProvider>
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
          <Button title="Cancel location" onPress={onClose} />
          <TextInput
            accessibilityLabel="Search locations"
            placeholder="Place or address"
            placeholderTextColor={colors.textMuted}
            value={search.query}
            onChangeText={search.setQuery}
            style={[styles.input, { color: colors.text, borderColor: colors.border }]}
          />
          {search.error && (
            <View>
              <Text accessibilityRole="alert" style={{ color: colors.error }}>
                {search.error}
              </Text>
              <Button title="Retry location search" onPress={() => void search.retry()} />
            </View>
          )}
          {search.loading && <Text style={{ color: colors.text }}>Searching…</Text>}
          <FlatList
            data={search.results}
            keyExtractor={(r) => r.placeId ?? `${r.lat}:${r.lng}:${r.name}`}
            renderItem={({ item }) => (
              <TouchableOpacity
                accessibilityRole="button"
                style={styles.row}
                disabled={search.loading}
                onPress={async () => {
                  const full = await search.select(item);
                  if (full) onSelect(full.name, full.lat, full.lng);
                }}
              >
                <Text style={{ color: colors.text }}>{item.name}</Text>
                <Text style={{ color: colors.textSecondary }}>{item.address}</Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              !search.loading && !search.error && search.query ? (
                <Text style={{ color: colors.textSecondary }}>No matching locations.</Text>
              ) : null
            }
          />
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, padding: Spacing.md, gap: Spacing.md },
  input: { borderWidth: 1, padding: Spacing.md, borderRadius: 8 },
  row: { paddingVertical: Spacing.lg },
});
