import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { AuthProvider, useAuth } from '../src/contexts/AuthContext';
import { PremiumProvider } from '../src/contexts/PremiumContext';
import { ThemeProvider, useTheme } from '../src/contexts/ThemeContext';
import { ShareIntentProvider } from 'expo-share-intent';
import { View, ActivityIndicator, StyleSheet } from 'react-native';

SplashScreen.preventAutoHideAsync().catch(() => {});

function RootNavigator() {
  const { user, loading } = useAuth();
  const t = useTheme();

  useEffect(() => {
    if (!loading) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [loading]);

  if (loading) {
    return (
      <View style={[styles.loading, { backgroundColor: t.bgSecondary }]}>
        <ActivityIndicator size="large" color={t.accent} />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="item/[id]" options={{ headerShown: true, title: 'Spot Details', headerBackTitle: 'Back' }} />
      <Stack.Screen name="save" options={{ headerShown: true, title: 'Save a Spot', presentation: 'modal' }} />
      <Stack.Screen name="share" options={{ headerShown: false }} />
      <Stack.Screen name="list/[id]" options={{ headerShown: true, title: 'List' }} />
      <Stack.Screen name="join" options={{ headerShown: true, title: 'Join List', presentation: 'modal' }} />
      <Stack.Screen name="auth" />
      <Stack.Screen name="onboarding" />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <PremiumProvider>
        <ThemeProvider>
          <ShareIntentProvider options={{ scheme: "spot", resetOnBackground: false, debug: __DEV__ }}>
            <StatusBar style="auto" />
            <RootNavigator />
          </ShareIntentProvider>
        </ThemeProvider>
      </PremiumProvider>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
