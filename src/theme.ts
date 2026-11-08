import { useColorScheme } from 'react-native';
import { DARK, LIGHT, type Theme } from './palette';

export type { Theme };

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? DARK : LIGHT;
}
