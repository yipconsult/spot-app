import { View, StyleSheet, Text, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/contexts/AuthContext';
import { usePremium } from '../../src/contexts/PremiumContext';
import { useTheme } from '../../src/contexts/ThemeContext';
import { useEffect, useState } from 'react';
import { supabase } from '../../src/lib/supabase';
import { exportSpotsAsCSV } from '../../src/lib/export';
import { UserTaste, TasteType, UserList } from '../../src/types';

const TASTE_LABELS: Record<TasteType, string> = {
  smart_shuffle: 'Smart Shuffle',
  auto_categories: 'Auto-Category Tags',
  auto_calendar: 'Auto-Calendar Block',
  shared_list: 'Shared List',
  weather_filter: 'Weather-Aware Filter',
  group_vote: 'Group Vote',
  duplicate_detect: 'Duplicate Detection',
  premium_pass_24h: 'Premium Pass (24h)',
  photo_attach: 'Photo Attach',
};

export default function ProfileScreen() {
  const { user, signOut } = useAuth();
  const { isPremium: premium, showPaywall } = usePremium();
  const t = useTheme();
  const router = useRouter();
  const [tastes, setTastes] = useState<UserTaste[]>([]);
  const [saveCount, setSaveCount] = useState(0);
  const [lists, setLists] = useState<UserList[]>([]);

  useEffect(() => {
    if (!user) return;
    supabase.rpc('count_user_saves', { uid: user.id }).then(({ data }) => setSaveCount(data ?? 0));
    supabase.from('user_tastes').select('*').eq('user_id', user.id).gte('expires_at', new Date().toISOString())
      .then(({ data }) => setTastes((data as UserTaste[]) ?? []));
    supabase.from('user_lists').select('*').eq('user_id', user.id).order('created_at', { ascending: false })
      .then(({ data }) => setLists((data as UserList[]) ?? []));
  }, [user]);

  const handleCreateSharedList = async () => {
    if (!user) return;
    // Check 1+1 limit: free users get 1 shared list
    const sharedLists = lists.filter(l => l.is_shared);
    if (sharedLists.length >= 1 && !premium) {
      showPaywall('Create unlimited shared lists and share with more friends.');
      return;
    }
    const { data, error } = await supabase.from('user_lists').insert({
      user_id: user.id, name: 'Shared List', is_shared: true, share_code: Math.random().toString(36).substring(2, 8).toUpperCase(), max_members: 1,
    }).select('*').single();
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      // Also add owner as member
      await supabase.from('list_members').insert({ list_id: data.id, user_id: user.id, role: 'owner' });
      setLists([data as UserList, ...lists]);
      router.push({ pathname: '/list/[id]', params: { id: data.id } });
    }
  };

  const handleExport = async () => {
    if (!user) return;
    try {
      await exportSpotsAsCSV(user.id);
    } catch (err: any) {
      Alert.alert('Export failed', err.message || 'Could not export spots.');
    }
  };

  const handleSignOut = async () => {
    await signOut();
    router.replace('/auth');
  };

  return (
    <View style={[styles.container, { backgroundColor: t.bg }]}>
      <View style={[styles.header, { backgroundColor: t.surface, borderBottomColor: t.border }]}>
        <View style={styles.avatar}><Ionicons name="person" size={32} color="#FFF" /></View>
        <Text style={[styles.email, { color: t.text }]}>{user?.email}</Text>
        <Text style={[styles.stats, { color: t.textSecondary }]}>{saveCount} spots saved</Text>
      </View>

      {tastes.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: t.textSecondary }]}>Active Tastes</Text>
          {tastes.map((taste) => (
            <View key={taste.id} style={[styles.tasteCard, { backgroundColor: t.surface }]}>
              <Ionicons name="sparkles" size={18} color={t.accent} />
              <View style={styles.tasteInfo}>
                <Text style={[styles.tasteName, { color: t.text }]}>{TASTE_LABELS[taste.taste_type]}</Text>
                <Text style={[styles.tasteExpiry, { color: t.textSecondary }]}>Expires {new Date(taste.expires_at).toLocaleDateString()}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: t.textSecondary }]}>My Lists</Text>
        {lists.map((list) => (
          <TouchableOpacity key={list.id} style={[styles.menuItem, { backgroundColor: t.surface }]} onPress={() => router.push({ pathname: '/list/[id]', params: { id: list.id } })}>
            <Ionicons name={list.is_shared ? 'people' : 'bookmark'} size={22} color={t.text} />
            <Text style={[styles.menuText, { color: t.text }]}>{list.name}{list.is_shared ? ' 🔗' : ''}</Text>
            <Ionicons name="chevron-forward" size={18} color={t.textTertiary} />
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={[styles.menuItem, { backgroundColor: t.surface }]} onPress={handleCreateSharedList}>
          <Ionicons name="add-circle" size={22} color={t.accent} />
          <Text style={[styles.menuText, { color: t.accent }]}>Create Shared List</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: t.textSecondary }]}>Settings</Text>
        <TouchableOpacity style={[styles.menuItem, { backgroundColor: t.surface }]} onPress={handleExport}>
          <Ionicons name="download-outline" size={22} color={t.text} />
          <Text style={[styles.menuText, { color: t.text }]}>Export Spots as CSV</Text>
          <Ionicons name="chevron-forward" size={18} color={t.textTertiary} />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.menuItem, { backgroundColor: t.surface }]} onPress={() => router.push('/join')}>
          <Ionicons name="enter" size={22} color={t.text} />
          <Text style={[styles.menuText, { color: t.text }]}>Join a Shared List</Text>
          <Ionicons name="chevron-forward" size={18} color={t.textTertiary} />
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={[styles.signOutBtn, { borderColor: t.danger }]} onPress={handleSignOut}>
        <Text style={[styles.signOutText, { color: t.danger }]}>Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { alignItems: 'center', paddingVertical: 32, borderBottomWidth: 1 },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#FF6B35', justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  email: { fontSize: 16, fontWeight: '600' },
  stats: { fontSize: 13, marginTop: 4 },
  section: { marginTop: 24, paddingHorizontal: 16 },
  sectionTitle: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', marginBottom: 12, letterSpacing: 0.5 },
  tasteCard: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 12, marginBottom: 8, gap: 12 },
  tasteInfo: { flex: 1 },
  tasteName: { fontSize: 15, fontWeight: '600' },
  tasteExpiry: { fontSize: 12, marginTop: 2 },
  menuItem: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 12, marginBottom: 1, gap: 12 },
  menuText: { flex: 1, fontSize: 15 },
  signOutBtn: { marginTop: 32, marginHorizontal: 16, paddingVertical: 14, borderRadius: 12, borderWidth: 1, alignItems: 'center' },
  signOutText: { fontSize: 15, fontWeight: '600' },
});
