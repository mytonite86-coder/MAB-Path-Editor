import { useRouter } from 'expo-router';
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
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function Upgrade() {
  const router = useRouter();

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
    <ScrollView
  contentContainerStyle={styles.container}
  showsVerticalScrollIndicator={false}
>
      <Text style={styles.title}>Unlock M.A.B. S1 Lifetime</Text>

      <Image
  source={require("../assets/images/featuredgraphic.png")}
  style={styles.featuredGraphic}
  resizeMode="contain"
/>

      <Text style={styles.subtitle}>
        One purchase. Lifetime access. Unlimited G-code editing, repair, copy, and export.
      </Text>


 
 <View style={styles.featureList}>
  <Text style={styles.featureItem}>✓ Unlimited G-code Editing</Text>
  <Text style={styles.featureItem}>✓ Repair Broken CNC Files</Text>
  <Text style={styles.featureItem}>✓ Export & Share G-code</Text>
  <Text style={styles.featureItem}>✓ All Future M.A.B. S1 Updates</Text>
  </View>

      <TouchableOpacity
        style={styles.button}
        onPress={handleSubscribe}
      >
        <Text style={styles.buttonText}>LifeTime Unlock • $19.99 •</Text>
      </TouchableOpacity>

 

      <TouchableOpacity
        style={styles.secondaryButton}
        onPress={() => router.replace('/path')}
      >
        <Text style={styles.secondaryText}>Continue Demo</Text>
      </TouchableOpacity>
  
  <Text style={styles.copyright}>
  © 2026 M.A.B. Path Editor. All Rights Reserved.
  </Text>

</ScrollView>
     
    
  );
}

const styles = StyleSheet.create({
 container: {
  flex: 1,
  backgroundColor: '#000',
  alignItems: 'center',
  padding: 24,
  paddingTop: 40,
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


  featuredGraphic: {
  width: "100%",
  maxWidth: 2400,
  height: 600,
  
  },

  featureList: {
  marginBottom: 10
,
  alignItems: "center",
},

featureItem: {
  color: "#FFFFFF",
  fontSize: 16,
  marginBottom: 10,
  fontWeight: "600",
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

  price: {
  fontSize: 32,
  fontWeight: "700",
  marginTop: 8,
  },

  priceNote: {
  fontSize: 16,
  marginTop: 4,
  marginBottom: 20,
  },

 copyright: {
  marginTop: 24,
  marginBottom: 12,
  fontSize: 12,
  color: "#666",
  textAlign: "center",
}, 
});