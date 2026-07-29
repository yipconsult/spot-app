import { useRouter } from 'expo-router';
import { useAuth } from '../src/contexts/AuthContext';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useEffect } from 'react';

export default function Index() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (user) {
      router.replace('/(tabs)');
    } else {
      router.replace('/onboarding');
    }
  }, [user, loading]);

  return (
    <View style={styles.loading}>
      <ActivityIndicator size="large" color="#FF6B35" />
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFF' },
});
