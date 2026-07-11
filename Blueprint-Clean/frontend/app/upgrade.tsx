import { useRouter } from 'expo-router';
import {
  Alert,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

export default function Upgrade() {
  const router = useRouter();

  const handleSubscribe = () => {
    const message =
      'Stripe checkout will be connected to this button next.';

    if (Platform.OS === 'web') {
      window.alert(message);
    } else {
      Alert.alert('M.A.B. Pro', message);
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