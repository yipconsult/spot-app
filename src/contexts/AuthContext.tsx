import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface AuthState {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signInWithApple: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  session: null,
  user: null,
  loading: true,
  signUp: async () => ({ error: null }),
  signIn: async () => ({ error: null }),
  signInWithApple: async () => ({ error: null }),
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    // Timeout: stop loading after 10 seconds even if Supabase doesn't respond
    const timeout = setTimeout(() => {
      if (mounted) setLoading(false);
    }, 10000);

    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        if (mounted) {
          setSession(session);
          setUser(session?.user ?? null);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.warn('Failed to get session:', err);
        if (mounted) setLoading(false);
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
    });

    return () => {
      mounted = false;
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, []);

  const signUp = async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signUp({ email, password });
      return { error: error?.message ?? null };
    } catch (err: any) {
      return { error: err?.message || 'Sign up failed' };
    }
  };

  const signIn = async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: error?.message ?? null };
    } catch (err: any) {
      return { error: err?.message || 'Sign in failed' };
    }
  };

  const signInWithApple = async () => {
    // Apple OAuth placeholder — requires Apple Developer account
    // Will use expo-apple-authentication when credentials are available
    return { error: 'Apple Sign In will be available when your Apple Developer account is active.' };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ session, user, loading, signUp, signIn, signInWithApple, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
