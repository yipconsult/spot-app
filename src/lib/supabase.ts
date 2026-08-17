import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

// Persistent storage — session survives app kills.
// (SecureStore has a 2048-byte per-key limit which JWT sessions can exceed.)
const storage = {
  getItem: async (key: string) => AsyncStorage.getItem(key),
  setItem: async (key: string, value: string) => AsyncStorage.setItem(key, value),
  removeItem: async (key: string) => AsyncStorage.removeItem(key),
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});
