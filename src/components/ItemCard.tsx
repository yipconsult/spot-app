import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { UserSave, CATEGORY_LABELS, Category, SourcePlatform, PLATFORM_LABELS } from '../types';
import { useTheme } from '../contexts/ThemeContext';

interface ItemCardProps {
  save: UserSave;
  onPress: () => void;
}

const PLATFORM_ICONS: Record<SourcePlatform, keyof typeof Ionicons.glyphMap> = {
  instagram: 'logo-instagram',
  red: 'chatbubble-ellipses',
  facebook: 'logo-facebook',
  pinterest: 'logo-pinterest',
  threads: 'text',
  youtube_reels: 'logo-youtube',
  manual: 'link',
};

export function ItemCard({ save, onPress }: ItemCardProps) {
  const t = useTheme();
  const item = save.saved_item;
  if (!item) return null;

  const displayName = item.name_en || item.name_original || 'Untitled Spot';
  const categoryLabel = CATEGORY_LABELS[item.category as Category] || CATEGORY_LABELS.other;
  const platformIcon = PLATFORM_ICONS[item.source_platform as SourcePlatform] || 'link';
  const thumbnailUrl = (item.parsed_json as any)?.thumbnail_url as string | undefined;

  return (
    <TouchableOpacity style={[styles.card, { backgroundColor: t.surface }]} onPress={onPress} activeOpacity={0.7}>
      {/* Thumbnail or platform icon */}
      <View style={styles.thumbnail}>
        {thumbnailUrl ? (
          <Image source={{ uri: thumbnailUrl }} style={styles.thumbnailImg} />
        ) : (
          <View style={[styles.platformBadge, { backgroundColor: platformColor(item.source_platform) }]}>
            <Ionicons name={platformIcon} size={20} color="#FFF" />
          </View>
        )}
      </View>

      {/* Content */}
      <View style={styles.content}>
        <Text style={[styles.name, { color: t.text }]} numberOfLines={1}>{displayName}</Text>

        <View style={styles.metaRow}>
          <Text style={styles.categoryChip}>{categoryLabel}</Text>
          {item.district && <Text style={[styles.districtText, { color: t.textSecondary }]}>{item.district}</Text>}
        </View>

        {(item.address_en || item.address_original) && (
          <Text style={[styles.address, { color: t.textSecondary }]} numberOfLines={1}>
            <Ionicons name="location-outline" size={11} color={t.textSecondary} />{' '}
            {item.address_en || item.address_original}
          </Text>
        )}

        <View style={styles.bottomRow}>
          {item.tags && item.tags.length > 0 && (
            <Text style={[styles.tags, { color: t.textTertiary }]} numberOfLines={1}>
              {item.tags.slice(0, 3).join(' · ')}
            </Text>
          )}
          <View style={styles.sourceRow}>
            <Ionicons name={platformIcon} size={11} color={t.textTertiary} />
            <Text style={[styles.sourceText, { color: t.textTertiary }]}>{PLATFORM_LABELS[item.source_platform as SourcePlatform] || 'Link'}</Text>
          </View>
        </View>
      </View>

      {/* Saved date */}
      <View style={styles.rightCol}>
        <Ionicons name="chevron-forward" size={16} color="#C7C7CC" />
        {save.visited_at && (
          <Ionicons name="checkmark-circle" size={14} color="#34C759" style={styles.visited} />
        )}
      </View>
    </TouchableOpacity>
  );
}

function platformColor(platform: SourcePlatform): string {
  switch (platform) {
    case 'instagram': return '#E4405F';
    case 'red': return '#FF2442';
    case 'facebook': return '#1877F2';
    case 'threads': return '#000';
    case 'youtube_reels': return '#FF0000';
    case 'pinterest': return '#BD081C';
    default: return '#FF6B35';
  }
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    marginHorizontal: 16, marginVertical: 4,
    padding: 12, borderRadius: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  thumbnail: {
    width: 56, height: 56, borderRadius: 10, overflow: 'hidden',
    marginRight: 12,
  },
  thumbnailImg: {
    width: 56, height: 56, borderRadius: 10,
    backgroundColor: '#2C2C2E',
  },
  platformBadge: {
    width: 56, height: 56, borderRadius: 10,
    justifyContent: 'center', alignItems: 'center',
  },
  content: {
    flex: 1, gap: 3, justifyContent: 'center',
  },
  name: {
    fontSize: 15, fontWeight: '700',
  },
  metaRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  categoryChip: {
    fontSize: 11, fontWeight: '600', color: '#FF6B35',
  },
  districtText: {
    fontSize: 12, fontWeight: '500',
  },
  address: {
    fontSize: 12,
  },
  bottomRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginTop: 2,
  },
  tags: {
    fontSize: 11, flex: 1,
  },
  sourceRow: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
  },
  sourceText: {
    fontSize: 10, fontWeight: '500',
  },
  rightCol: {
    marginLeft: 8, alignItems: 'flex-end', gap: 6,
  },
  visited: {
    marginTop: 2,
  },
});
