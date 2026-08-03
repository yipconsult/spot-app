import { useState, useEffect, useRef, useCallback } from 'react';
import { View, TextInput, TouchableOpacity, Text, StyleSheet, Alert, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { supabase } from '../src/lib/supabase';
import { useAuth } from '../src/contexts/AuthContext';
import { useTheme } from '../src/contexts/ThemeContext';
import { ParseResult, Category, CATEGORY_LABELS } from '../src/types';
import { normalizeUrl } from '../src/lib/url';

function detectPlatformFromUrl(url: string): string {
  const u = url.toLowerCase();
  if (u.includes('instagram.com')) return 'instagram';
  if (u.includes('threads.net')) return 'threads';
  if (u.includes('facebook.com') || u.includes('fb.com')) return 'facebook';
  if (u.includes('xhslink.com') || u.includes('xiaohongshu.com')) return 'red';
  if (u.includes('pin.it') || u.includes('pinterest.com')) return 'pinterest';
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube_reels';
  if (u.includes('openrice.com')) return 'manual';
  if (u.includes('google.com/maps') || u.includes('goo.gl/maps')) return 'manual';
  return 'manual';
}

export default function SaveScreen() {
  const { user } = useAuth();
  const t = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ prefillUrl?: string; sharedText?: string; url?: string; text?: string }>();

  const [url, setUrl] = useState('');
  const [parsing, setParsing] = useState(false);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [parseHint, setParseHint] = useState<string | null>(null);

  const lastFilledUrl = useRef<string | null>(null);
  const isSavingRef = useRef(false);

  // Auto-parse when navigated here with a prefill URL (from HomeScreen share handling)
  const handleParseWithText = useCallback(async (parseUrl: string, sharedText?: string) => {
    setParsing(true);
    const cleanUrl = normalizeUrl(parseUrl);
    try {
      const { data: fnData, error: fnError } = await supabase.functions.invoke('parse-item', {
        body: { url: cleanUrl, text: sharedText || undefined },
      });
      if (fnError) throw fnError;
      const data = fnData as Record<string, unknown>;
      setResult(data as unknown as ParseResult);
      setParseHint((data.parse_hint as string) || null);
    } catch (err: any) {
      setParseHint('Something went wrong. Check your connection and try again, or fill in details manually.');
      setResult({
        name_original: null, name_en: null,
        address_original: null, address_en: null,
        category: 'other', district: null, price_hint: null,
        tags: [], raw_text: parseUrl.trim(),
      });
    } finally {
      setParsing(false);
    }
  }, []);

  useEffect(() => {
    const rawPrefill = params.prefillUrl || params.url || '';
    const prefill = rawPrefill ? decodeURIComponent(rawPrefill) : '';
    const sharedText = params.sharedText || '';

    if (prefill && prefill !== lastFilledUrl.current) {
      lastFilledUrl.current = prefill;
      setResult(null);
      setParseHint(null);
      setUrl(prefill);
      handleParseWithText(prefill, sharedText || undefined);
    }
  }, [params.prefillUrl, params.url, params.sharedText, handleParseWithText]);

  const handleParse = () => handleParseWithText(url);

  const handleLookup = async () => {
    const searchName = result?.name_en || result?.name_original;
    if (!searchName) { Alert.alert('Type a name first', 'Enter the restaurant or place name, then tap Look Up.'); return; }
    setParsing(true);
    try {
      const { data: fnData, error: fnError } = await supabase.functions.invoke('parse-item', {
        body: { url: `https://spot.app/manual/${Date.now()}`, text: `${searchName} Hong Kong` },
      });
      if (!fnError && fnData) {
        const enriched = fnData as ParseResult;
        setResult({
          ...result!,
          address_original: enriched.address_original || result!.address_original,
          address_en: enriched.address_en || result!.address_en,
          category: enriched.category !== 'other' ? enriched.category : result!.category,
          district: enriched.district || result!.district,
          price_hint: enriched.price_hint || result!.price_hint,
          tags: [...new Set([...(result!.tags || []), ...(enriched.tags || [])])],
        });
        Alert.alert('Done', 'Details auto-filled from web search.');
      }
    } catch { Alert.alert('Lookup failed', 'Fill in details manually.'); }
    setParsing(false);
  };

  const handleSave = async () => {
    if (!user || !result) return;

    // Lock: prevent double-tap / race-condition duplicates
    if (isSavingRef.current) return;
    isSavingRef.current = true;

    try {
      const cleanUrl = normalizeUrl(url.trim());

      const { data: existing } = await supabase
        .from('saved_items').select('id').eq('source_url', cleanUrl).single();
      let itemId = existing?.id;

      if (!itemId) {
        const platform = detectPlatformFromUrl(cleanUrl);
        const thumbnailUrl = (result as any).thumbnail_url || null;

        const { data: inserted, error: itemErr } = await supabase
          .from('saved_items').insert({
            source_url: cleanUrl,
            source_platform: platform as any,
            name_original: result.name_original,
            name_en: result.name_en,
            address_original: result.address_original,
            address_en: result.address_en,
            category: result.category,
            district: result.district,
            price_hint: result.price_hint,
            tags: result.tags,
            raw_text: result.raw_text,
            parsed_json: thumbnailUrl ? { thumbnail_url: thumbnailUrl } : null,
          }).select('id').single();
        if (itemErr) { Alert.alert('Error', itemErr.message); return; }
        itemId = inserted!.id;
      }

      const { data: defaultList } = await supabase
        .from('user_lists').select('id').eq('user_id', user.id).eq('is_shared', false).limit(1).single();

      // Upsert prevents duplicate user_saves for the same item
      // Requires UNIQUE(user_id, saved_item_id) constraint in Supabase
      const { error: saveErr } = await supabase.from('user_saves').upsert({
        user_id: user.id,
        saved_item_id: itemId,
        list_id: defaultList?.id ?? null,
      }, { onConflict: 'user_id,saved_item_id' });

      if (saveErr) { Alert.alert('Error', saveErr.message); return; }
      router.back();
    } finally {
      isSavingRef.current = false;
    }
  };

  if (parsing) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: t.bgSecondary }]}>
        <Ionicons name="sparkles" size={32} color="#FF6B35" />
        <Text style={[styles.loadingText, { color: t.textSecondary }]}>Reading post...</Text>
      </View>
    );
  }

  const hasUsefulData = result && (result.name_en || result.name_original || result.address_en || result.address_original);

  if (result && hasUsefulData) {
    return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.container, { backgroundColor: t.bgSecondary }]}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={[styles.label, { color: t.text }]}>Edit before saving</Text>
          <Text style={[styles.sublabel, { color: t.textSecondary }]}>AI filled what it could. Fix anything that's wrong.</Text>

          {parseHint && (
            <View style={styles.hintBanner}>
              <Ionicons name="information-circle" size={18} color="#007AFF" />
              <Text style={styles.hintText}>{parseHint}</Text>
            </View>
          )}

          {/* Name (English) + Look Up button in a row */}
          <Text style={[styles.editLabel, { color: t.textSecondary }]}>Name (English)</Text>
          <View style={styles.nameRow}>
            <TextInput
              style={[styles.editInput, styles.nameInput, { backgroundColor: t.bg, color: t.text }]}
              value={result.name_en ?? ''}
              onChangeText={(v) => setResult({ ...result, name_en: v })}
              placeholder="Restaurant name"
              placeholderTextColor={t.textTertiary}
            />
            <TouchableOpacity style={styles.lookupBtn} onPress={handleLookup} disabled={parsing}>
              <Ionicons name="search" size={14} color="#FFF" />
              <Text style={styles.lookupText}>{parsing ? '...' : 'Look Up'}</Text>
            </TouchableOpacity>
          </View>

          <Text style={[styles.editLabel, { color: t.textSecondary }]}>Name (中文 / 中文名)</Text>
          <TextInput
            style={[styles.editInput, { backgroundColor: t.bg, color: t.text }]}
            value={result.name_original ?? ''}
            onChangeText={(v) => setResult({ ...result, name_original: v })}
            placeholder="餐廳名稱"
            placeholderTextColor={t.textTertiary}
          />

          <Text style={[styles.editLabel, { color: t.textSecondary }]}>Address (English)</Text>
          <TextInput
            style={[styles.editInput, { backgroundColor: t.bg, color: t.text }]}
            value={result.address_en ?? ''}
            onChangeText={(v) => setResult({ ...result, address_en: v })}
            placeholder="Street, area, Hong Kong"
            placeholderTextColor={t.textTertiary}
          />

          <Text style={[styles.editLabel, { color: t.textSecondary }]}>Address (地址)</Text>
          <TextInput
            style={[styles.editInput, { backgroundColor: t.bg, color: t.text }]}
            value={result.address_original ?? ''}
            onChangeText={(v) => setResult({ ...result, address_original: v })}
            placeholder="街道、地區"
            placeholderTextColor={t.textTertiary}
          />

          <Text style={[styles.editLabel, { color: t.textSecondary }]}>District / 地區</Text>
          <TextInput
            style={[styles.editInput, { backgroundColor: t.bg, color: t.text }]}
            value={result.district ?? ''}
            onChangeText={(v) => setResult({ ...result, district: v || null })}
            placeholder="e.g. 尖沙咀, Central, Mong Kok..."
            placeholderTextColor={t.textTertiary}
          />

          <Text style={[styles.editLabel, { color: t.textSecondary }]}>Category</Text>
          <View style={styles.chipRow}>
            {(Object.keys(CATEGORY_LABELS) as Category[]).map((cat) => (
              <TouchableOpacity key={cat} style={[styles.chip, result.category === cat && styles.chipActive]} onPress={() => setResult({ ...result, category: cat })}>
                <Text style={[styles.chipText, result.category === cat && styles.chipTextActive]}>{CATEGORY_LABELS[cat]}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.editLabel, { color: t.textSecondary }]}>Price hint</Text>
          <TextInput
            style={[styles.editInput, { backgroundColor: t.bg, color: t.text }]}
            value={result.price_hint ?? ''}
            onChangeText={(v) => setResult({ ...result, price_hint: v || null })}
            placeholder="$ / $$ / $$$ / HK$100-200"
            placeholderTextColor={t.textTertiary}
          />

          <Text style={[styles.editLabel, { color: t.textSecondary }]}>Tags (comma-separated)</Text>
          <TextInput
            style={[styles.editInput, { backgroundColor: t.bg, color: t.text }]}
            value={(result.tags || []).join(', ')}
            onChangeText={(v) => setResult({ ...result, tags: v.split(',').map(s => s.trim()).filter(Boolean) })}
            placeholder="coffee, outdoor, pet-friendly, 打卡"
            placeholderTextColor={t.textTertiary}
          />

          <Text style={[styles.editLabel, { color: t.textSecondary }]}>Source URL</Text>
          <Text style={[styles.urlText, { color: t.textTertiary }]} numberOfLines={1}>{url}</Text>

          <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
            <Ionicons name="bookmark" size={18} color="#FFF" />
            <Text style={styles.saveBtnText}>Save to My Spots</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.reparseBtn} onPress={handleParse}>
            <Text style={styles.reparseBtnText}>Re-parse URL</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // Parse failed with no useful data — show URL input with error hint
  if (result && !hasUsefulData) {
    return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.container, { backgroundColor: t.bgSecondary }]}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={[styles.label, { color: t.text }]}>Paste a link</Text>
          <Text style={[styles.sublabel, { color: t.textSecondary }]}>Instagram, RED, Facebook, Threads, YouTube</Text>

          {parseHint && (
            <View style={[styles.hintBanner, styles.hintError]}>
              <Ionicons name="warning" size={18} color="#FF3B30" />
              <Text style={[styles.hintText, { color: '#FF3B30' }]}>{parseHint}</Text>
            </View>
          )}

          <TextInput
            style={[styles.urlInput, { backgroundColor: t.bg, color: t.text }]}
            value={url}
            onChangeText={(v) => { setUrl(v); setResult(null); setParseHint(null); }}
            autoFocus={!url}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="https://..."
            placeholderTextColor={t.textTertiary}
          />
          <TouchableOpacity style={styles.parseBtn} onPress={handleParse}>
            <Ionicons name="sparkles" size={18} color="#FFF" />
            <Text style={styles.parseBtnText}>Parse & Edit</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // Initial URL input screen
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.container, { backgroundColor: t.bgSecondary }]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.label, { color: t.text }]}>Paste a link</Text>
        <Text style={[styles.sublabel, { color: t.textSecondary }]}>Instagram, RED, Facebook, Threads, YouTube</Text>
        <TextInput
          style={[styles.urlInput, { backgroundColor: t.bg, color: t.text }]}
          value={url}
          onChangeText={(v) => { setUrl(v); setResult(null); setParseHint(null); }}
          autoFocus={!url}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="https://..."
          placeholderTextColor={t.textTertiary}
        />
        <TouchableOpacity style={styles.parseBtn} onPress={handleParse}>
          <Ionicons name="sparkles" size={18} color="#FFF" />
          <Text style={styles.parseBtnText}>Parse & Edit</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF' },
  content: { padding: 24, paddingBottom: 60 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFF', gap: 16 },
  loadingText: { fontSize: 16, color: '#8E8E93' },
  label: { fontSize: 18, fontWeight: '800', color: '#1A1A1A', marginBottom: 4 },
  sublabel: { fontSize: 13, color: '#8E8E93', marginBottom: 20 },
  hintBanner: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: '#EBF5FF', borderRadius: 10, padding: 12,
    marginBottom: 12, gap: 8,
  },
  hintError: {
    backgroundColor: '#FFF0F0',
  },
  hintText: {
    flex: 1, fontSize: 13, color: '#007AFF', lineHeight: 18,
  },
  urlInput: { backgroundColor: '#F4F4F5', borderRadius: 12, padding: 16, fontSize: 16, color: '#1A1A1A', minHeight: 56 },
  parseBtn: { marginTop: 20, backgroundColor: '#FF6B35', paddingVertical: 16, borderRadius: 12, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 },
  parseBtnText: { fontSize: 16, fontWeight: '700', color: '#FFF' },
  editLabel: { fontSize: 13, fontWeight: '700', color: '#8E8E93', marginTop: 14, marginBottom: 4 },
  editInput: { backgroundColor: '#F4F4F5', borderRadius: 10, padding: 12, fontSize: 15, color: '#1A1A1A' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  chip: { backgroundColor: '#F4F4F5', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: '#E5E5EA' },
  chipActive: { backgroundColor: '#FF6B35', borderColor: '#FF6B35' },
  chipText: { fontSize: 12, fontWeight: '600', color: '#636366' },
  chipTextActive: { color: '#FFF' },
  urlText: { fontSize: 12, color: '#8E8E93', marginTop: 4 },
  saveBtn: { marginTop: 24, backgroundColor: '#FF6B35', paddingVertical: 16, borderRadius: 12, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 },
  saveBtnText: { fontSize: 16, fontWeight: '700', color: '#FFF' },
  reparseBtn: { marginTop: 10, paddingVertical: 12, alignItems: 'center' },
  reparseBtnText: { fontSize: 14, color: '#8E8E93', fontWeight: '600' },
  nameRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  nameInput: { flex: 1 },
  lookupBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#007AFF', paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10, gap: 4 },
  lookupText: { color: '#FFF', fontWeight: '700', fontSize: 13 },
});
