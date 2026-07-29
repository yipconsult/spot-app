import { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, Platform, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { requestCalendarPermissionsAsync, getCalendarsAsync, createEventAsync, EntityTypes } from 'expo-calendar/legacy';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { supabase } from '../../src/lib/supabase';
import { useTheme } from '../../src/contexts/ThemeContext';
import { SavedItem, CATEGORY_LABELS, Category } from '../../src/types';

export default function ItemDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const router = useRouter();
  const [item, setItem] = useState<SavedItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPicker, setShowPicker] = useState(false);
  const [plannedDate, setPlannedDate] = useState(new Date());
  const [editMode, setEditMode] = useState(false);
  const [editName, setEditName] = useState('');
  const [editNameEn, setEditNameEn] = useState('');
  const [editAddr, setEditAddr] = useState('');
  const [editAddrEn, setEditAddrEn] = useState('');
  const [editCat, setEditCat] = useState<Category>('other');
  const [editDistrict, setEditDistrict] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [editTags, setEditTags] = useState('');

  useEffect(() => {
    if (!id) return;
    supabase
      .from('saved_items')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        if (!error && data) setItem(data as SavedItem);
        setLoading(false);
      });
  }, [id]);

  const handleExportCalendar = async (date?: Date) => {
    if (!item) return;
    const eventDate = date || plannedDate;
    const name = item.name_en || item.name_original || 'Spot';
    const addr = item.address_en || item.address_original || '';

    try {
      const { status } = await requestCalendarPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Allow calendar access to add events.');
        return;
      }

      const calendars = await getCalendarsAsync(EntityTypes.EVENT);
      const defaultCalendar = calendars.find((c) => c.allowsModifications) || calendars[0];

      if (!defaultCalendar) {
        Alert.alert('Error', 'No calendar available.');
        return;
      }

      await createEventAsync(defaultCalendar.id, {
        title: `🍽️ ${name}`,
        location: addr,
        startDate: eventDate,
        endDate: new Date(eventDate.getTime() + 2 * 60 * 60 * 1000),
        notes: `Saved from Spot app\n${item.source_url}`,
      });

      Alert.alert('Added!', `"${name}" added to your calendar.`, [
        { text: 'OK' },
      ]);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Could not add to calendar.');
    }
  };

  const onDateChange = (_event: DateTimePickerEvent, selectedDate?: Date) => {
    setShowPicker(false);
    if (selectedDate) {
      setPlannedDate(selectedDate);
      handleExportCalendar(selectedDate);
    }
  };

  const handleOpenMaps = () => {
    if (!item) return;
    const query = encodeURIComponent(item.address_en || item.name_en || item.name_original || '');
    const url = Platform.OS === 'ios'
      ? `maps://?q=${query}`
      : `https://maps.google.com/?q=${query}`;
    // Use Linking.openURL — not imported here, fallback to browser-style
    const { Linking } = require('react-native');
    Linking.openURL(url).catch(() => Alert.alert('Error', 'Could not open Maps.'));
  };

  const startEdit = () => {
    if (!item) return;
    setEditName(item.name_original || '');
    setEditNameEn(item.name_en || '');
    setEditAddr(item.address_original || '');
    setEditAddrEn(item.address_en || '');
    setEditCat(item.category);
    setEditDistrict(item.district || '');
    setEditPrice(item.price_hint || '');
    setEditTags((item.tags || []).join(', '));
    setEditMode(true);
  };

  const handleSaveEdit = async () => {
    if (!item || !id) return;
    const updates = {
      name_original: editName || null,
      name_en: editNameEn || null,
      address_original: editAddr || null,
      address_en: editAddrEn || null,
      category: editCat,
      district: editDistrict || null,
      price_hint: editPrice || null,
      tags: editTags ? editTags.split(',').map(t => t.trim()).filter(Boolean) : [],
    };
    const { error } = await supabase.from('saved_items').update(updates).eq('id', id);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      setItem({ ...item, ...updates });
      setEditMode(false);
    }
  };

  const handleDelete = () => {
    Alert.alert('Delete Spot', 'Remove this spot from your saves?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          await supabase.from('user_saves').delete().eq('saved_item_id', id);
          router.back();
        },
      },
    ]);
  };

  if (loading) {
    return <View style={styles.centered}><Text style={{ color: '#8E8E93' }}>Loading...</Text></View>;
  }

  if (!item) {
    return (
      <View style={styles.centered}>
        <Ionicons name="alert-circle" size={48} color="#FF3B30" />
        <Text style={{ fontSize: 16, color: '#8E8E93', marginTop: 12 }}>Spot not found</Text>
      </View>
    );
  }

  const displayName = item.name_en || item.name_original || 'Untitled Spot';
  const categoryLabel = CATEGORY_LABELS[item.category as Category];

  return (
    <ScrollView style={[styles.container, { backgroundColor: t.bgSecondary }]} contentContainerStyle={styles.content}>
      {/* Edit Toggle */}
      <TouchableOpacity style={styles.editToggle} onPress={() => editMode ? setEditMode(false) : startEdit()}>
        <Ionicons name={editMode ? 'close' : 'pencil'} size={20} color="#FF6B35" />
        <Text style={styles.editToggleText}>{editMode ? 'Cancel' : 'Edit'}</Text>
      </TouchableOpacity>

      {editMode ? (
        <>
          <Text style={styles.editLabel}>Name (English)</Text>
          <TextInput style={styles.editInput} value={editNameEn} onChangeText={setEditNameEn} placeholder="English name" placeholderTextColor="#C7C7CC" />
          <Text style={styles.editLabel}>Name (Chinese)</Text>
          <TextInput style={styles.editInput} value={editName} onChangeText={setEditName} placeholder="中文名稱" placeholderTextColor="#C7C7CC" />
          <Text style={styles.editLabel}>Address (English)</Text>
          <TextInput style={styles.editInput} value={editAddrEn} onChangeText={setEditAddrEn} placeholder="Address" placeholderTextColor="#C7C7CC" />
          <Text style={styles.editLabel}>Address (Chinese)</Text>
          <TextInput style={styles.editInput} value={editAddr} onChangeText={setEditAddr} placeholder="地址" placeholderTextColor="#C7C7CC" />
          <Text style={styles.editLabel}>District</Text>
          <TextInput style={styles.editInput} value={editDistrict} onChangeText={setEditDistrict} placeholder="e.g. Yau Tsim Mong" placeholderTextColor="#C7C7CC" />
          <Text style={styles.editLabel}>Category</Text>
          <View style={styles.chipRow}>
            {(Object.keys(CATEGORY_LABELS) as Category[]).map((cat) => (
              <TouchableOpacity key={cat} style={[styles.chip, editCat === cat && styles.chipActive]} onPress={() => setEditCat(cat)}>
                <Text style={[styles.chipText, editCat === cat && styles.chipTextActive]}>{CATEGORY_LABELS[cat]}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.editLabel}>Price</Text>
          <TextInput style={styles.editInput} value={editPrice} onChangeText={setEditPrice} placeholder="$ / $$ / $$$" placeholderTextColor="#C7C7CC" />
          <Text style={styles.editLabel}>Tags (comma-separated)</Text>
          <TextInput style={styles.editInput} value={editTags} onChangeText={setEditTags} placeholder="coffee, outdoor, pet-friendly" placeholderTextColor="#C7C7CC" />
          <TouchableOpacity style={styles.saveEditBtn} onPress={handleSaveEdit}>
            <Ionicons name="checkmark-circle" size={20} color="#FFF" />
            <Text style={styles.saveEditText}>Save Changes</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          {/* Header */}
          <Text style={styles.name}>{displayName}</Text>
          {item.name_original && item.name_original !== item.name_en && (
            <Text style={styles.nameOrig}>{item.name_original}</Text>
          )}

          {/* Category + District */}
          <View style={styles.chipRow}>
            <View style={styles.categoryChip}><Text style={styles.categoryChipText}>{categoryLabel}</Text></View>
            {item.district && <View style={styles.districtChip}><Text style={styles.districtChipText}>{item.district}</Text></View>}
            {item.price_hint && <View style={styles.priceChip}><Text style={styles.priceChipText}>{item.price_hint}</Text></View>}
          </View>

          {/* Address */}
          {item.address_en && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="location" size={18} color="#FF6B35" />
                <Text style={styles.sectionTitle}>Address</Text>
              </View>
              <Text style={styles.addressText}>{item.address_en}</Text>
              {item.address_original && <Text style={styles.addressText}>{item.address_original}</Text>}
            </View>
          )}

          {/* Tags */}
          {item.tags.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="pricetags" size={18} color="#FF6B35" />
                <Text style={styles.sectionTitle}>Tags</Text>
              </View>
              <View style={styles.tagRow}>
                {item.tags.map((t, i) => (
                  <View key={i} style={styles.tag}><Text style={styles.tagText}>{t}</Text></View>
                ))}
              </View>
            </View>
          )}

          {/* Source */}
          <View style={styles.sourceRow}>
            <Ionicons name="link" size={14} color="#8E8E93" />
            <Text style={styles.sourceText} numberOfLines={1}>{item.source_url}</Text>
          </View>

          {/* Actions */}
          <View style={styles.actions}>
            <TouchableOpacity style={styles.actionBtn} onPress={handleOpenMaps}>
              <Ionicons name="navigate" size={20} color="#FFF" />
              <Text style={styles.actionText}>Open in Maps</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtn, styles.calendarBtn]} onPress={() => setShowPicker(true)}>
              <Ionicons name="calendar" size={20} color="#FFF" />
              <Text style={styles.actionText}>Plan This</Text>
            </TouchableOpacity>
          </View>

          {/* Delete */}
          <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
            <Ionicons name="trash-outline" size={18} color="#FF3B30" />
            <Text style={styles.deleteText}>Remove from My Spots</Text>
          </TouchableOpacity>
        </>
      )}

      {/* Date/Time Picker for Calendar */}
      {showPicker && (
        <DateTimePicker
          value={plannedDate}
          mode="datetime"
          display="default"
          onChange={onDateChange}
          minimumDate={new Date()}
        />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF' },
  content: { padding: 24 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFF' },
  name: { fontSize: 26, fontWeight: '800', color: '#1A1A1A' },
  nameOrig: { fontSize: 18, color: '#636366', marginTop: 4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  categoryChip: { backgroundColor: '#FFF4ED', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  categoryChipText: { fontSize: 13, fontWeight: '700', color: '#FF6B35' },
  districtChip: { backgroundColor: '#E8F0FF', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  districtChipText: { fontSize: 13, fontWeight: '600', color: '#007AFF' },
  priceChip: { backgroundColor: '#E8F5E9', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  priceChipText: { fontSize: 13, fontWeight: '600', color: '#2E7D32' },
  section: { marginTop: 24 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#1A1A1A' },
  addressText: { fontSize: 15, color: '#636366', lineHeight: 22 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { backgroundColor: '#F4F4F5', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  tagText: { fontSize: 13, color: '#636366' },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 24, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#F0F0F0' },
  sourceText: { flex: 1, fontSize: 12, color: '#8E8E93' },
  actions: { flexDirection: 'row', gap: 12, marginTop: 24 },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FF6B35', paddingVertical: 14, borderRadius: 12, gap: 8,
  },
  calendarBtn: { backgroundColor: '#007AFF' },
  actionText: { fontSize: 14, fontWeight: '700', color: '#FFF' },
  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginTop: 16, paddingVertical: 12, gap: 6,
  },
  deleteText: { fontSize: 14, color: '#FF3B30', fontWeight: '600' },
  editToggle: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', gap: 4, marginBottom: 8 },
  editToggleText: { fontSize: 15, fontWeight: '600', color: '#FF6B35' },
  editLabel: { fontSize: 13, fontWeight: '700', color: '#8E8E93', marginTop: 10, marginBottom: 4 },
  editInput: { backgroundColor: '#F4F4F5', borderRadius: 10, padding: 12, fontSize: 15, color: '#1A1A1A', marginBottom: 4 },
  chip: { backgroundColor: '#F4F4F5', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: '#E5E5EA' },
  chipActive: { backgroundColor: '#FF6B35', borderColor: '#FF6B35' },
  chipText: { fontSize: 12, fontWeight: '600', color: '#636366' },
  chipTextActive: { color: '#FFF' },
  saveEditBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#34C759', paddingVertical: 14, borderRadius: 12, marginTop: 20, gap: 8 },
  saveEditText: { fontSize: 15, fontWeight: '700', color: '#FFF' },
});
