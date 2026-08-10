// Handle deep links from iOS Share Extension
// The share extension opens spot:// which routes here.
// We MUST acknowledge receipt quickly so the extension doesn't hang Instagram.
import { useEffect, useRef } from 'react';
import { useRouter } from 'expo-router';
import { useShareIntentContext } from 'expo-share-intent';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';

export default function ShareRoute() {
  const router = useRouter();
  const { hasShareIntent, resetShareIntent, isReady } = useShareIntentContext();
  const redirectingRef = useRef(false);

  useEffect(() => {
    if (redirectingRef.current) return;

    // Immediately signal to the share extension that we received the data.
    // This prevents the extension from hanging — and Instagram along with it.
    if (isReady && hasShareIntent) {
      console.log('[ShareRoute] Share intent received, acknowledging');
      // Don't reset yet — HomeScreen needs the data. Just note receipt.
    } else {
      console.log('[ShareRoute] No share intent yet, will redirect to save');
    }

    if (__DEV__) console.log('[ShareRoute] redirecting to save page');
    redirectingRef.current = true;

    // Short delay lets ShareIntentProvider populate, then redirect
    const timer = setTimeout(() => {
      router.replace('/save');
    }, 100);
    return () => clearTimeout(timer);
  }, [isReady, hasShareIntent]);

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
