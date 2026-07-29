import { useState, useEffect } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, Alert, Share } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/contexts/AuthContext';
import { exportListAsText } from '../../src/lib/export';
import { UserList, UserSave, ListMember } from '../../src/types';
import { ItemCard } from '../../src/components/ItemCard';

export default function ListDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const [list, setList] = useState<UserList | null>(null);
  const [saves, setSaves] = useState<UserSave[]>([]);
  const [members, setMembers] = useState<ListMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id || !user) return;
    supabase.rpc('get_shared_list', { lid: id }).then(({ data, error }) => {
      if (!error && data) {
        const d = data as any;
        setList(d.list as UserList);
        setSaves((d.saves || []) as UserSave[]);
        setMembers((d.members || []) as ListMember[]);
      }
      setLoading(false);
    });

    // Real-time for shared lists
    const channel = supabase
      .channel(`list-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_saves', filter: `list_id=eq.${id}` }, () => {
        supabase.rpc('get_shared_list', { lid: id }).then(({ data }) => {
          if (data) {
            const d = data as any;
            setSaves((d.saves || []) as UserSave[]);
            setMembers((d.members || []) as ListMember[]);
          }
        });
      })
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, [id, user]);

  const handleCopyCode = async () => {
    if (!list?.share_code) return;
    await Clipboard.setStringAsync(list.share_code);
    Alert.alert('Copied!', 'Share code copied. Send it to a friend.');
  };

  const handleShareAsText = async () => {
    if (!id) return;
    try {
      const text = await exportListAsText(id);
      await Share.share({ message: text, title: list?.name || 'My List' });
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not share list.');
    }
  };

  if (loading || !list) {
    return <View style={styles.centered}><Text style={{ color: '#8E8E93' }}>Loading...</Text></View>;
  }

  const isOwner = list.user_id === user?.id;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.listName}>{list.name}</Text>
        <View style={styles.memberRow}>
          {members.map((m) => (
            <View key={m.id} style={styles.avatar}>
              <Ionicons name="person" size={16} color="#FFF" />
            </View>
          ))}
          <Text style={styles.memberCount}>{members.length}/2 members</Text>
        </View>
      </View>

      {/* Share section (owner only) */}
      {isOwner && list.is_shared && (
        <View style={styles.shareSection}>
          <Text style={styles.shareCode}>{list.share_code}</Text>
          <TouchableOpacity style={styles.copyBtn} onPress={handleCopyCode}>
            <Ionicons name="copy" size={16} color="#FFF" />
            <Text style={styles.copyBtnText}>Copy Code</Text>
          </TouchableOpacity>
          <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF4ED', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, gap: 6, marginTop: 8 }} onPress={handleShareAsText}>
            <Ionicons name="share-outline" size={16} color="#FF6B35" />
            <Text style={{ color: '#FF6B35', fontWeight: '600', fontSize: 13 }}>Share as Text</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Share button for non-shared lists */}
      {isOwner && !list.is_shared && (
        <TouchableOpacity
          style={styles.shareBtn}
          onPress={async () => {
            // Generate share code and mark as shared
            const code = Math.random().toString(36).substring(2, 8).toUpperCase();
            await supabase.from('user_lists').update({ is_shared: true, share_code: code }).eq('id', id);
            // Re-fetch
            const { data } = await supabase.from('user_lists').select('*').eq('id', id).single();
            if (data) setList(data as UserList);
          }}
        >
          <Ionicons name="people" size={18} color="#FFF" />
          <Text style={styles.shareBtnText}>Share This List</Text>
        </TouchableOpacity>
      )}

      {/* Items */}
      <FlatList
        data={saves}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ItemCard save={item} onPress={() => router.push({ pathname: '/item/[id]', params: { id: item.saved_item_id } })} />
        )}
        contentContainerStyle={saves.length === 0 ? styles.emptyContainer : styles.listContent}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No spots in this list yet</Text>
            <Text style={styles.emptySub}>Start saving!</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9F9F9' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { padding: 20, backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  listName: { fontSize: 22, fontWeight: '800', color: '#1A1A1A' },
  memberRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: -8 },
  avatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#FF6B35', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#FFF' },
  memberCount: { fontSize: 13, color: '#8E8E93', marginLeft: 14 },
  shareSection: { flexDirection: 'row', alignItems: 'center', padding: 16, backgroundColor: '#FFF4ED', gap: 12 },
  shareCode: { flex: 1, fontSize: 18, fontWeight: '700', letterSpacing: 3, color: '#FF6B35' },
  copyBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FF6B35', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, gap: 6 },
  copyBtnText: { color: '#FFF', fontWeight: '600', fontSize: 13 },
  shareBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', margin: 16, padding: 14, backgroundColor: '#FF6B35', borderRadius: 12, gap: 8 },
  shareBtnText: { color: '#FFF', fontWeight: '700', fontSize: 15 },
  listContent: { paddingBottom: 100 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { alignItems: 'center' },
  emptyText: { fontSize: 16, fontWeight: '600', color: '#8E8E93' },
  emptySub: { fontSize: 13, color: '#C7C7CC', marginTop: 4 },
});
