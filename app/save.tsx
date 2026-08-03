import { useState, useEffect, useRef, useCallback } from 'react';
import { View, TextInput, TouchableOpacity, Text, StyleSheet, Alert, KeyboardAvoidingView, Platform, ScrollView, AppState } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useShareIntentContext } from 'expo-share-intent';
import { supabase } from '../src/lib/supabase';
import { useAuth } from '../src/contexts/AuthContext';
import { useTheme } from '../src/contexts/ThemeContext';
import { ParseResult, Category, CATEGORY_LABELS } from '../src/types';
import { checkClipboard, isSocialUrl, extractUrl } from '../src/lib/clipboard';
import * as Clipboard from 'expo-clipboard';

/** Normalize Instagram URLs: strip tracking params, convert deep links to web URLs */
function normalizeUrl(raw: string): string {
  let url = raw.trim();

  // Convert instagram:// deep links to web URLs
  // instagram://reel/CODE → https://www.instagram.com/reel/CODE/
  // instagram://user?username=XXX → https://www.instagram.com/XXX/
  const deepLinkMatch = url.match(/^instagram:\/\/(?:media\?id=\d+|(reel|p|tv|stories)\/([A-Za-z0-9_-]+))/i);
  if (deepLinkMatch) {
    const type = deepLinkMatch[1] || 'p';
    const code = deepLinkMatch[2];
    if (code) {
      url = `https://www.instagram.com/${type}/${code}/`;
    }
  }

  // Strip tracking/query params that can interfere with oEmbed/scraping
  // Keep the path clean: remove ?igsh, ?igshid, ?utm_*, ?fbclid, etc.
  try {
    const u = new URL(url);
    const trackingParams = ['igsh', 'igshid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'ref'];
    let changed = false;
    for (const p of trackingParams) {
      if (u.searchParams.has(p)) {
        u.searchParams.delete(p);
        changed = true;
      }
    }
    if (changed) url = u.toString();
  } catch { /* not a valid URL, return as-is */ }

  return url;
}

function detectPlatformFromUrl(url: string): string {
  const u = url.toLowerCase();
  if (u.includes('instagram.com')) return 'instagram';
  if (u.includes('threads.net')) return 'threads';
  if (u.includes('facebook.com') || u.includes('fb.com')) return 'facebook';
  if (u.includes('xhslink.com') || u.includes('xiaohongshu.com')) return 'red';
  if (u.includes('pin.it') || u.includes('pinterest.com')) return 'pinterest';
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube_reels';
  if (u.includes('openrice.com')) return 'manual'; // stored as manual but we know it's OpenRice
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
  const { hasShareIntent, shareIntent, resetShareIntent, isReady } = useShareIntentContext();

  // On focus: check for new share/deep-link/clipboard data and auto-parse
  useFocusEffect(
    useCallback(() => {
      const checkAndParse = async () => {
        const paramUrl = params.url || params.prefillUrl;
        const decodedUrl = paramUrl ? decodeURIComponent(paramUrl) : '';

        // Extract URL from share intent — check ALL possible sources
        let shareUrl = '';
        let shareTextForParse = '';
        if (isReady && hasShareIntent) {
          // Log full share intent for debugging
          console.log('[SaveScreen] ShareIntent data:', {
            webUrl: shareIntent.webUrl,
            type: shareIntent.type,
            textPreview: (shareIntent.text || '').slice(0, 200),
            metaTitle: shareIntent.meta?.title || '',
            hasFiles: !!(shareIntent.files?.length),
          });

          // 1. webUrl (most reliable — direct URL attachment)
          if (shareIntent.webUrl) {
            shareUrl = shareIntent.webUrl;
            console.log('[SaveScreen] Using shareIntent.webUrl:', shareUrl);
          }

          // 2. Extract URL from text — but use social-aware extraction
          if (!shareUrl && shareIntent.text) {
            const extracted = extractUrl(shareIntent.text);
            if (extracted) {
              shareUrl = extracted;
              console.log('[SaveScreen] Extracted from shareIntent.text:', shareUrl);
            }
          }

          // 3. Check meta.title for URLs (Instagram sometimes puts URL here)
          if (!shareUrl && shareIntent.meta?.title) {
            const titleUrl = shareIntent.meta.title.match(/https?:\/\/[^\s]+/)?.[0];
            if (titleUrl) {
              shareUrl = titleUrl;
              console.log('[SaveScreen] Extracted from meta.title:', shareUrl);
            }
          }

          // If still no URL, use text as-is for Gemini parsing context
          if (!shareUrl && shareIntent.text) {
            shareTextForParse = shareIntent.text;
            console.log('[SaveScreen] No URL in share intent, using text for parse');
          }
        }

        // Normalize the URL (strip tracking params, convert deep links)
        const normalizedUrl = shareUrl ? normalizeUrl(shareUrl) : '';
        const finalShareUrl = normalizedUrl || shareUrl; // prefer normalized

        // Priority: param URL → share intent URL → text-based URL
        const useUrl = decodedUrl || finalShareUrl ||
          (shareTextForParse ? shareTextForParse.match(/https?:\/\/[^\s]+/)?.[0] : '') || '';

        if (useUrl && useUrl !== lastFilledUrl.current) {
          lastFilledUrl.current = useUrl;
          // Reset for new parse
          setResult(null);
          setUrl(useUrl);
          if (hasShareIntent && isReady) resetShareIntent();
          console.log('[SaveScreen] Auto-parsing URL:', useUrl);
          handleParseWithText(useUrl, shareIntent.text || shareTextForParse || undefined);
          return;
        }

        if (useUrl === lastFilledUrl.current) {
          console.log('[SaveScreen] URL already processed, skipping:', useUrl.slice(0, 80));
          return;
        }

        // Clipboard fallback — wait 1.5s for share intent first, then fall back
        if (isReady) {
          // Small delay: let ShareIntentProvider populate if it's going to
          await new Promise(resolve => setTimeout(resolve, 1500));

          // Re-check share intent (may have arrived late)
          if (hasShareIntent && !lastFilledUrl.current) {
            const lateUrl = shareIntent.webUrl || '';
            const lateText = shareIntent.text || '';
            if (lateUrl || lateText) {
              const extracted = lateUrl || extractUrl(lateText) || '';
              const normalized = extracted ? normalizeUrl(extracted) : '';
              lastFilledUrl.current = normalized;
              setResult(null);
              setUrl(normalized);
              resetShareIntent();
              console.log('[SaveScreen] Late share intent, auto-parsing:', normalized);
              handleParseWithText(normalized, lateText);
              return;
            }
          }

          const clipUrl = await checkClipboard();
          if (clipUrl && clipUrl !== lastFilledUrl.current) {
            lastFilledUrl.current = clipUrl;
            setResult(null);
            setUrl(clipUrl);
            // Clear clipboard to prevent stale reuse on next share
            Clipboard.setStringAsync('').catch(() => {});
            console.log('[SaveScreen] Auto-parsing from clipboard:', clipUrl);
            handleParseWithText(clipUrl);
          }
        }
      };

      checkAndParse();
    }, [params.url, params.prefillUrl, hasShareIntent, shareIntent, isReady])
  );

  // Reset state when app returns from background (new share may have arrived)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        lastFilledUrl.current = null;  // allow re-processing
        setResult(null);               // clear old form
        setParsing(false);             // clear stale loading state
        console.log('[SaveScreen] App became active — reset for new share');
      }
    });
    return () => sub.remove();
  }, []);

  const handleParse = () => handleParseWithText(url);

  const handleParseWithText = async (parseUrl: string, sharedText?: string) => {
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
  };

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

    const cleanUrl = normalizeUrl(url.trim());

    const { data: existing } = await supabase
      .from('saved_items').select('id').eq('source_url', cleanUrl).single();
    let itemId = existing?.id;

    if (!itemId) {
      // Detect platform from URL for the card display
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

    // Link to default list
    const { data: defaultList } = await supabase
      .from('user_lists').select('id').eq('user_id', user.id).eq('is_shared', false).limit(1).single();

    const { error: saveErr } = await supabase.from('user_saves').insert({
      user_id: user.id, saved_item_id: itemId, list_id: defaultList?.id ?? null,
    });
    if (saveErr) { Alert.alert('Error', saveErr.message); return; }
    router.back();
  };

  if (parsing) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: t.bgSecondary }]}>
        <Ionicons name="hourglass" size={48} color={t.accent} />
        <Text style={[styles.loadingText, { color: t.textSecondary }]}>Reading post...</Text>
      </View>
    );
  }

  // Only show edit form if we have useful data — otherwise show URL input with error
  const hasUsefulData = result && (result.name_en || result.name_original || result.address_en || result.address_original);

  if (result && hasUsefulData) {
    return (
      <KeyboardAvoidingView style={[styles.container, { backgroundColor: t.bgSecondary }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={[styles.label, { color: t.text }]}>Edit before saving</Text>
          <Text style={[styles.sublabel, { color: t.textSecondary }]}>AI filled what it could. Fix anything that's wrong.</Text>

          {parseHint && (
            <View style={styles.hintBanner}>
              <Ionicons name="bulb-outline" size={16} color="#007AFF" />
              <Text style={styles.hintText}>{parseHint}</Text>
            </View>
          )}

          <Text style={[styles.editLabel, { color: t.textSecondary }]}>Name (English)</Text>
          <View style={styles.nameRow}>
            <TextInput style={[styles.editInput, styles.nameInput, { backgroundColor: t.bg, color: t.text }]} value={result.name_en ?? ''} onChangeText={(v) => setResult({ ...result, name_en: v })} placeholder="Restaurant name" placeholderTextColor={t.textTertiary} />
            <TouchableOpacity style={styles.lookupBtn} onPress={handleLookup} disabled={parsing}>
              <Ionicons name="search" size={16} color="#FFF" />
              <Text style={styles.lookupText}>{parsing ? '...' : 'Look Up'}</Text>
            </TouchableOpacity>
          </View>

          <Text style={[styles.editLabel, { color: t.textSecondary }]}>Name (中文 / 中文名)</Text>
          <TextInput style={[styles.editInput, { backgroundColor: t.bg, color: t.text }]} value={result.name_original ?? ''} onChangeText={(v) => setResult({ ...result, name_original: v })} placeholder="餐廳名稱" placeholderTextColor={t.textTertiary} />

          <Text style={[styles.editLabel, { color: t.textSecondary }]}>Address (English)</Text>
          <TextInput style={[styles.editInput, { backgroundColor: t.bg, color: t.text }]} value={result.address_en ?? ''} onChangeText={(v) => setResult({ ...result, address_en: v })} placeholder="Street, area, Hong Kong" placeholderTextColor={t.textTertiary} />

          <Text style={[styles.editLabel, { color: t.textSecondary }]}>Address (地址)</Text>
          <TextInput style={[styles.editInput, { backgroundColor: t.bg, color: t.text }]} value={result.address_original ?? ''} onChangeText={(v) => setResult({ ...result, address_original: v })} placeholder="街道、地區" placeholderTextColor={t.textTertiary} />

          <Text style={[styles.editLabel, { color: t.textSecondary }]}>District / 地區 (free text)</Text>
          <TextInput style={[styles.editInput, { backgroundColor: t.bg, color: t.text }]} value={result.district ?? ''} onChangeText={(v) => setResult({ ...result, district: v || null })} placeholder="e.g. 尖沙咀, Central, Mong Kok..." placeholderTextColor={t.textTertiary} />

          <Text style={styles.editLabel}>Category</Text>
          <View style={styles.chipRow}>
            {(Object.keys(CATEGORY_LABELS) as Category[]).map((cat) => (
              <TouchableOpacity key={cat} style={[styles.chip, result.category === cat && styles.chipActive]} onPress={() => setResult({ ...result, category: cat })}>
                <Text style={[styles.chipText, result.category === cat && styles.chipTextActive]}>{CATEGORY_LABELS[cat]}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.editLabel, { color: t.textSecondary }]}>Price hint</Text>
          <TextInput style={[styles.editInput, { backgroundColor: t.bg, color: t.text }]} value={result.price_hint ?? ''} onChangeText={(v) => setResult({ ...result, price_hint: v || null })} placeholder="$ / $$ / $$$ / HK$100-200" placeholderTextColor={t.textTertiary} />

          <Text style={[styles.editLabel, { color: t.textSecondary }]}>Tags (comma-separated)</Text>
          <TextInput style={[styles.editInput, { backgroundColor: t.bg, color: t.text }]} value={(result.tags || []).join(', ')} onChangeText={(v) => setResult({ ...result, tags: v.split(',').map(s => s.trim()).filter(Boolean) })} placeholder="coffee, outdoor, pet-friendly, 打卡" placeholderTextColor={t.textTertiary} />

          <Text style={[styles.editLabel, { color: t.textSecondary }]}>Source URL</Text>
          <Text style={[styles.urlText, { color: t.textSecondary }]} numberOfLines={1}>{url}</Text>

          <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
            <Ionicons name="bookmark" size={20} color="#FFF" />
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
      <KeyboardAvoidingView style={[styles.container, { backgroundColor: t.bgSecondary }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={[styles.label, { color: t.text }]}>Paste a link</Text>
          <Text style={[styles.sublabel, { color: t.textSecondary }]}>Instagram, RED, Facebook, Threads, YouTube</Text>

          {/* Error hint banner */}
          {parseHint && (
            <View style={styles.hintBanner}>
              <Ionicons name="alert-circle-outline" size={16} color="#FF3B30" />
              <Text style={[styles.hintText, { color: '#FF3B30' }]}>{parseHint}</Text>
            </View>
          )}

          <TextInput
            style={[styles.urlInput, { backgroundColor: t.bg, color: t.text }]}
            placeholder="https://..."
            placeholderTextColor={t.textSecondary}
            value={url}
            onChangeText={(v) => { setUrl(v); setResult(null); setParseHint(null); }}
            autoFocus={!url}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <TouchableOpacity style={styles.parseBtn} onPress={handleParse}>
            <Ionicons name="sparkles" size={18} color="#FFF" />
            <Text style={styles.parseBtnText}>Parse & Edit</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // URL input screen
  return (
    <KeyboardAvoidingView style={[styles.container, { backgroundColor: t.bgSecondary }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.label, { color: t.text }]}>Paste a link</Text>
        <Text style={[styles.sublabel, { color: t.textSecondary }]}>Instagram, RED, Facebook, Threads, YouTube</Text>
        <TextInput style={[styles.urlInput, { backgroundColor: t.bg, color: t.text }]} placeholder="https://..." placeholderTextColor={t.textSecondary} value={url} onChangeText={setUrl} autoFocus={!url} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
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
