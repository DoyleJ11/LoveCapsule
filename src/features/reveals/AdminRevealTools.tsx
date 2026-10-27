import { View, Button, Alert } from 'react-native';
import { useAuth } from '../../providers/AuthProvider';
import { useCouple } from '../../providers/CoupleProvider';
import { supabase } from '../../lib/supabase';
import { DEV_TOOLS_ENABLED } from '../../lib/dev-tools';
/** Retain the project's existing admin-only staging controls. Server checks admin too. */
export function AdminRevealTools() {
  const { profile } = useAuth();
  const { couple, refresh } = useCouple();
  if (!DEV_TOOLS_ENABLED || !profile?.is_admin || !couple) return null;
  const change = (reset: boolean) =>
    Alert.alert(
      reset ? 'Reset test reveal?' : 'Force test reveal?',
      'Admin testing changes reveal access and history for this couple.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: reset ? 'Reset' : 'Force',
          style: 'destructive',
          onPress: async () => {
            const year = Number(
              new Intl.DateTimeFormat('en-US', {
                timeZone: couple.reveal_timezone,
                year: 'numeric',
              }).format()
            );
            const { error } = await supabase.rpc('dev_set_reveal_state', {
              p_couple_id: couple.id,
              p_last_reveal_year: reset ? null : year,
              p_is_revealed: !reset,
            });
            if (error) Alert.alert('Admin reveal', error.message);
            await refresh();
          },
        },
      ]
    );
  return (
    <View>
      <Button title="Admin: Force reveal" onPress={() => change(false)} />
      <Button title="Admin: Reset reveal" onPress={() => change(true)} />
    </View>
  );
}
