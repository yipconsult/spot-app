// Handle deep links from iOS Share Extension
// Redirects to save page — save.tsx polls ShareIntentContext and auto-parses
import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';

export default function ShareRoute() {
  const router = useRouter();

  useEffect(() => {
    if (__DEV__) console.log('[ShareRoute] redirecting to save page');
    // Navigate to save — save.tsx will pick up the share intent via Path 2 polling
    const timer = setTimeout(() => router.replace('/save'), 300);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={styles.loading}>
      <ActivityIndicator size="large" color="#FF6B35" />
      <Text style={styles.text}>Reading shared content...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFF', gap: 16 },
  text: { fontSize: 14, color: '#8E8E93' },
});
