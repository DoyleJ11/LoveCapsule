import type { ComponentProps } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  StyleSheet,
  useColorScheme,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { BorderRadius, Colors, FontSize, Spacing } from '../constants/theme';

type Props = Omit<PressableProps, 'children' | 'style'> & {
  title: string;
  variant?: 'primary' | 'secondary' | 'destructive';
  loading?: boolean;
  icon?: ComponentProps<typeof FontAwesome>['name'];
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Button({
  title,
  variant = 'secondary',
  loading = false,
  disabled = false,
  icon,
  compact = false,
  style,
  accessibilityLabel,
  accessibilityState,
  ...props
}: Props) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const filled = variant !== 'secondary';
  const foreground = filled ? colors.onAction : colors.text;
  const backgroundColor =
    variant === 'primary'
      ? colors.primaryAction
      : variant === 'destructive'
        ? colors.destructiveAction
        : colors.surfaceSecondary;
  return (
    <Pressable
      {...props}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ ...accessibilityState, disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        compact && styles.compact,
        { backgroundColor, borderColor: filled ? backgroundColor : colors.border },
        (disabled || loading) && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={foreground} />
      ) : icon ? (
        <FontAwesome name={icon} size={16} color={foreground} />
      ) : null}
      <Text
        maxFontSizeMultiplier={compact ? 1.4 : undefined}
        style={[styles.label, { color: foreground }]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

export function IconButton({
  label,
  icon,
  onPress,
  disabled,
  destructive = false,
  style,
}: {
  label: string;
  icon: ComponentProps<typeof FontAwesome>['name'];
  onPress: PressableProps['onPress'];
  disabled?: boolean;
  destructive?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
        disabled && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}
    >
      <FontAwesome
        name={icon}
        size={18}
        color={destructive ? colors.error : colors.textSecondary}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  compact: { paddingHorizontal: 12, paddingVertical: Spacing.sm },
  label: { fontSize: FontSize.sm, fontWeight: '600', textAlign: 'center', flexShrink: 1 },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.75 },
  iconButton: {
    minWidth: 44,
    minHeight: 44,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
