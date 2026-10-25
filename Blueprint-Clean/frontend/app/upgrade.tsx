import React, { useState } from 'react';
import { useRouter } from 'expo-router';
import { useAuth } from '../context/AuthContext';
import {
  Alert,
  Image,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ScrollView,
  TextInput,
  useWindowDimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '@/config/api';


export default function Upgrade() {
  const router = useRouter();

  const { refreshUser, isPro } = useAuth();
  const { width } = useWindowDimensions();
  const [activationCode, setActivationCode] = useState('');
  const [activating, setActivating] = useState(false);

  const showMessage = (title: string, message: string) => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.alert(message);
    } else {
      Alert.alert(title, message);
    }
  };

  const handleActivate = async () => {
    if (activating) return;
    if (isPro) {
      showMessage('Already activated', 'Your M.A.B. S1 access is already active.');
      return;
    }

    const code = activationCode.trim().toUpperCase();
    if (!/^MAB1-[0-9A-F]{32}$/.test(code)) {
      showMessage('Check your code', 'Enter the full MAB1 activation code from your Shopify email.');
      return;
    }

    const token =
      Platform.OS === 'web' && typeof window !== 'undefined'
        ? window.sessionStorage.getItem('authToken')
        : await AsyncStorage.getItem('authToken');

    if (!token) {
      showMessage('Sign in required', 'Sign in or create a M.A.B. account before activating your code.');
      router.push('/auth');
      return;
    }

    setActivating(true);
    try {
      const response = await fetch(`${API_URL}/api/premium/activate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.success !== true) {
        const detail = typeof result?.detail === 'string'
          ? result.detail
          : 'Unable to activate this code. Please check it and try again.';
        throw new Error(detail);
      }

      await refreshUser();
      setActivationCode('');
      showMessage('M.A.B. activated', 'Permanent M.A.B. S1 access is active on your account.');
      router.replace('/path');
    } catch (error) {
      showMessage('Activation error', error instanceof Error ? error.message : 'Activation failed.');
    } finally {
      setActivating(false);
    }
  };

const handleSubscribe = async () => {
  try {
    const token =
  Platform.OS === 'web' && typeof window !== 'undefined'
    ? window.sessionStorage.getItem('authToken')
    : await AsyncStorage.getItem('authToken');
      if (!token) {
      throw new Error('Login session not found. Please log in again.');
    }

    const originUrl =
      Platform.OS === 'web'
        ? window.location.origin
        : 'http://127.0.0.1:8081';

    const response = await fetch(
      `${API_URL}/api/payments/checkout/session`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          package_id: 'mab_s1_payment',
          origin_url: originUrl,
        }),
      }
    );

    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(responseText || 'Could not create Stripe checkout.');
    }

    const data = JSON.parse(responseText);

    if (!data.url) {
      throw new Error('Stripe checkout URL was not returned.');
    }

    if (Platform.OS === 'web') {
      window.location.href = data.url;
    } else {
      await Linking.openURL(data.url);
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Checkout failed.';

    if (Platform.OS === 'web') {
      window.alert(message);
    } else {
      Alert.alert('Checkout Error', message);
    }
  }
};


  return (
    <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      <Text style={styles.title}>M.A.B. S1.5 ACCESS</Text>
      <Text style={styles.subtitle}>Activate an existing license or purchase permanent access.</Text>
      {isPro && <Text style={styles.activeNotice}>✓ Your M.A.B. S1 access is already active.</Text>}

      <View style={[styles.optionRow, width < 660 && styles.optionStack]}>
        <View style={[styles.optionCard, width < 660 && styles.optionCardStack]} testID="mab-activation-card">
          <Text style={styles.optionIcon}>✦</Text>
          <Text style={styles.optionTitle}>Activate Access</Text>
          <Text style={styles.optionDescription}>Purchased through Shopify? Enter the code from your email.</Text>
          <TextInput
            style={styles.codeInput}
            value={activationCode}
            onChangeText={setActivationCode}
            placeholder="MAB1-..."
            placeholderTextColor="#A6A6A6"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={37}
            editable={!activating}
            accessibilityLabel="Shopify activation code"
            testID="mab-activation-code-input"
          />
          <TouchableOpacity
            style={[styles.goldButton, activating && styles.buttonDisabled]}
            onPress={handleActivate}
            disabled={activating}
            accessibilityRole="button"
            testID="mab-activate-button"
          >
            <Text style={styles.goldButtonText}>{activating ? 'ACTIVATING...' : 'ACTIVATE'}</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.optionCard, width < 660 && styles.optionCardStack]} testID="mab-purchase-card">
          <Text style={styles.optionIcon}>◆</Text>
          <Text style={styles.optionTitle}>Purchase Access</Text>
          <Text style={styles.price}>$30.00</Text>
          <Text style={styles.optionDescription}>One-time payment. Permanent M.A.B. S1 access.</Text>
          <TouchableOpacity
            style={styles.goldButton}
            onPress={isPro ? () => showMessage('Already unlocked', 'Your M.A.B. S1 access is already active.') : handleSubscribe}
            accessibilityRole="button"
            testID="mab-purchase-button"
          >
            <Text style={styles.goldButtonText}>BUY NOW</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Text style={styles.footerText}>Sign in to your M.A.B. account before purchasing or activating.</Text>
      <Text style={styles.copyright}>© 2026 M.A.B. Path Editor. All Rights Reserved.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#050505',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    paddingVertical: 48,
  },
  title: {
    color: '#D9B65D',
    fontSize: 30,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 12,
  },
  subtitle: {
    color: '#D8D0BC',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 32,
  },
  activeNotice: {
    color: '#E4CF9A',
    fontWeight: '700',
    marginBottom: 22,
    textAlign: 'center',
  },
  optionRow: {
    width: '100%',
    maxWidth: 900,
    flexDirection: 'row',
    gap: 20,
    justifyContent: 'center',
    alignItems: 'stretch',
  },
  optionStack: {
    flexDirection: 'column',
  },
  optionCard: {
    flex: 1,
    minWidth: 0,
    padding: 24,
    gap: 12,
    backgroundColor: '#101010',
    borderColor: '#B9933C',
    borderWidth: 1,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  optionCardStack: {
    flex: 0,
    width: '100%',
  },
  optionIcon: {
    color: '#D9B65D',
    fontSize: 32,
  },
  optionTitle: {
    color: '#F1D38A',
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  optionDescription: {
    color: '#C8BEA6',
    fontSize: 14,
    textAlign: 'center',
    minHeight: 44,
  },
  codeInput: {
    width: '100%',
    padding: 14,
    backgroundColor: '#1B1B1B',
    color: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#62502B',
    borderRadius: 8,
    fontSize: 15,
    marginTop: 12,
  },
  price: {
    color: '#F1D38A',
    fontSize: 34,
    fontWeight: '800',
    marginTop: 10,
  },
  goldButton: {
    width: '100%',
    backgroundColor: '#D9B65D',
    borderRadius: 8,
    paddingVertical: 16,
    paddingHorizontal: 12,
    marginTop: 'auto',
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.65,
  },
  goldButtonText: {
    color: '#16120B',
    fontWeight: '800',
    fontSize: 16,
  },
  footerText: {
    color: '#AD9A73',
    fontSize: 13,
    marginTop: 28,
    textAlign: 'center',
  },
  copyright: {
    color: '#666',
    fontSize: 12,
    marginTop: 32,
    textAlign: 'center',
  },
});
