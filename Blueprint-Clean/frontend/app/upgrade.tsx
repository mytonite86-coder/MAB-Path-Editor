import { useRouter } from 'expo-router';
import {
  Alert,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function Upgrade() {
  const router = useRouter();

const handleSubscribe = async () => {
  try {
    const token = await AsyncStorage.getItem('authToken');

    if (!token) {
      throw new Error('Login session not found. Please log in again.');
    }

    const originUrl =
      Platform.OS === 'web'
        ? window.location.origin
        : 'http://127.0.0.1:8081';

    const response = await fetch(
      `${process.env.EXPO_PUBLIC_BACKEND_URL}/api/payments/checkout/session`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          package_id: 'premium_lifetime',
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
    <View style={styles.container}>
      <Text style={styles.title}>Unlock M.A.B. Pro</Text>

      <Text style={styles.subtitle}>
        Export and Copy G-code require an active Pro subscription.
      </Text>

      <TouchableOpacity
        style={styles.button}
        onPress={handleSubscribe}
      >
        <Text style={styles.buttonText}>Subscribe</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.secondaryButton}
        onPress={() => router.replace('/path')}
      >
        <Text style={styles.secondaryText}>Continue Demo</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },

  title: {
    color: '#fff',
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },

  subtitle: {
    color: '#bbb',
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 40,
  },

  button: {
    width: '100%',
    maxWidth: 600,
    backgroundColor: '#1976D2',
    padding: 18,
    borderRadius: 8,
    marginBottom: 16,
  },

  buttonText: {
    color: '#fff',
    textAlign: 'center',
    fontSize: 18,
    fontWeight: 'bold',
  },

  secondaryButton: {
    width: '100%',
    maxWidth: 600,
    borderWidth: 1,
    borderColor: '#666',
    padding: 18,
    borderRadius: 8,
  },

  secondaryText: {
    color: '#ccc',
    textAlign: 'center',
    fontSize: 16,
  },
});