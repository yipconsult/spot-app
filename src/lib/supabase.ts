import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

// In-memory storage — session won't persist across restarts.
// Switch to expo-secure-store when building a proper dev client with `npx expo run:ios`.
const memStore: Record<string, string> = {};
const memoryStorage = {
  getItem: async (key: string) => memStore[key] ?? null,
  setItem: async (key: string, value: string) => { memStore[key] = value; },
  removeItem: async (key: string) => { delete memStore[key]; },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: memoryStorage,
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
