import Purchases, { LOG_LEVEL, CustomerInfo } from 'react-native-purchases';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

const REVENUECAT_APPLE_KEY = process.env.EXPO_PUBLIC_REVENUECAT_APPLE_KEY || 'appl_ssdsjzLGMcHWzDbiCfNLPWuNlCi';

export const PREMIUM_ENTITLEMENT = 'premium';

let initialized = false;

export async function initRevenueCat(userId?: string) {
  if (initialized) return;
  if (!REVENUECAT_APPLE_KEY) return;

  // RevenueCat needs native store APIs — not available in Expo Go
  const isExpoGo = Constants.appOwnership === 'expo';
  if (isExpoGo) {
    if (__DEV__) console.log('[RevenueCat] Skipping init in Expo Go — no native store available');
    return;
  }

  try {
    if (Platform.OS === 'ios') {
      await Purchases.configure({
        apiKey: REVENUECAT_APPLE_KEY,
        appUserID: userId,
      });
      initialized = true;
    }
  } catch (err) {
    // Don't crash — RevenueCat is non-critical
    console.warn('RevenueCat init failed:', err);
    initialized = false;
  }
}

export async function getCustomerInfo(): Promise<CustomerInfo | null> {
  if (!initialized) return null;
  try {
    return await Purchases.getCustomerInfo();
  } catch {
    return null;
  }
}

export async function isPremium(): Promise<boolean> {
  if (!initialized) return false;
  try {
    const info = await Purchases.getCustomerInfo();
    return info.entitlements.active[PREMIUM_ENTITLEMENT] !== undefined;
  } catch {
    return false;
  }
}

export async function getOfferings() {
  if (!initialized) return null;
  try {
    return await Purchases.getOfferings();
  } catch {
    return null;
  }
}

export async function purchasePackage(pkg: any) {
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return customerInfo;
  } catch (err: any) {
    if (err?.userCancelled) return null;
    throw err;
  }
}

export async function restorePurchases() {
  try {
    return await Purchases.restorePurchases();
  } catch {
    return null;
  }
}
