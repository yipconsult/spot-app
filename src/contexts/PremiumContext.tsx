import React, { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { initRevenueCat, isPremium, getCustomerInfo } from '../lib/revenuecat';

interface PremiumState {
  isPremium: boolean;
  loading: boolean;
  showPaywall: (reason: string) => void;
  hidePaywall: () => void;
  refreshPremium: () => Promise<void>;
}

const PremiumContext = createContext<PremiumState>({
  isPremium: false,
  loading: true,
  showPaywall: () => {},
  hidePaywall: () => {},
  refreshPremium: async () => {},
});

export function PremiumProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [isPremiumUser, setIsPremiumUser] = useState(false);
  const [loading, setLoading] = useState(true);
  const [paywallVisible, setPaywallVisible] = useState(false);
  const [paywallReason, setPaywallReason] = useState('');
  // Import PaywallSheet dynamically to avoid circular deps
  const [PaywallComponent, setPaywallComponent] = useState<any>(null);

  useEffect(() => {
    import('../components/PaywallSheet').then(m => setPaywallComponent(() => m.PaywallSheet));
  }, []);

  useEffect(() => {
    if (user) {
      // Delay RevenueCat init to avoid conflicts with auth transitions
      const timer = setTimeout(() => {
        initRevenueCat(user.id).then(() => checkPremium());
      }, 1000);
      return () => clearTimeout(timer);
    } else {
      setIsPremiumUser(false);
      setLoading(false);
    }
  }, [user]);

  const checkPremium = async () => {
    const premium = await isPremium();
    setIsPremiumUser(premium);
    setLoading(false);
  };

  const showPaywall = (reason: string) => {
    setPaywallReason(reason);
    setPaywallVisible(true);
  };

  const hidePaywall = () => setPaywallVisible(false);

  const refreshPremium = async () => {
    setLoading(true);
    await checkPremium();
  };

  return (
    <PremiumContext.Provider value={{ isPremium: isPremiumUser, loading, showPaywall, hidePaywall, refreshPremium }}>
      {children}
      {PaywallComponent && (
        <PaywallComponent
          visible={paywallVisible}
          reason={paywallReason}
          onClose={hidePaywall}
          onSuccess={() => {
            hidePaywall();
            setIsPremiumUser(true);
          }}
        />
      )}
    </PremiumContext.Provider>
  );
}

export const usePremium = () => useContext(PremiumContext);
