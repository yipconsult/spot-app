// expo-file-system v57: use legacy API
// @ts-ignore - cacheDirectory/writeAsStringAsync are in legacy module
import { writeAsStringAsync, EncodingType, cacheDirectory } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { supabase } from './supabase';
import { UserSave, CATEGORY_LABELS, Category } from '../types';

export async function exportSpotsAsCSV(userId: string): Promise<void> {
  const { data: saves, error } = await supabase
    .from('user_saves')
    .select('*, saved_item:saved_items(*)')
    .eq('user_id', userId)
    .order('saved_at', { ascending: false });

  if (error || !saves || saves.length === 0) {
    throw new Error(error?.message || 'No spots to export');
  }

  const header = 'Name,Name (中文),Address,District,Category,Price,Tags,Visited,URL';
  const rows = (saves as unknown as UserSave[]).map((save) => {
    const item = save.saved_item;
    if (!item) return '';
    return [
      escapeCsv(item.name_en || ''),
      escapeCsv(item.name_original || ''),
      escapeCsv(item.address_en || item.address_original || ''),
      escapeCsv(item.district || ''),
      CATEGORY_LABELS[item.category as Category]?.replace(/^[^\s]+\s/, '') || '',
      escapeCsv(item.price_hint || ''),
      escapeCsv((item.tags || []).join('; ')),
      save.visited_at ? 'Yes' : 'No',
      item.source_url,
    ].join(',');
  });

  const csv = [header, ...rows.filter(Boolean)].join('\n');

  const fileName = `spot-export-${new Date().toISOString().slice(0, 10)}.csv`;
  const fileUri = cacheDirectory + fileName;

  await writeAsStringAsync(fileUri, csv, {
    encoding: EncodingType.UTF8,
  });

  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    throw new Error('Sharing is not available on this device');
  }

  await Sharing.shareAsync(fileUri, {
    mimeType: 'text/csv',
    dialogTitle: `Export ${saves.length} spots`,
  });
}

export async function exportListAsText(listId: string): Promise<string> {
  const { data: saves, error } = await supabase
    .from('user_saves')
    .select('*, saved_item:saved_items(*)')
    .eq('list_id', listId)
    .order('saved_at', { ascending: false });

  if (error || !saves || saves.length === 0) {
    throw new Error(error?.message || 'No spots in this list');
  }

  const lines = (saves as unknown as UserSave[]).map((save) => {
    const item = save.saved_item;
    if (!item) return '';
    const name = item.name_en || item.name_original || 'Untitled';
    const addr = item.address_en || item.address_original || '';
    const category = CATEGORY_LABELS[item.category as Category] || '';
    const price = item.price_hint ? ` · ${item.price_hint}` : '';
    return `${category}  ${name}${price}\n${addr}`;
  });

  return lines.filter(Boolean).join('\n\n');
}

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
