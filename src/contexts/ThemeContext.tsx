import React, { createContext, useContext } from 'react';
import { useColorScheme } from 'react-native';

export interface ThemeColors {
  bg: string;
  bgSecondary: string;
  surface: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  border: string;
  accent: string;
  accentBg: string;
  danger: string;
  tabBar: string;
}

const light: ThemeColors = {
  bg: '#F9F9F9',
  bgSecondary: '#FFF',
  surface: '#FFF',
  text: '#1A1A1A',
  textSecondary: '#8E8E93',
  textTertiary: '#A1A1A6',
  border: '#F0F0F0',
  accent: '#FF6B35',
  accentBg: '#FFF4ED',
  danger: '#FF3B30',
  tabBar: '#FFF',
};

const dark: ThemeColors = {
  bg: '#0F0F0F',
  bgSecondary: '#1A1A1A',
  surface: '#1C1C1E',
  text: '#F5F5F5',
  textSecondary: '#8E8E93',
  textTertiary: '#636366',
  border: '#2C2C2E',
  accent: '#FF6B35',
  accentBg: '#2C1A10',
  danger: '#FF453A',
  tabBar: '#1A1A1A',
};

const ThemeContext = createContext<ThemeColors>(light);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const scheme = useColorScheme();
  const theme = scheme === 'dark' ? dark : light;
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
