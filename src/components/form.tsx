import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type TextFieldProps = TextInputProps & { label: string };

export function TextField({ label, style, ...props }: TextFieldProps) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={theme.textSecondary}
        style={[
          styles.input,
          { color: theme.text, backgroundColor: theme.backgroundElement },
          style,
        ]}
        {...props}
      />
    </View>
  );
}

type ButtonProps = {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  variant?: 'primary' | 'secondary';
};

export function Button({ title, onPress, disabled, busy, variant = 'primary' }: ButtonProps) {
  const theme = useTheme();
  const isDisabled = disabled || busy;
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: primary ? theme.accent : theme.backgroundElement },
        isDisabled && styles.disabled,
        pressed && styles.pressed,
      ]}>
      {busy ? (
        <ActivityIndicator color={primary ? theme.background : theme.text} />
      ) : (
        <ThemedText type="smallBold" style={{ color: primary ? theme.background : theme.text }}>
          {title}
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  field: { gap: Spacing.one },
  input: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + Spacing.half,
    fontSize: 16,
  },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Spacing.two,
    minHeight: 44,
    paddingHorizontal: Spacing.four,
  },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.8 },
});
