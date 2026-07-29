import { useState } from 'react';
import { View, TextInput, TouchableOpacity, Text, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { supabase } from '../src/lib/supabase';
import { useAuth } from '../src/contexts/AuthContext';

export default function JoinScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string }>();
  const [code, setCode] = useState(params.code ?? '');
  const [joining, setJoining] = useState(false);

  const handleJoin = async () => {
    if (!code.trim() || !user) return;
    setJoining(true);

    // Use SECURITY DEFINER function to join (bypasses RLS)
    const { data: result, error: joinErr } = await supabase.rpc('join_shared_list', {
      code: code.trim().toUpperCase(),
      uid: user.id,
    });

    if (joinErr) {
      Alert.alert('Error', joinErr.message);
    } else if (result === 'not_found') {
      Alert.alert('Not Found', 'No shared list found with that code.');
    } else if (result === 'full') {
      Alert.alert('List Full', 'This shared list has reached its maximum members.');
    } else {
      // result is the list ID
      Alert.alert('Joined!', 'You can now see and add items to this shared list.', [
        { text: 'View List', onPress: () => router.replace({ pathname: '/list/[id]', params: { id: result } }) },
      ]);
    }
    setJoining(false);
  };

  return (
    <View style={styles.container}>
      <Ionicons name="people-circle" size={64} color="#FF6B35" />
      <Text style={styles.title}>Join a Shared List</Text>
      <Text style={styles.subtitle}>Enter the 6-character code{'\n'}shared by the list owner</Text>

      <TextInput
        style={styles.codeInput}
        placeholder="ABC123"
        placeholderTextColor="#C7C7CC"
        value={code}
        onChangeText={(t) => setCode(t.toUpperCase())}
        maxLength={6}
        autoCapitalize="characters"
        autoCorrect={false}
      />

      <TouchableOpacity
        style={[styles.joinBtn, code.length !== 6 && styles.joinBtnDisabled]}
        onPress={handleJoin}
        disabled={code.length !== 6 || joining}
      >
        <Text style={styles.joinBtnText}>{joining ? 'Joining...' : 'Join List'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFF', padding: 32 },
  title: { fontSize: 22, fontWeight: '800', color: '#1A1A1A', marginTop: 16 },
  subtitle: { fontSize: 14, color: '#8E8E93', textAlign: 'center', marginTop: 8, marginBottom: 32, lineHeight: 20 },
  codeInput: {
    width: 200, textAlign: 'center',
    fontSize: 32, fontWeight: '800', letterSpacing: 8,
    color: '#FF6B35', backgroundColor: '#FFF4ED',
    borderRadius: 14, paddingVertical: 16,
    marginBottom: 24,
  },
  joinBtn: {
    backgroundColor: '#FF6B35', paddingHorizontal: 40, paddingVertical: 14, borderRadius: 12,
  },
  joinBtnDisabled: { opacity: 0.4 },
  joinBtnText: { color: '#FFF', fontWeight: '700', fontSize: 16 },
});
