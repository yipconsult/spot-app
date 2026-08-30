import { useState, useEffect, useCallback, useRef } from 'react';
import { View, FlatList, StyleSheet, RefreshControl, TextInput, Text, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useShareIntentContext } from 'expo-share-intent';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/contexts/AuthContext';
import { useTheme } from '../../src/contexts/ThemeContext';
import { UserSave } from '../../src/types';
import { ItemCard } from '../../src/components/ItemCard';
import { checkClipboard, extractUrl } from '../../src/lib/clipboard';
import { normalizeUrl } from '../../src/lib/url';
import { navState } from '../../src/lib/navState';

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
  const { hasShareIntent, shareIntent, resetShareIntent, isReady } = useShareIntentContext();
  // Share intent ONLY: 1.5s throttle (blocks native re-delivery, not user actions)
  const lastSharePushAt = useRef(0);
  const lastProcessedKey = useRef<string | null>(null);

  useEffect(() => {
    console.log('[HomeScreen] share intent state:', {
      hasShareIntent,
      isReady,
      lastPush: lastSharePushAt.current,
      lastKey: lastProcessedKey.current,
    });
  }, [hasShareIntent, isReady]); // shareIntent intentionally excluded — object ref changes every render

  useEffect(() => {
    if (!hasShareIntent || !isReady) return;

    const now = Date.now();

    // 1.5s throttle: blocks rapid native re-delivery only
    if (now - lastSharePushAt.current < 1500) {
      console.log('[HomeScreen] share intent throttled (native re-delivery)');
      resetShareIntent();
      return;
    }

    const sharedText = shareIntent.text || '';
    const sharedWebUrl = shareIntent.webUrl || '';
    const metaTitle = shareIntent.meta?.title || '';

    const textContent = [sharedText, metaTitle].filter(Boolean).join('\n');
    const urlFromText = extractUrl(textContent) || textContent.match(/https?:\/\/[^\s]+/)?.[0] || '';
    const rawUrl = sharedWebUrl || urlFromText;
    const finalUrl = rawUrl ? normalizeUrl(rawUrl) : '';
    // Dedup key: URL if present, otherwise first 200 chars of text
    const dedupKey = finalUrl || textContent.slice(0, 200);

    console.log('[HomeScreen] share intent data:', {
      finalUrl,
      rawUrl,
      sharedText: sharedText.slice(0, 100),
      sharedWebUrl,
      metaTitle,
      type: shareIntent.type,
    });

    // ── Dedup: identical share within the same session → skip ─
    if (dedupKey && dedupKey === lastProcessedKey.current) {
      console.log('[HomeScreen] dedup blocked:', dedupKey.slice(0, 80));
      resetShareIntent();
      return;
    }

    // ── Completely empty intent → clear native state and bail ─
    if (!finalUrl && !sharedText) {
      console.log('[HomeScreen] empty intent, clearing');
      resetShareIntent();
      return;
    }

    // ── P2-A: Facebook/Threads share with no URL ─────────────────
    const lowerText = textContent.toLowerCase();
    const isFacebookShare = lowerText.includes('facebook') || sharedWebUrl?.includes('facebook.com');
    const isThreadsShare = lowerText.includes('threads') || sharedWebUrl?.includes('threads.net');

    if (!finalUrl && (isFacebookShare || isThreadsShare)) {
      lastSharePushAt.current = now;
      lastProcessedKey.current = dedupKey;
      resetShareIntent();
      Alert.alert(
        "Can't read this link directly",
        "Facebook and Threads don't include the post link when sharing from the app.\n\nCopy the link from the post menu, then return to Spot and paste it.",
        [{ text: 'OK' }]
      );
      return;
    }

    lastSharePushAt.current = now;
    lastProcessedKey.current = dedupKey;
    resetShareIntent();

    // Don't stack a second save modal on top of an open one
    if (navState.saveOpen) {
      console.log('[HomeScreen] save modal already open — skipping push');
      return;
    }

    console.log('[HomeScreen] navigating to save:', { finalUrl: finalUrl.slice(0, 80), textLen: textContent.length });

    router.push({
      pathname: '/save',
      params: { prefillUrl: finalUrl, sharedText: textContent.slice(0, 5000) },
    });
  }, [hasShareIntent, isReady, router]); // shareIntent intentionally excluded — prevents re-run loop

  const fetchSaves = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('user_saves')
      .select('*, saved_item:saved_items(*)')
      .order('saved_at', { ascending: false });

    if (!error && data) setSaves(data as unknown as UserSave[]);
    setLoading(false);
  }, [user]);

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
          item?.tags?.some((tag: string) => tag.toLowerCase().includes(q)) ||
          item?.district?.toLowerCase().includes(q)
        );
      })
    : saves;

  return (
    <View style={[styles.container, { backgroundColor: t.bg }]}>
      {/* Clipboard banner */}
      {clipUrl && (
        <TouchableOpacity
          style={styles.clipBanner}
          onPress={() => { if (!navState.saveOpen) router.push({ pathname: '/save', params: { prefillUrl: clipUrl } }); }}
        >
          <Ionicons name="link" size={16} color="#FFF" />
          <Text style={styles.clipText}>Save this link to Spot</Text>
          <Ionicons name="chevron-forward" size={16} color="#FFF" />
        </TouchableOpacity>
      )}

      {/* Search bar */}
      <View style={[styles.searchBar, { backgroundColor: t.surface, borderColor: t.border }]}>
        <Ionicons name="search" size={18} color={t.textTertiary} />
        <TextInput
          style={[styles.searchInput, { color: t.text }]}
          placeholder="Search your spots..."
          placeholderTextColor={t.textTertiary}
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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={filtered.length === 0 ? styles.emptyContainer : styles.listContent}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="bookmark-outline" size={48} color={t.textTertiary} />
            <Text style={[styles.emptyTitle, { color: t.text }]}>No spots saved yet</Text>
            <Text style={[styles.emptySubtitle, { color: t.textTertiary }]}>
              Share a post from Instagram or RED{'\n'}to start building your list
            </Text>
          </View>
        }
      />

      {/* FAB: Add */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => { if (!navState.saveOpen) router.push('/save'); }}
        activeOpacity={0.8}
      >
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
  emptyTitle: { fontSize: 20, fontWeight: '700', marginTop: 16 },
  emptySubtitle: { fontSize: 14, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  fab: {
    position: 'absolute', bottom: 24, right: 24,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#FF6B35',
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#FF6B35', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
  },
});
