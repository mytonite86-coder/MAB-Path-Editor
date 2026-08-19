import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
  Platform,
  Linking,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../context/AuthContext';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ExpoLinking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

interface PaymentPackage {
  package_id: string;
  name: string;
  description: string;
  amount: number;
  currency: string;
  perks: string[];
}

export default function Profile() {
  const { user, isGuest, logout, token, refreshUser } = useAuth();
  const router = useRouter();
  const { session_id, checkout } = useLocalSearchParams<{ session_id?: string; checkout?: string }>();
  
  const [packages, setPackages] = useState<PaymentPackage[]>([]);
  const [isLoadingPackages, setIsLoadingPackages] = useState(true);
  const [isCreatingCheckout, setIsCreatingCheckout] = useState<string | null>(null);
  const [paymentMessage, setPaymentMessage] = useState<string | null>(null);
  const [paymentTone, setPaymentTone] = useState<'success' | 'warning' | 'info'>('info');
  const handledSessionRef = useRef<string | null>(null);

  useEffect(() => {
    fetchPackages();
  }, []);

  useEffect(() => {
    if (checkout === 'cancel') {
      setPaymentTone('warning');
      setPaymentMessage('Checkout was canceled. You can try again anytime.');
    }
  }, [checkout]);

  useEffect(() => {
    if (session_id && token && handledSessionRef.current !== session_id) {
      handledSessionRef.current = session_id;
      pollCheckoutStatus(session_id);
    }
  }, [session_id, token]);

  const fetchPackages = async () => {
    try {
      const response = await fetch(`${API_URL}/api/payments/packages`);
      if (!response.ok) {
        throw new Error('Failed to load upgrade packages');
      }
      const data = await response.json();
      setPackages(data);
    } catch (error: any) {
      setPaymentTone('warning');
      setPaymentMessage(error.message || 'Failed to load upgrade packages');
    } finally {
      setIsLoadingPackages(false);
    }
  };

  const getOriginUrl = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin) {
      return window.location.origin;
    }

    return ExpoLinking.createURL('profile');
  };

  const pollCheckoutStatus = async (sessionId: string) => {
    setPaymentTone('info');
    setPaymentMessage('Checking payment status...');

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const response = await fetch(`${API_URL}/api/payments/checkout/status/${sessionId}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error('Failed to verify payment status');
        }

        const data = await response.json();
        if (['paid', 'no_payment_required'].includes(data.payment_status)) {
          await refreshUser();
          setPaymentTone('success');
          setPaymentMessage('Payment successful. Premium has been unlocked on your account.');
          return;
        }

        if (data.status === 'expired') {
          setPaymentTone('warning');
          setPaymentMessage('This checkout session expired. Please start a new payment.');
          return;
        }

        setPaymentTone('info');
        setPaymentMessage('Payment is being processed...');
      } catch (error: any) {
        setPaymentTone('warning');
        setPaymentMessage(error.message || 'Unable to verify payment status right now.');
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    setPaymentTone('warning');
    setPaymentMessage('Payment is still processing. Please check again in a moment.');
  };

  const handleLogout = () => {
    if (Platform.OS === 'web') {
      logout().then(() => router.replace('/auth'));
      return;
    }

    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: async () => {
          await logout();
          router.replace('/auth');
        },
      },
    ]);
  };

 

  const handleBuyUpgrade = async (packageId: string) => {
    if (!token) {
      Alert.alert('Login Required', 'Please log in to purchase a premium upgrade.');
      return;
    }

    setIsCreatingCheckout(packageId);
    try {
      const originUrl = getOriginUrl();
      const response = await fetch(`${API_URL}/api/payments/checkout/session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ package_id: packageId, origin_url: originUrl }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Unable to start checkout');
      }

      const data = await response.json();
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.location.href = data.url;
        return;
      }

      const result = await WebBrowser.openAuthSessionAsync(data.url, getOriginUrl());
      if (result.type === 'success' && result.url) {
        const parsedUrl = ExpoLinking.parse(result.url);
        const nextSessionId = typeof parsedUrl.queryParams?.session_id === 'string' ? parsedUrl.queryParams.session_id : undefined;
        const nextCheckout = typeof parsedUrl.queryParams?.checkout === 'string' ? parsedUrl.queryParams.checkout : undefined;

        if (nextCheckout === 'cancel') {
          setPaymentTone('warning');
          setPaymentMessage('Checkout was canceled. You can try again anytime.');
          return;
        }

        if (nextSessionId) {
          await pollCheckoutStatus(nextSessionId);
          return;
        }
      }

      if (result.type !== 'cancel') {
        await Linking.openURL(data.url);
      }
    } catch (error: any) {
      Alert.alert('Checkout Error', error.message || 'Unable to start checkout');
    } finally {
      setIsCreatingCheckout(null);
    }
  };

  if (isGuest) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header} testID="profile-header">
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton} testID="profile-back-button">
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.title} testID="profile-title">Profile</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView style={styles.content} testID="profile-guest-scroll">
          <View style={styles.guestCard} testID="profile-guest-card">
            <Ionicons name="person-circle-outline" size={80} color="#666" />
            <Text style={styles.guestTitle}>Guest Mode</Text>
            <Text style={styles.guestText}>
              Create an account to unlock all features:
            </Text>
            <View style={styles.featuresList}>
              <View style={styles.featureItem}>
                <Ionicons name="checkmark-circle" size={20} color="#34C759" />
                <Text style={styles.featureText}>Save blueprints</Text>
              </View>
              <View style={styles.featureItem}>
                <Ionicons name="checkmark-circle" size={20} color="#34C759" />
                <Text style={styles.featureText}>Access blueprint library</Text>
              </View>
              <View style={styles.featureItem}>
                <Ionicons name="checkmark-circle" size={20} color="#34C759" />
                <Text style={styles.featureText}>More AI generations</Text>
              </View>
              <View style={styles.featureItem}>
                <Ionicons name="checkmark-circle" size={20} color="#34C759" />
                <Text style={styles.featureText}>Premium upgrade option</Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.signUpButton}
              onPress={() => router.replace('/auth')}
              testID="profile-create-account-button"
            >
              <Text style={styles.signUpButtonText}>Create Account</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header} testID="profile-header">
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} testID="profile-back-button">
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title} testID="profile-title">Profile</Text>
        <TouchableOpacity onPress={handleLogout} style={styles.logoutButton} testID="profile-logout-button">
          <Ionicons name="log-out-outline" size={24} color="#FF3B30" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} testID="profile-screen-scroll">
        {paymentMessage && (
          <View
            style={[
              styles.statusCard,
              paymentTone === 'success' && styles.statusCardSuccess,
              paymentTone === 'warning' && styles.statusCardWarning,
            ]}
            testID="profile-payment-status-card"
          >
            <Text style={styles.statusText}>{paymentMessage}</Text>
          </View>
        )}

        <View style={styles.profileCard} testID="profile-user-card">
          <Ionicons name="person-circle" size={80} color="#007AFF" />
          <Text style={styles.username} testID="profile-username">{user?.username}</Text>
          <Text style={styles.email} testID="profile-email">{user?.email}</Text>
          {user?.is_premium && (
            <View style={styles.premiumBadgeLarge} testID="profile-premium-badge">
              <Ionicons name="star" size={20} color="#FFD700" />
              <Text style={styles.premiumBadgeText}>Lifetime Premium</Text>
            </View>
          )}
        </View>

        {!user?.is_premium && (
          <View style={styles.upgradeCard} testID="profile-upgrade-card">
            <View style={styles.upgradeHeader}>
  <Ionicons name="construct" size={32} color="#FFD700" />
  <Text style={styles.upgradeTitle}>Lifetime Pro Unlock</Text>
</View>

<Text style={styles.upgradeDescription}>
  Unlock every editing feature in M.A.B. S1.
</Text>

<View style={styles.premiumFeatures}>
  <View style={styles.premiumFeature}>
    <Ionicons name="checkmark-circle" size={20} color="#34C759" />
    <Text style={styles.premiumFeatureText}>Unlimited G-code editing</Text>
  </View>

  <View style={styles.premiumFeature}>
    <Ionicons name="checkmark-circle" size={20} color="#34C759" />
    <Text style={styles.premiumFeatureText}>Path repair tools</Text>
  </View>

  <View style={styles.premiumFeature}>
    <Ionicons name="checkmark-circle" size={20} color="#34C759" />
    <Text style={styles.premiumFeatureText}>Line editing & adjustment</Text>
  </View>

  <View style={styles.premiumFeature}>
    <Ionicons name="checkmark-circle" size={20} color="#34C759" />
    <Text style={styles.premiumFeatureText}>Unlimited file processing</Text>
  </View>

  <View style={styles.premiumFeature}>
    <Ionicons name="checkmark-circle" size={20} color="#34C759" />
    <Text style={styles.premiumFeatureText}>Lifetime updates for M.A.B. S1</Text>
  </View>
</View>

           <Text style={styles.sectionLabel}>Choose Your License</Text>
            {isLoadingPackages ? (
              <ActivityIndicator color="#FFD700" style={styles.packageLoader} />
            ) : (
              packages.map((upgradePackage) => (
                <View key={upgradePackage.package_id} style={styles.packageCard} testID={`profile-package-${upgradePackage.package_id}`}>
                  <View style={styles.packageHeader}>
                    <View style={styles.packageTextWrap}>
                      <Text style={styles.packageTitle}>{upgradePackage.name}</Text>
                      <Text style={styles.packageDescription}>{upgradePackage.description}</Text>
                    </View>
                    <Text style={styles.packagePrice}>${upgradePackage.amount.toFixed(2)}</Text>
                  </View>

                  {upgradePackage.perks.map((perk, index) => (
                    <View key={`${upgradePackage.package_id}-${index}`} style={styles.packagePerkRow}>
                      <Ionicons name="checkmark-circle" size={18} color="#34C759" />
                      <Text style={styles.packagePerkText}>{perk}</Text>
                    </View>
                  ))}

                  <TouchableOpacity
                    style={[styles.buyButton, isCreatingCheckout === upgradePackage.package_id && styles.activateButtonDisabled]}
                    onPress={() => handleBuyUpgrade(upgradePackage.package_id)}
                    disabled={isCreatingCheckout === upgradePackage.package_id}
                    testID={`profile-buy-${upgradePackage.package_id}-button`}
                  >
                    {isCreatingCheckout === upgradePackage.package_id ? (
                      <ActivityIndicator color="#000" />
                    ) : (
                      <Text style={styles.buyButtonText}>Buy Premium Upgrade</Text>
                    )}
                  </TouchableOpacity>
                </View>
              ))
            )}

            

            

           
          </View>
        )}

       <View style={styles.aboutCard}>
  <Text style={styles.aboutTitle}>About</Text>

  <Text style={styles.aboutText}>
    M.A.B. S1 Path Editor
  </Text>

  <Text style={styles.aboutText}>
    Professional CNC G-code Editing
  </Text>

  <Text style={styles.aboutVersion}>
    Version 1.0.0
  </Text>
</View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  backButton: {
    padding: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    flex: 1,
    textAlign: 'center',
  },
  logoutButton: {
    padding: 8,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  statusCard: {
    backgroundColor: '#111115',
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  statusCardSuccess: {
    borderColor: '#34C759',
  },
  statusCardWarning: {
    borderColor: '#FF9500',
  },
  statusText: {
    color: '#fff',
    fontSize: 14,
    lineHeight: 20,
  },
  profileCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#333',
  },
  username: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 12,
  },
  email: {
    fontSize: 16,
    color: '#666',
    marginTop: 4,
  },
  premiumBadgeLarge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2a2a2a',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginTop: 12,
  },
  premiumBadgeText: {
    color: '#FFD700',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  upgradeCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 24,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: '#FFD700',
  },
  upgradeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  upgradeTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginLeft: 12,
  },
  upgradeDescription: {
    fontSize: 16,
    color: '#666',
    marginBottom: 16,
  },
  premiumFeatures: {
    marginBottom: 24,
  },
  sectionLabel: {
    color: '#8E8E93',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.1,
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  packageLoader: {
    marginBottom: 20,
  },
  packageCard: {
    backgroundColor: '#0a0a0a',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#333',
    marginBottom: 16,
  },
  packageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  packageTextWrap: {
    flex: 1,
    paddingRight: 12,
  },
  packageTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  packageDescription: {
    color: '#A1A1A6',
    fontSize: 13,
    lineHeight: 18,
  },
  packagePrice: {
    color: '#FFD700',
    fontSize: 20,
    fontWeight: '800',
  },
  packagePerkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  packagePerkText: {
    color: '#fff',
    fontSize: 14,
    marginLeft: 10,
    flex: 1,
  },
  buyButton: {
    backgroundColor: '#FFD700',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  buyButtonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '800',
  },
  premiumFeature: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  premiumFeatureText: {
    fontSize: 16,
    color: '#fff',
    marginLeft: 12,
  },
  codeLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 8,
  },
  codeInput: {
    backgroundColor: '#0a0a0a',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#fff',
    borderWidth: 1,
    borderColor: '#333',
    marginBottom: 16,
  },
  activateButton: {
    backgroundColor: '#FFD700',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  activateButtonDisabled: {
    opacity: 0.6,
  },
  activateButtonText: {
    color: '#000',
    fontSize: 18,
    fontWeight: 'bold',
  },
  bypassHint: {
    textAlign: 'center',
    color: '#FFD700',
    fontSize: 14,
    marginTop: 12,
    fontWeight: '600',
  },
  guestCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333',
  },
  guestTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 16,
  },
  guestText: {
    fontSize: 16,
    color: '#666',
    marginTop: 12,
    textAlign: 'center',
  },
  featuresList: {
    alignSelf: 'stretch',
    marginTop: 24,
    marginBottom: 24,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  featureText: {
    fontSize: 16,
    color: '#fff',
    marginLeft: 12,
  },
  signUpButton: {
    backgroundColor: '#007AFF',
    borderRadius: 24,
    paddingHorizontal: 32,
    paddingVertical: 16,
  },
  signUpButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  aboutCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#333',
    marginBottom: 16,
  },
  aboutTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 12,
  },
  aboutText: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  aboutVersion: {
    fontSize: 14,
    color: '#A1A1A6',
    marginTop: 8,
  },
  infoCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#333',
  },
  infoTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 12,
  },
  infoText: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
});