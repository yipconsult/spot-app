import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getOfferings, purchasePackage, restorePurchases, PREMIUM_ENTITLEMENT } from '../lib/revenuecat';

interface PaywallSheetProps {
  visible: boolean;
  reason: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function PaywallSheet({ visible, reason, onClose, onSuccess }: PaywallSheetProps) {
  const [offerings, setOfferings] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [actionLabel, setActionLabel] = useState('');

  useEffect(() => {
    if (visible) {
      getOfferings().then(setOfferings);
    }
  }, [visible]);

  const handlePurchase = async (pkg: any) => {
    setLoading(true);
    setActionLabel('Purchasing...');
    try {
      const customerInfo = await purchasePackage(pkg);
      if (customerInfo?.entitlements.active[PREMIUM_ENTITLEMENT]) {
        onSuccess();
      }
    } catch (err: any) {
      Alert.alert('Purchase Failed', err?.message || 'Please try again.');
    }
    setLoading(false);
    setActionLabel('');
  };

  const handleRestore = async () => {
    setLoading(true);
    setActionLabel('Restoring...');
    try {
      const customerInfo = await restorePurchases();
      if (customerInfo?.entitlements.active[PREMIUM_ENTITLEMENT]) {
        Alert.alert('Restored!', 'Your premium access has been restored.');
        onSuccess();
      } else {
        Alert.alert('No Purchase Found', 'No active subscription was found.');
      }
    } catch {
      Alert.alert('Error', 'Could not restore purchases.');
    }
    setLoading(false);
    setActionLabel('');
  };

  if (!visible) return null;

  const monthly = offerings?.current?.monthly;
  const annual = offerings?.current?.annual;

  return (
    <View style={styles.backdrop}>
      <View style={styles.sheet}>
        {/* Header */}
        <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
          <Ionicons name="close" size={24} color="#8E8E93" />
        </TouchableOpacity>

        <View style={styles.iconCircle}>
          <Ionicons name="sparkles" size={36} color="#FF6B35" />
        </View>
        <Text style={styles.title}>Unlock Spot Premium</Text>
        <Text style={styles.reason}>{reason}</Text>

        {/* Features */}
        <View style={styles.features}>
          <FeatureRow icon="layers" text="Unlimited shared lists" />
          <FeatureRow icon="people" text="Share with unlimited friends" />
          <FeatureRow icon="filter" text="Smart Shuffle & Mood Filters" />
          <FeatureRow icon="calendar" text="Auto-calendar blocking" />
          <FeatureRow icon="sparkles" text="All Premium features" />
        </View>

        {/* Loading */}
        {loading && (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color="#FF6B35" />
            <Text style={styles.loadingText}>{actionLabel}</Text>
          </View>
        )}

        {/* Pricing */}
        {!loading && (
          <>
            {annual && (
              <TouchableOpacity style={styles.annualBtn} onPress={() => handlePurchase(annual)}>
                <View style={styles.badge}><Text style={styles.badgeText}>BEST VALUE</Text></View>
                <Text style={styles.priceText}>{annual.product.priceString}/yr</Text>
                <Text style={styles.subText}>HK$24/month — save 37%</Text>
              </TouchableOpacity>
            )}
            {monthly && (
              <TouchableOpacity style={styles.monthlyBtn} onPress={() => handlePurchase(monthly)}>
                <Text style={styles.monthlyPrice}>{monthly.product.priceString}/mo</Text>
                <Text style={styles.monthlySub}>HK$38/month</Text>
              </TouchableOpacity>
            )}
          </>
        )}

        {/* Legal */}
        <Text style={styles.legal}>
          Payment will be charged to your Apple ID account. Subscription automatically renews unless cancelled at least 24 hours before the end of the current period. Manage subscriptions in App Store settings.
        </Text>

        {/* Restore */}
        <TouchableOpacity style={styles.restoreBtn} onPress={handleRestore} disabled={loading}>
          <Text style={styles.restoreText}>Restore Purchases</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function FeatureRow({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={styles.featureRow}>
      <Ionicons name={icon as any} size={18} color="#34C759" />
      <Text style={styles.featureText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end',
    zIndex: 100,
  },
  sheet: {
    backgroundColor: '#FFF', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 50, alignItems: 'center',
  },
  closeBtn: { alignSelf: 'flex-end', padding: 4 },
  iconCircle: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: '#FFF4ED',
    justifyContent: 'center', alignItems: 'center', marginTop: 8,
  },
  title: { fontSize: 24, fontWeight: '800', color: '#1A1A1A', marginTop: 12 },
  reason: { fontSize: 14, color: '#8E8E93', textAlign: 'center', marginTop: 6 },
  features: { width: '100%', marginTop: 20, gap: 10 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  featureText: { fontSize: 15, color: '#1A1A1A', fontWeight: '500' },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 20 },
  loadingText: { fontSize: 14, color: '#8E8E93' },
  annualBtn: {
    width: '100%', backgroundColor: '#FFF4ED', borderRadius: 14,
    padding: 16, alignItems: 'center', marginTop: 20,
    borderWidth: 2, borderColor: '#FF6B35', position: 'relative',
  },
  badge: {
    position: 'absolute', top: -10, backgroundColor: '#FF6B35',
    paddingHorizontal: 12, paddingVertical: 3, borderRadius: 8,
  },
  badgeText: { fontSize: 11, fontWeight: '800', color: '#FFF' },
  priceText: { fontSize: 20, fontWeight: '800', color: '#FF6B35' },
  subText: { fontSize: 13, color: '#FF6B35', marginTop: 4 },
  monthlyBtn: {
    width: '100%', backgroundColor: '#F4F4F5', borderRadius: 14,
    padding: 16, alignItems: 'center', marginTop: 10,
  },
  monthlyPrice: { fontSize: 18, fontWeight: '700', color: '#1A1A1A' },
  monthlySub: { fontSize: 13, color: '#8E8E93', marginTop: 2 },
  legal: { fontSize: 11, color: '#C7C7CC', textAlign: 'center', marginTop: 16, lineHeight: 16 },
  restoreBtn: { marginTop: 10, padding: 10 },
  restoreText: { fontSize: 14, color: '#FF6B35', fontWeight: '600' },
});
