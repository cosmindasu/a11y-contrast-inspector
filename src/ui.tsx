import React from 'react';
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { type Theme } from './theme';

/** Minimum touch target 48 dp (above WCAG 2.5.8's 24 px, matches Material). */
export function Button({
  label,
  onPress,
  theme,
  kind = 'secondary',
  selected,
  disabled,
  a11yLabel,
  style,
}: {
  label: string;
  onPress: () => void;
  theme: Theme;
  kind?: 'primary' | 'secondary';
  selected?: boolean;
  disabled?: boolean;
  a11yLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const primary = kind === 'primary' || selected;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11yLabel ?? label}
      accessibilityState={{ disabled: !!disabled, selected: selected ?? undefined }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: primary ? theme.primary : theme.surface,
          borderColor: primary ? theme.primary : theme.border,
          opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
        },
        style,
      ]}
    >
      <Text style={[styles.buttonText, { color: primary ? theme.onPrimary : theme.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    minWidth: 48,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
});
