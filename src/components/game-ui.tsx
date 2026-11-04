import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** A god's sigil in a circle of their color. */
export function GodBadge({
  color,
  sigil,
  size = 40,
  label,
}: {
  color: string | null;
  sigil: string | null;
  size?: number;
  label?: string;
}) {
  const theme = useTheme();
  return (
    <View
      accessibilityLabel={label}
      style={[
        styles.badge,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color ?? theme.backgroundSelected,
        },
      ]}>
      <Text style={{ fontSize: size * 0.5, color: '#FFFFFF' }}>{sigil ?? '?'}</Text>
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return (
    <ThemedView type="backgroundElement" style={[styles.card, style]}>
      {children}
    </ThemedView>
  );
}

/** A selectable pill, e.g. a sphere of influence. */
export function Chip({
  label,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? theme.accent : theme.backgroundElement,
          borderColor: selected ? theme.accent : theme.backgroundSelected,
        },
        disabled && !selected && styles.dim,
      ]}>
      <ThemedText type="small" style={{ color: selected ? theme.background : theme.text }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

/** A round, tappable choice: a color swatch or a sigil. */
export function ChoiceCircle({
  label,
  selected,
  disabled,
  onPress,
  color,
  children,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
  color?: string;
  children?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.choice,
        {
          backgroundColor: color ?? theme.backgroundElement,
          borderColor: selected ? theme.text : 'transparent',
        },
        disabled && styles.dim,
      ]}>
      {children}
    </Pressable>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <ThemedText type="smallBold">{children}</ThemedText>;
}

export function ErrorMessage({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <ThemedText accessibilityRole="alert" type="small" style={styles.error}>
      {message}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  badge: { alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  chip: {
    borderRadius: Spacing.four,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + Spacing.half,
  },
  choice: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dim: { opacity: 0.35 },
  error: { color: '#C2410C' },
});
