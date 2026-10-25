import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useAuth } from '../context/AuthContext';
import {
  Alert,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ScrollView,
  TextInput,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '@/config/api';


export default function Upgrade() {
  const router = useRouter();

  const { refreshUser, isPro } = useAuth();
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
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.heading}>
        <Text style={styles.title}>
          <Text style={styles.brandWhite}>M.A.B. </Text>
          <Text style={styles.brandOrange}>S1.5 </Text>
          <Text style={styles.brandWhite}>ACCESS</Text>
        </Text>
        <Text style={styles.subtitle}>
          Activate your existing license or purchase permanent access.
        </Text>
        {isPro && <Text style={styles.activeNotice}>✓ Your M.A.B. S1 access is already active.</Text>}
      </View>

      <View style={styles.optionRow}>
        <View
          style={styles.optionCard}
          testID="mab-activation-card"
        >
          <Text style={styles.optionTitle}>Activate Access</Text>
          <Text style={styles.optionDescription}>
            Bought M.A.B. through Shopify? Enter the license code from your email.
          </Text>
          <TextInput
            style={styles.codeInput}
            value={activationCode}
            onChangeText={setActivationCode}
            placeholder="MAB1-..."
            placeholderTextColor="#999999"
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

        <View
          style={styles.optionCard}
          testID="mab-purchase-card"
        >
          <Text style={styles.optionTitle}>Purchase Access</Text>
          <Text style={styles.price}>$30.00</Text>
          <Text style={styles.optionDescription}>
            One-time payment. Permanent M.A.B. S1 access. No subscription.
          </Text>
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
  screen: {
    flex: 1,
    backgroundColor: '#000000',
  },
  container: {
    flexGrow: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 42,
    paddingBottom: 28,
  },
  heading: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 28,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    textAlign: 'center',
  },
  brandWhite: {
    color: '#FFFFFF',
  },
  brandOrange: {
    color: '#FF8C1A',
  },
  subtitle: {
    color: '#CCCCCC',
    fontSize: 16,
    textAlign: 'center',
    marginTop: 12,
  },
  activeNotice: {
    color: '#FFFFFF',
    fontWeight: '700',
    marginTop: 12,
    textAlign: 'center',
  },
  optionRow: {
    width: '100%',
    maxWidth: 960,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'stretch',
    gap: 18,
  },
  optionCard: {
    flexBasis: 400,
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 280,
    minHeight: 290,
    backgroundColor: '#111111',
    borderColor: '#505050',
    borderWidth: 1,
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
  },
  optionTitle: {
    color: '#FFFFFF',
    fontSize: 21,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 12,
  },
  optionDescription: {
    color: '#C7C7C7',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 18,
  },
  codeInput: {
    width: '100%',
    backgroundColor: '#202020',
    color: '#FFFFFF',
    padding: 14,
    borderWidth: 1,
    borderColor: '#555555',
    borderRadius: 8,
    fontSize: 15,
    marginTop: 4,
    marginBottom: 18,
  },
  price: {
    color: '#FF8C1A',
    fontSize: 34,
    fontWeight: '800',
    marginBottom: 14,
  },
  goldButton: {
    width: '100%',
    backgroundColor: '#D9B65D',
    borderRadius: 8,
    paddingVertical: 16,
    paddingHorizontal: 12,
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
    color: '#999999',
    fontSize: 13,
    marginTop: 24,
    textAlign: 'center',
  },
  copyright: {
    color: '#666666',
    fontSize: 12,
    marginTop: 26,
    textAlign: 'center',
  },
});
