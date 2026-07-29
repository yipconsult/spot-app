import { useState, useEffect, useCallback, useRef } from 'react';
import { View, FlatList, StyleSheet, RefreshControl, TextInput, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useShareIntentContext } from 'expo-share-intent';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/contexts/AuthContext';
import { useTheme } from '../../src/contexts/ThemeContext';
import { UserSave } from '../../src/types';
import { ItemCard } from '../../src/components/ItemCard';
import { checkClipboard } from '../../src/lib/clipboard';

export default function HomeScreen() {
  const { user } = useAuth();
  const t = useTheme();
  const router = useRouter();
  const [saves, setSaves] = useState<UserSave[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [clipUrl, setClipUrl] = useState<string | null>(null);

  // Handle shared content from iOS Share Extension
  const { hasShareIntent, shareIntent, isReady } = useShareIntentContext();
  const shareProcessed = useRef(false);

  // Always log state so we can trace what's happening
  useEffect(() => {
    console.log('[HomeScreen] share intent state:', {
      hasShareIntent,
      isReady,
      processed: shareProcessed.current,
      webUrl: shareIntent.webUrl || '',
      hasText: !!(shareIntent.text),
    });
  }, [hasShareIntent, shareIntent, isReady]);

  useEffect(() => {
    if (hasShareIntent && isReady && !shareProcessed.current) {
      const sharedText = shareIntent.text || '';
      const sharedWebUrl = shareIntent.webUrl || '';
      const metaTitle = shareIntent.meta?.title || '';

      const textContent = [sharedText, metaTitle].filter(Boolean).join('\n');
      const urlFromText = textContent.match(/https?:\/\/[^\s]+/)?.[0] || '';
      const finalUrl = sharedWebUrl || urlFromText;

      console.log('[HomeScreen] share intent data:', { finalUrl, sharedText: sharedText.slice(0, 100), sharedWebUrl });

      if (!finalUrl && !sharedText) {
        console.log('[HomeScreen] empty intent, waiting...');
        return;
      }

      shareProcessed.current = true;
      console.log('[HomeScreen] navigating to save with:', { finalUrl, textLen: textContent.length });

      router.push({
        pathname: '/save',
        params: { prefillUrl: finalUrl, sharedText: textContent.slice(0, 5000) },
      });
    }
  }, [hasShareIntent, shareIntent, isReady]);

  const fetchSaves = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('user_saves')
      .select('*, saved_item:saved_items(*)')
      .order('saved_at', { ascending: false });

    if (!error && data) setSaves(data as unknown as UserSave[]);
    setLoading(false);
  }, [user]);

  // Auto-refresh when tab is focused (after saving, etc.)
  useFocusEffect(useCallback(() => { fetchSaves(); }, [fetchSaves]));

  useEffect(() => {
    checkClipboard().then(setClipUrl);
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchSaves();
    setRefreshing(false);
  };

  const filtered = search.trim()
    ? saves.filter((s) => {
        const item = s.saved_item;
        const q = search.toLowerCase();
        return (
          item?.name_original?.toLowerCase().includes(q) ||
          item?.name_en?.toLowerCase().includes(q) ||
          item?.tags?.some((t) => t.toLowerCase().includes(q)) ||
          item?.district?.toLowerCase().includes(q)
        );
      })
    : saves;

  return (
    <View style={[styles.container, { backgroundColor: t.bg }]}>
      {/* Clipboard banner */}
      {clipUrl && (
        <TouchableOpacity style={styles.clipBanner} onPress={() => router.push({ pathname: '/save', params: { prefillUrl: clipUrl } })}>
          <Ionicons name="link" size={18} color="#FFF" />
          <Text style={styles.clipText}>Save this link to Spot</Text>
        </TouchableOpacity>
      )}

      {/* Search bar */}
      <View style={[styles.searchBar, { backgroundColor: t.surface, borderColor: t.border }]}>
        <Ionicons name="search" size={18} color={t.textSecondary} />
        <TextInput
          style={[styles.searchInput, { color: t.text }]}
          placeholder="Search your spots..."
          placeholderTextColor={t.textSecondary}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {/* List */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ItemCard
            save={item}
            onPress={() => router.push({ pathname: '/item/[id]', params: { id: item.saved_item_id } })}
          />
        )}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF6B35" />}
        contentContainerStyle={filtered.length === 0 ? styles.emptyContainer : styles.listContent}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="bookmark-outline" size={64} color={t.textTertiary} />
            <Text style={[styles.emptyTitle, { color: t.text }]}>No spots saved yet</Text>
            <Text style={[styles.emptySubtitle, { color: t.textSecondary }]}>Share a post from Instagram or RED{'\n'}to start building your list</Text>
          </View>
        }
      />

      {/* Share intent status — debug removed for production */}

      {/* FAB: Add */}
      <TouchableOpacity style={styles.fab} onPress={() => router.push('/save')} activeOpacity={0.8}>
        <Ionicons name="add" size={28} color="#FFF" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  clipBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FF6B35', paddingVertical: 10, gap: 8,
  },
  clipText: { color: '#FFF', fontWeight: '600', fontSize: 14 },
  searchBar: {
    flexDirection: 'row', alignItems: 'center',
    margin: 16, paddingHorizontal: 12,
    borderRadius: 12, borderWidth: 1,
    height: 44,
  },
  searchInput: { flex: 1, marginLeft: 8, fontSize: 16 },
  listContent: { paddingBottom: 100 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { alignItems: 'center', paddingHorizontal: 40 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#1A1A1A', marginTop: 16 },
  emptySubtitle: { fontSize: 14, color: '#8E8E93', textAlign: 'center', marginTop: 8, lineHeight: 20 },
  debugBanner: { backgroundColor: '#FFF3CD', padding: 8, marginHorizontal: 16, marginTop: 4, borderRadius: 6 },
  debugText: { fontSize: 10, color: '#856404', fontFamily: 'monospace' },
  fab: {
    position: 'absolute', bottom: 24, right: 24,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#FF6B35',
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#FF6B35', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
  },
});
