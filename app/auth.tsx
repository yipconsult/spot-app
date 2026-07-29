import { useState } from 'react';
import { View, TextInput, TouchableOpacity, Text, StyleSheet, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../src/contexts/AuthContext';

export default function AuthScreen() {
  const { signUp, signIn, signInWithApple } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!email.trim() || password.length < 6) {
      Alert.alert('Check your input', 'Enter a valid email and password (6+ characters).');
      return;
    }
    setLoading(true);
    const res = mode === 'signup' ? await signUp(email, password) : await signIn(email, password);
    setLoading(false);
    if (res.error) {
      Alert.alert('Error', res.error);
    } else if (mode === 'signup') {
      Alert.alert('Account created!', 'Switch to Sign In to log in.', [
        { text: 'Sign In', onPress: () => setMode('signin') },
      ]);
    } else {
      // Sign-in succeeded — navigate to main app
      router.replace('/(tabs)');
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.inner}>
        {/* Logo */}
        <View style={styles.logo}>
          <Ionicons name="bookmark" size={48} color="#FF6B35" />
        </View>
        <Text style={styles.title}>Spot</Text>
        <Text style={styles.subtitle}>Save what you discover. Go where you saved.</Text>

        {/* Inputs */}
        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="#8E8E93"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoCorrect={false}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor="#8E8E93"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        {/* Submit */}
        <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit} disabled={loading}>
          <Text style={styles.submitText}>
            {loading ? 'Please wait...' : mode === 'signup' ? 'Create Account' : 'Sign In'}
          </Text>
        </TouchableOpacity>

        {/* Toggle mode */}
        <TouchableOpacity onPress={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
          <Text style={styles.toggle}>
            {mode === 'signin' ? "Don't have an account? Sign Up" : 'Already have an account? Sign In'}
          </Text>
        </TouchableOpacity>

        {/* Divider */}
        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* Apple Sign In */}
        <TouchableOpacity style={styles.appleBtn} onPress={signInWithApple}>
          <Ionicons name="logo-apple" size={22} color="#FFF" />
          <Text style={styles.appleText}>Continue with Apple</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF' },
  inner: { flex: 1, justifyContent: 'center', paddingHorizontal: 32 },
  logo: { alignSelf: 'center', marginBottom: 8,
    width: 80, height: 80, borderRadius: 20, backgroundColor: '#FFF4ED',
    justifyContent: 'center', alignItems: 'center',
  },
  title: { fontSize: 32, fontWeight: '800', color: '#1A1A1A', textAlign: 'center' },
  subtitle: { fontSize: 14, color: '#8E8E93', textAlign: 'center', marginTop: 8, marginBottom: 40 },
  input: {
    backgroundColor: '#F4F4F5', borderRadius: 12, padding: 16, fontSize: 16,
    color: '#1A1A1A', marginBottom: 12,
  },
  submitBtn: {
    backgroundColor: '#FF6B35', borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 8,
  },
  submitText: { color: '#FFF', fontWeight: '700', fontSize: 16 },
  toggle: { textAlign: 'center', color: '#FF6B35', fontSize: 14, marginTop: 16 },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 24, gap: 12 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#E5E5EA' },
  dividerText: { color: '#8E8E93', fontSize: 13 },
  appleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#1A1A1A', borderRadius: 12, paddingVertical: 14, gap: 8,
  },
  appleText: { color: '#FFF', fontWeight: '600', fontSize: 16 },
});
