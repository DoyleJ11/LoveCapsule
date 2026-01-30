export const Colors = {
  light: {
    primary: '#e07a5f',
    primaryLight: '#f2a890',
    secondary: '#3d405b',
    secondaryLight: '#6b6e8a',
    accent: '#81b29a',
    accentLight: '#a8d4be',
    background: '#f4f1de',
    surface: '#ffffff',
    surfaceSecondary: '#f8f6ed',
    text: '#2d2d2d',
    textSecondary: '#6b6b6b',
    textMuted: '#9b9b9b',
    border: '#e0dcc8',
    error: '#e74c3c',
    success: '#27ae60',
    warning: '#f39c12',
    partner1: '#e07a5f',
    partner2: '#81b29a',
  },
  dark: {
    primary: '#e07a5f',
    primaryLight: '#f2a890',
    secondary: '#c9c9e0',
    secondaryLight: '#9090b0',
    accent: '#81b29a',
    accentLight: '#5a8a72',
    background: '#1a1a2e',
    surface: '#25253e',
    surfaceSecondary: '#2e2e4a',
    text: '#f4f1de',
    textSecondary: '#b0b0b0',
    textMuted: '#707070',
    border: '#3a3a55',
    error: '#e74c3c',
    success: '#27ae60',
    warning: '#f39c12',
    partner1: '#e07a5f',
    partner2: '#81b29a',
  },
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const FontSize = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 22,
  xxl: 28,
  xxxl: 36,
};

export const BorderRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
};

export const Moods = [
  { key: 'happy', emoji: '😊', label: 'Happy' },
  { key: 'grateful', emoji: '🙏', label: 'Grateful' },
  { key: 'loving', emoji: '❤️', label: 'Loving' },
  { key: 'excited', emoji: '🎉', label: 'Excited' },
  { key: 'reflective', emoji: '🤔', label: 'Reflective' },
  { key: 'nostalgic', emoji: '🥹', label: 'Nostalgic' },
  { key: 'silly', emoji: '🤪', label: 'Silly' },
  { key: 'peaceful', emoji: '☺️', label: 'Peaceful' },
  { key: 'adventurous', emoji: '🌍', label: 'Adventurous' },
  { key: 'cozy', emoji: '🛋️', label: 'Cozy' },
] as const;

export type MoodKey = (typeof Moods)[number]['key'];
